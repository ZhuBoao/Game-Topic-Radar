// 发现流水线（多源 map-reduce、可追踪、可视化）。每步通过 run 上报器记录 input/output/logs，
// 前端轮询 run 状态画 Airflow 式 DAG。
// 结构：plan → [5 源并行采集] → [每源独立 extract（读全量、超大分块，不再全局截断）] → merge 合并去重排序。
// decomp 永远只做验证、不进发现。
import { runClaudeJson } from "./claude.js";
import * as P from "./prompts.js";
import * as acquire from "./acquire.js";
import { stepCtl } from "./runs.js";

const cap = (s, n) => (s && s.length > n ? s.slice(0, n) : s || "");

// 5 个发现源。kind=search 走"联网搜→抓正文"，kind=tcrf 走确定性主页+子页抓取。
const SOURCES = [
  // interview 抓 5 页×2200字=11000<CHUNK，保证单块单次提炼(否则 6×2400 会被切 2 块、慢一倍)
  { key: "interview_en", label: "采访·英译站", seedsKey: "interviewEnSeeds", kind: "search", maxUrls: 5, perChars: 2200 },
  { key: "interview_jp", label: "采访·日文站", seedsKey: "interviewJpSeeds", kind: "search", maxUrls: 5, perChars: 2200 },
  { key: "bigchannel", label: "大频道视频", seedsKey: "bigchannelSeeds", kind: "search", maxUrls: 5, perChars: 1800 },
  { key: "writeups", label: "文字深扒", seedsKey: "writeupSeeds", kind: "search", maxUrls: 5, perChars: 2200 },
  { key: "tcrf", label: "TCRF", seedsKey: "tcrfSeeds", kind: "tcrf" },
];

// 单源 extract 输入分块大小（超过就分多块、每块各跑一次）。设大些→多数源 1 块；
// 最多 2 块/源，给极厚的 TCRF(几十段)封顶 ~24000 字(约 30 段)，尾部边角舍弃换取不超时。
const CHUNK = 12000;
const MAX_CHUNKS = 2;
// 模型：plan(身份解析,最吃判断力)用默认 opus；提炼/合并是"从已抓到的正文里挑金矿
// 写中文"的机械活，改 Sonnet——又快又够用(opus 全用 map-reduce 要 ~19min/次)。
const MODEL_EXTRACT = "claude-sonnet-4-6";
// 并发上限（同时最多几个 claude -p）。采集是联网搜索但快(~40s)，可 4 并发；
// 提炼改 Sonnet 后单次快(~90s)、轻，3 并发不会互相拖垮。
const GATHER_POOL = 4;
const EXTRACT_POOL = 3;

export const DAG = [
  { name: "plan", label: "① 解析+计划(联网核实)", dependsOn: [] },
  ...SOURCES.map((s) => ({ name: "g_" + s.key, label: "采集·" + s.label, dependsOn: ["plan"] })),
  ...SOURCES.map((s) => ({ name: "x_" + s.key, label: "提炼·" + s.label, dependsOn: ["g_" + s.key] })),
  { name: "merge", label: "③ 合并去重排序", dependsOn: SOURCES.map((s) => "x_" + s.key) },
];

// 有界并发执行
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
      }
    })
  );
  return out;
}

