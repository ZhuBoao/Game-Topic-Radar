// ③ 采集层（v3 跨区注意力雷达）。
// 候选不由 LLM"想"出来，而是从【真人已用播放量投过票】的平台采出来——这才是"比 LLM 记忆更深"。
// LLM 只做：生成角度向查询(③-a) + 策展(③-b 判选题vs录像)，都不凭空造事实。
// 已确认可用源：YouTube Data API(key) + ニコニコ Snapshot API(无需 key)。Reddit 待 creds。
import * as yt from "./youtube.js";
import { runClaudeJson } from "./claude.js";
import * as P from "./prompts.js";

const NICO = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search";
const NICO_UA = "game-topic-radar/0.1 (personal research)";

// ニコニコ Snapshot Search v2：公开、无 key、按播放量返回。必带 _sort + _context + UA。
export async function niconicoSearch(query, max = 12) {
  const u = NICO + "?" + new URLSearchParams({
    q: query, targets: "title,tags,description",
    fields: "title,viewCounter,commentCounter,startTime,contentId",
    _sort: "-viewCounter", _limit: String(max), _context: "game-topic-radar",
  });
  try {
    const r = await fetch(u, { headers: { "User-Agent": NICO_UA } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.data || []).map((x) => ({
      title: x.title, viewCount: x.viewCounter || 0, comments: x.commentCounter || 0,
      year: (x.startTime || "").slice(0, 4),
      url: "https://www.nicovideo.jp/watch/" + x.contentId,
      channelTitle: "", platform: "niconico",
    }));
  } catch { return []; }
}

const dedupe = (vids) => {
  const seen = new Set(), out = [];
  for (const v of vids) { const k = (v.title || "").trim().toLowerCase(); if (!k || seen.has(k)) continue; seen.add(k); out.push(v); }
  return out;
};

// 明显垃圾（用户要的"太蠢的"）：纯录像/直播/攻略/CM/音乐。代码确定性滤，不靠 LLM。
// 注意：好角度的标题(逮捕传说/joycard/进化史/16連射の真実)都不含这些词，会留下。
const GARBAGE = /(実況|實況|long\s?play|walk\s?through|play\s?through|no\s?commentary|攻略|通关|通關|クリア動画|プレイ動画|プレイ映像|ゲームプレイ|gameplay|生放送|生配信|live配信|ライブ配信|\brta\b|\btas\b|カラオケ|karaoke|サウンドトラック|ost\b|bgm集|cm集|フルコンボ|耐久|作業用|part\s?\d|パート\s?\d|その\d|#\d{1,3}\b)/i;
const isGarbage = (title) => GARBAGE.test(title || "");

// 确定性查询模板：游戏名/人名 × 固定高产角度后缀。可复现 + 保证 逮捕/被砍/都市伝説 这些
// 高产词每次都搜（不靠 LLM 即兴生成→消除run间漂移）。
function buildQueries(identity) {
  const { en, jp, characters = [] } = identity || {};
  const enQ = en ? [
    `${en} cut content unused`,
    `${en} secrets facts you missed`,
    `${en} history documentary untold`,
    `${en} controversy scandal story`,
    `${en} beta prototype differences`,
    `${en} urban legend myth`,
  ] : [];
  const jpQ = jp ? [
    `${jp} 没データ ボツ`,
    `${jp} 都市伝説`,
    `${jp} 裏話 誕生秘話`,
    `${jp} 検証 嘘 本当`,
    `${jp} 騒動 なぜ消えた`,
  ] : [];
  const peopleJp = characters.map((c) => c.jp).filter(Boolean);
  const peopleQ = peopleJp.flatMap((n) => [`${n} 逮捕 都市伝説`, `${n} 正体 真相 知られざる`]);
  return { en: enQ, jp: [...jpQ, ...peopleQ] };
}

// 采集 + 策展，返回真人注意力验证过的候选角度。report=每步上报(可选,接 runs)。
export async function harvest(identity, report = {}) {
  const game = identity.en || identity.jp || identity.game || "";
  // ③-a 确定性查询模板（不靠 LLM 即兴→可复现、保证高产角度词每次都搜）
  const q = buildQueries(identity);
  const en = q.en, jp = q.jp;
  report.log?.(`查询：英文 ${en.length} 条 / 日文 ${jp.length} 条`);

  // ③ 采集（YouTube 英/日 + ニコニコ 日）——全部按播放量
  // 日文查询用 ja 语言(relevanceLanguage+regionCode JP)，否则会撞到无关日综/八卦。
  // Niconico 用【短查询】(游戏名/角色名)，长 AND 查询会 0 命中。
  const nicoQ = [identity.jp, ...(identity.characters || []).map((c) => c.jp).filter(Boolean)].filter(Boolean).slice(0, 3);
  const [ytEn, ytJp, ...nicoArrs] = await Promise.all([
    yt.searchVideos(en, "en", 6).catch(() => []),
    yt.searchVideos(jp, "ja", 6).catch(() => []),
    ...nicoQ.map((x) => niconicoSearch(x, 12)),
  ]);
  const ytEnT = ytEn.map((v) => ({ ...v, platform: "youtube" }));
  const ytJpT = ytJp.map((v) => ({ ...v, platform: "youtube" }));
  const all = dedupe([...ytEnT, ...ytJpT, ...nicoArrs.flat()]).sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
  report.log?.(`采到 ${all.length} 个视频（YT英 ${ytEnT.length} / YT日 ${ytJpT.length} / ニコ ${nicoArrs.flat().length}）`);
  // ③-b1 代码确定性滤掉明显垃圾(录像/直播/攻略/CM…)
  const kept = all.filter((v) => !isGarbage(v.title)).slice(0, 40);
  report.log?.(`滤掉录像/直播等垃圾后剩 ${kept.length} 条`);
  if (!kept.length) return { queries: q, pool: all, angles: [] };

  // ③-b2 LLM 只做翻译/标撞车（按原顺序等长，不做下标映射）
  const gloss = await runClaudeJson(P.pGloss(game, kept.map((v) => v.title)), { timeoutMs: 120000, model: "claude-sonnet-4-6", effort: "low" }).catch(() => []);
  const angles = kept.map((v, i) => {
    const g = Array.isArray(gloss) ? gloss[i] : null;
    return {
      angle: (g && g.a) || v.title, // 翻译缺失就退回原标题，绝不丢条目
      skip: !!(g && g.skip),
      views: v.viewCount || 0, platform: v.platform, exampleTitle: v.title, url: v.url, year: v.year || "",
    };
  }).filter((a) => !a.skip);
  report.log?.(`最终给你挑：${angles.length} 条角度`);
  return { queries: q, pool: all, angles };
}