// 把 items 贪心切成若干块，每块正文总量 <= maxChars
function chunkItems(items, maxChars) {
  const chunks = [];
  let cur = [], len = 0;
  for (const it of items) {
    const t = `- (${it.heading}) ${it.url}\n${it.text}\n`;
    if (len + t.length > maxChars && cur.length) { chunks.push(cur); cur = []; len = 0; }
    cur.push(it); len += t.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
const blockOf = (items) => items.map((it) => `- (${it.heading}) ${it.url}\n${it.text}`).join("\n");

export async function discover(game, mode, run, opts = {}) {
  const excludeTitles = opts.excludeTitles || []; // 池子里已有的点子标题——merge 据此排重，重跑只补新的
  // ① 解析 + 计划：联网核实身份 + 给 5 个源备好精确查询种子
  const planCtl = stepCtl(run, "plan");
  const planPrompt = P.pResolvePlan(game, mode);
  planCtl.start(planPrompt);
  let plan;
  try {
    plan = await runClaudeJson(planPrompt, { grounded: true, timeoutMs: 240000 });
    planCtl.done(plan);
  } catch (e) {
    planCtl.fail(e);
    throw e;
  }
  const en = plan.englishName || game;

  // 通用：claude 联网跑这组查询拿真实 URL → 服务端抓正文
  const searchFetch = async (c, queries, maxUrls, perChars) => {
    const urls = await runClaudeJson(P.pWebSearchUrls(en, queries || []), { grounded: true, timeoutMs: 240000 });
    const top = (Array.isArray(urls) ? urls : []).slice(0, maxUrls);
    c.log(`搜到 ${top.length} 个 URL，抓正文中`);
    const got = await Promise.allSettled(top.map(async (u) => {
      const m = await acquire.pageMaterial(u.url, perChars);
      return m.snippet ? { heading: u.title, url: u.url, text: m.snippet } : { heading: u.title, url: u.url, text: u.note || "" };
    }));
    return got.map((g) => (g.status === "fulfilled" ? g.value : null)).filter((x) => x && x.text);
  };

  // ② 5 源并行采集（有界并发）
  const sources = [];
  const gatherOne = async (s) => {
    const c = stepCtl(run, "g_" + s.key);
    const seeds = plan[s.seedsKey] || [];
    c.start(seeds);
    try {
      let items;
      if (s.kind === "tcrf") {
        const urls = await runClaudeJson(P.pWebSearchUrls(en, seeds), { grounded: true, timeoutMs: 200000 }).catch(() => []);
        const searchUrls = (Array.isArray(urls) ? urls : []).filter((u) => /tcrf\.net/i.test(u.url || "")).map((u) => u.url);
        c.log(`搜索命中 ${searchUrls.length} 个 tcrf 链接，叠加英文名直推主页+子页确定性抓取`);
        const r = await acquire.tcrfGather(en, searchUrls);
        r.logs.forEach((l) => c.log(l));
        items = r.items;
      } else if (!seeds.length) {
        c.log("本源无查询种子（plan 判定不适用，如纯西方游戏的日文站）");
        items = [];
      } else {
        items = await searchFetch(c, seeds, s.maxUrls, s.perChars);
      }
      sources.push({ source: s.key, label: s.label, ok: items.length > 0, count: items.length, items });
      c.done({ count: items.length, items: items.map((it) => ({ heading: it.heading, url: it.url, text: it.text })) });
      return items;
    } catch (e) {
      sources.push({ source: s.key, label: s.label, ok: false, count: 0, error: String(e?.message || e), items: [] });
      c.fail(e);
      return [];
    }
  };
  const gathered = await pool(SOURCES, GATHER_POOL, (s) => gatherOne(s));

  // ③ 每源独立 extract（读全量、超大分块，不再全局截断）—— map 步
  const extractOne = async (s, items) => {
    const c = stepCtl(run, "x_" + s.key);
    if (!items || !items.length) { c.start("(本源无材料)"); c.done({ count: 0, candidates: [] }); return []; }
    const allChunks = chunkItems(items, CHUNK);
    const chunks = allChunks.slice(0, MAX_CHUNKS);
    const dropped = allChunks.slice(MAX_CHUNKS).reduce((n, ck) => n + ck.length, 0);
    c.start(`本源 ${items.length} 条材料，分 ${chunks.length} 块提炼${dropped ? `（尾部 ${dropped} 条边角舍弃）` : ""}\n\n` + cap(blockOf(chunks[0]), 2000) + (chunks.length > 1 ? "\n…(后续块略)" : ""));
    const cands = [];
    try {
      if (dropped) c.log(`材料过多，只取前 ${MAX_CHUNKS} 块，尾部 ${dropped} 条舍弃`);
      for (let i = 0; i < chunks.length; i++) {
        c.log(`提炼第 ${i + 1}/${chunks.length} 块（${chunks[i].length} 条）`);
        const block = `### 来源[${s.key}] ${s.label}\n` + blockOf(chunks[i]);
        const raw = await runClaudeJson(P.pExtractCandidates(game, plan.profile, plan.families, block), { timeoutMs: 420000, model: MODEL_EXTRACT, effort: "medium" });
        (Array.isArray(raw) ? raw : []).forEach((x) => cands.push({ ...x, _source: s.key, watchability: Number(x.watchability) || 0 }));
      }
      cands.sort((a, b) => (b.watchability || 0) - (a.watchability || 0));
      c.done({ count: cands.length, candidates: cands });
    } catch (e) {
      c.fail(e);
    }
    return cands;
  };
  const perSource = await pool(SOURCES, EXTRACT_POOL, (s, i) => extractOne(s, gathered[i] || []));
  const allCands = perSource.flat().filter(Boolean);

  // ④ merge：跨源合并去重 + 负面索引 + 全局重排 —— reduce 步。
  // 【关键】merge 只输出"决策"(引用编号)，不重写完整候选——否则重新生成 12 条带证据
  // 的候选输出太大、会卡到 240s 超时然后回退。完整候选由代码从各源结果重组。
  const mergeCtl = stepCtl(run, "merge");
  let candidates = [];
  if (!allCands.length) {
    mergeCtl.start("(各源都没产出候选)");
    mergeCtl.done({ count: 0, candidates: [] });
  } else {
    // 精简编号列表：只给 标题+论断+源+想看度，不含证据（merge 判重/饱和用不到全文）
    const indexed = allCands.map((c, i) =>
      `#${i} [${c._source}|想看${c.watchability}${c.saturated ? "|英文区已记录" : ""}] ${c.title || ""} :: ${(c.claim || "").slice(0, 130)}`
    ).join("\n");
    mergeCtl.start(`合并 ${allCands.length} 条各源候选（决策模式）\n` + cap(indexed, 4000));
    const assemble = (d) => {
      const base = allCands[d.primary];
      if (!base) return null;
      const ev = [...(base.evidence || [])];
      for (const i of (d.mergeWith || [])) { const m = allCands[i]; if (Array.isArray(m?.evidence)) ev.push(...m.evidence); }
      const seen = new Set();
      const evd = ev.filter((e) => { const k = (e?.quote || "").slice(0, 40); if (!e || !k || seen.has(k)) return false; seen.add(k); return true; });
      return {
        ...base, evidence: evd,
        watchability: Number(d.watchability) || base.watchability,
        saturated: d.saturated != null ? d.saturated : base.saturated,
        saturatedNote: d.saturatedNote || base.saturatedNote,
      };
    };
    try {
      const raw = await runClaudeJson(P.pMergeCandidates(game, plan.profile, indexed, excludeTitles), { timeoutMs: 180000, model: MODEL_EXTRACT, effort: "low" });
      const decisions = Array.isArray(raw) ? raw : [];
      candidates = decisions.map(assemble).filter(Boolean).sort((a, b) => (b.watchability || 0) - (a.watchability || 0)).slice(0, 12);
      if (!candidates.length) throw new Error("merge 决策为空");
      mergeCtl.done({ count: candidates.length, candidates });
    } catch (e) {
      // 合并失败兜底：代码层按标题去重 + 想看度排序，绝不丢候选
      mergeCtl.log("LLM 合并失败，回退到代码去重：" + String(e?.message || e));
      const seen = new Set();
      candidates = allCands
        .filter((c) => { const k = (c.title || "").trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => (b.watchability || 0) - (a.watchability || 0)).slice(0, 12);
      mergeCtl.done({ count: candidates.length, candidates, fallback: true });
    }
  }

  return {
    plan: {
      englishName: en, japaneseName: plan.japaneseName || "", coreCharacters: plan.coreCharacters || [],
      aliases: plan.aliases || [], profile: plan.profile || null, families: plan.families || [],
      webQueries: SOURCES.flatMap((s) => plan[s.seedsKey] || []),
    },
    sources: sources.map(({ source, label, ok, count, error }) => ({ source, label, ok, count, error: error || "" })),
    candidates,
  };
}
