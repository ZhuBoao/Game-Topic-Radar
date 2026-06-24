// Acquisition connectors for NON-code sources. Code (corpus.js) is now
// VERIFICATION only — these curated/secondary sources are where material is
// actually DISCOVERED (TCRF/DataCrystal already did the "is it interesting?"
// filtering; interviews/speedrun notes are human-authored).
//
// Reality (probed 2026-06-21): TCRF/DataCrystal block api.php for bots, but
// their ARTICLE pages render fine → fetch HTML + chunk by section. Bulbapedia/
// Wikipedia MediaWiki API and speedrun.com REST work directly. AI web search
// (claude/openai grounded) is the discovery "driver" that finds which URL to
// fetch and dodges per-site anti-bot.
import { withTrace } from "./logger.js";

// 实测：TCRF 拦【长】UA(带 Chrome/124.0 那串)→403，但【短】UA 用 Node fetch 直接 200。
// 用短 UA 既能抓 TCRF，也不影响 wiki/speedrun/shmuplations 等普通站。
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function httpGet(url, { json = false, timeout = 25000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: json ? "application/json" : "text/html,*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return json ? res.json() : res.text();
  } finally {
    clearTimeout(t);
  }
}

/* ---------- HTML → text / sections ---------- */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#039": "'", nbsp: " ", mdash: "—", ndash: "–" };
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, name) => (ENTITIES[name] !== undefined ? ENTITIES[name] : m));
}
function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|sup|table)[\s\S]*?<\/\1>/gi, " ") // drop refs/infoboxes/scripts
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\[\s*edit\s*\]/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

// Split a rendered wiki/article HTML into sections keyed by <h2>/<h3> headings.
function htmlToSections(html) {
  // focus on the MediaWiki content body if present
  const body = html.match(/<div[^>]*class="[^"]*mw-parser-output[^"]*"[^>]*>([\s\S]*)/i);
  const content = body ? body[1] : html;
  const re = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const marks = [];
  let m;
  while ((m = re.exec(content))) {
    marks.push({ level: Number(m[1]), heading: stripTags(m[2]).trim(), at: m.index, end: re.lastIndex });
  }
  const out = [];
  if (marks[0] && marks[0].at > 0) {
    const intro = stripTags(content.slice(0, marks[0].at)).trim();
    if (intro.length > 40) out.push({ heading: "(intro)", level: 0, text: intro });
  }
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].end;
    const to = i + 1 < marks.length ? marks[i + 1].at : content.length;
    const text = stripTags(content.slice(from, to)).trim();
    if (text.length > 30) out.push({ heading: marks[i].heading, level: marks[i].level, text });
  }
  return out;
}

const INTERESTING =
  /unused|cut|removed|debug|regional|prerelease|beta|prototype|leftover|unseen|hidden|early|scrapped|dummy|placeholder|oddit|revision|differ/i;

// Fetch a URL (TCRF / DataCrystal / shmuplations / any article) and return its
// sections, flagging the ones likely to hold material.
export async function fetchPageSections(url) {
  const html = await httpGet(url);
  const sections = htmlToSections(html);
  return sections.map((s, i) => ({
    idx: i,
    heading: s.heading,
    level: s.level,
    chars: s.text.length,
    interesting: INTERESTING.test(s.heading),
    preview: s.text.slice(0, 160),
    text: s.text,
  }));
}

// 把一个 URL 抓成"实质素材"：选有料的 section（interesting 优先、再按大小），
// 拼成带小标题的正文（封顶 maxChars），供透镜使用。抓不到就返回空 snippet。
export async function pageMaterial(url, maxChars = 6000) {
  const sections = await fetchPageSections(url);
  const good = sections.filter((s) => s.chars > 60);
  good.sort((a, b) => (b.interesting ? 1 : 0) - (a.interesting ? 1 : 0) || b.chars - a.chars);
  const acc = [];
  let total = 0;
  for (const s of good) {
    if (total > maxChars) break;
    acc.push(`## ${s.heading}\n${s.text}`);
    total += s.chars;
  }
  const snippet = acc.join("\n\n").slice(0, maxChars);
  return { snippet, sectionCount: good.length, used: acc.length };
}

// 给 AI 探到的 URL 列表【服务端自己抓正文】补真实摘录（AI 只给 URL，不抓正文，
// 避免 headless claude 的 WebFetch 权限墙；服务端 fetch 没有这个问题）。
export async function enrichExcerpts(items, max = 10) {
  const top = items.slice(0, max);
  const settled = await Promise.allSettled(
    top.map(async (it) => {
      if (!it.url) return { ...it, excerpt: "", fetched: false };
      try {
        const secs = await fetchPageSections(it.url);
        const best =
          secs.find((s) => s.interesting && s.chars > 120) ||
          secs.find((s) => s.chars > 200) ||
          secs[0];
        return { ...it, excerpt: best ? best.text.slice(0, 600) : "", fetched: !!best };
      } catch {
        return { ...it, excerpt: "", fetched: false };
      }
    })
  );
  const enriched = settled.map((r, i) => (r.status === "fulfilled" ? r.value : { ...top[i], excerpt: "", fetched: false }));
  return enriched.concat(items.slice(max).map((it) => ({ ...it, excerpt: it.excerpt || "", fetched: false })));
}

// 从 TCRF 主页 HTML 里抓取内容子页链接（/<slug>/Xxx），排除语言版后缀。
// 只对"主页"(slug 不含 /)抓；子页不再下钻。让 TCRF 发现不依赖搜索运气。
function tcrfSubpages(html, url) {
  const slug = decodeURIComponent((url.split("tcrf.net/")[1] || "")).split("#")[0];
  if (!slug || slug.includes("/")) return [];
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`href="(/${esc}/[^"#?]+)"`, "g");
  const lang = /^(de|fr|ja|es|it|pt|ru|zh|ko|pl|nl|sv|fi|tr|zh-hans|zh-hant)$/i;
  const out = new Set();
  let m;
  while ((m = re.exec(html))) {
    const path = m[1].replace(/&amp;/g, "&");
    const seg = path.split("/").filter(Boolean).pop();
    if (!lang.test(seg)) out.add("https://tcrf.net" + path);
  }
  return [...out].slice(0, 10);
}

// TCRF 正文（fetch+短UA）+ 残桩过滤。冷门游戏在 TCRF 多是残桩(只有金手指/音效
// 测试/琐碎地区差异)，判废不进 extract。返回 {stub, sections(带chars/interesting), chars, subpages}。
export async function tcrfMaterial(url) {
  let html;
  try { html = await httpGet(url); } catch (e) { return { stub: true, reason: "抓取失败:" + String(e.message || e), sections: [], chars: 0, subpages: [] }; }
  if (/standard test page/i.test(html.slice(0, 4000))) {
    return { stub: true, reason: "TCRF 返回对抗页", sections: [], chars: 0, subpages: [] };
  }
  const stubMark = /rather stubbly|could use some expansion|contains no introduction|This page is a stub/i.test(html);
  const raw = htmlToSections(html).filter((s) => s.text.length > 60);
  const sections = raw.map((s, i) => ({ idx: i, heading: s.heading, level: s.level, chars: s.text.length, interesting: INTERESTING.test(s.heading), text: s.text }));
  const chars = sections.reduce((n, s) => n + s.chars, 0);
  const subpages = tcrfSubpages(html, url);
  if (stubMark || chars < 1200) return { stub: true, reason: stubMark ? "TCRF stub 标记" : `正文仅 ${chars} 字`, sections: [], chars, subpages };
  return { stub: false, sections, chars, subpages };
}

// 确定性 TCRF 发现：从 englishName 推标准页 URL（去平台后缀）+ 搜索补充的 URL，
// 抓主页 → 顺藤摸子页 → 残桩过滤，返回 {items, logs}。不依赖搜索是否命中。
export async function tcrfGather(englishName, searchUrls = []) {
  const base = (englishName || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  const mains = [...new Set([englishName, base].filter(Boolean))].map((s) => "https://tcrf.net/" + encodeURI(s.replace(/\s+/g, "_")));
  const queue = [...new Set([...mains, ...searchUrls.map((u) => u.split("#")[0])])];
  const seen = new Set();
  const items = [], logs = [];
  let used = 0;
  for (let i = 0; i < queue.length && used < 8; i++) {
    const u = queue[i];
    if (seen.has(u)) continue;
    seen.add(u);
    let m;
    try { m = await tcrfMaterial(u); } catch (e) { logs.push(`抓取失败 ${u}`); continue; }
    if (m.stub) { logs.push(`残桩跳过 ${u}（${m.reason}）`); }
    else {
      used++;
      const t = decodeURIComponent((u.split("tcrf.net/")[1] || u)).replace(/_/g, " ");
      for (const s of m.sections.filter((x) => x.interesting || x.chars > 200).slice(0, 4)) {
        items.push({ heading: `${t} · ${s.heading}`, url: u, text: s.text.slice(0, 800) });
      }
    }
    for (const sp of (m.subpages || [])) if (!seen.has(sp) && !queue.includes(sp)) queue.push(sp);
  }
  return { items, logs };
}

/* ---------- speedrun.com REST ---------- */
// 永不抛错。抓【分类(category) landscape + 各分类 WR 的备注】——分类名本身就暴露
// 这游戏有哪些值得讲的玩法/传说（比抓"最近的 run"有信息量得多）。
export async function speedrunNotes(game) {
  try {
    const search = await httpGet(
      `https://www.speedrun.com/api/v1/games?name=${encodeURIComponent(game)}&max=5`,
      { json: true }
    );
    const list = search.data || [];
    if (!list.length) return { game, items: [], note: `speedrun.com 没找到「${game}」` };
    // 优先精确匹配国际名，避开 romhack 误匹配
    const g = list.find((x) => (x.names?.international || "").toLowerCase() === game.toLowerCase()) || list[0];
    const items = [];
    const cats = await httpGet(`https://www.speedrun.com/api/v1/games/${g.id}/categories`, { json: true });
    const catList = (cats.data || []).filter((c) => c.type === "per-game");
    if (catList.length) {
      items.push({ heading: "速通分类一览", url: g.weblink, text: "这游戏的速通分类：" + catList.map((c) => c.name).join(" / ") });
    }
    // 取前几个分类的 WR 备注（往往写着该分类的关键 glitch / 路线 / 传说）
    for (const c of catList.slice(0, 4)) {
      try {
        const lb = await httpGet(`https://www.speedrun.com/api/v1/leaderboards/${g.id}/category/${c.id}?top=1`, { json: true });
        const run = lb.data?.runs?.[0]?.run;
        if (run?.comment && run.comment.trim().length > 40) {
          items.push({ heading: `WR · ${c.name}`, url: run.weblink, text: run.comment.trim() });
        }
      } catch { /* 个别分类拿不到就跳过 */ }
    }
    return { game: g.names?.international || game, gameUrl: g.weblink, items, note: items.length ? "" : "找到游戏但没拿到分类/备注" };
  } catch (e) {
    return { game, items: [], note: `speedrun.com 查询失败：${String(e.message || e)}` };
  }
}

/* ---------- MediaWiki API (Bulbapedia / Wikipedia / Fandom) ---------- */
const MW = {
  bulbapedia: "https://bulbapedia.bulbagarden.net/w/api.php",
  wikipedia: "https://en.wikipedia.org/w/api.php",
};
export async function mediawikiSections(site, title) {
  const base = MW[site];
  if (!base) throw new Error("未知 MediaWiki 站点: " + site);
  // search if title isn't an exact page
  const searched = await httpGet(
    `${base}?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json`,
    { json: true }
  );
  const page = searched.query?.search?.[0]?.title || title;
  const parsed = await httpGet(
    `${base}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json`,
    { json: true }
  );
  const html = parsed.parse?.text?.["*"];
  if (!html) return { page, sections: [] };
  const sections = htmlToSections(html).map((s, i) => ({
    idx: i,
    heading: s.heading,
    level: s.level,
    chars: s.text.length,
    interesting: INTERESTING.test(s.heading),
    preview: s.text.slice(0, 160),
    text: s.text,
  }));
  return { page, url: `https://${new URL(base).host}/wiki/${encodeURIComponent(page)}`, sections };
}

// traced wrappers
export const traced = {
  fetchPageSections: (url) =>
    withTrace("acquire.page", { kind: "web", summary: `fetch ${url}`, input: { url }, output: (r) => ({ sections: r.length }) }, () => fetchPageSections(url)),
  speedrunNotes: (game) =>
    withTrace("acquire.speedrun", { kind: "web", summary: `speedrun ${game}`, input: { game }, output: (r) => ({ items: r.items.length }) }, () => speedrunNotes(game)),
  mediawikiSections: (site, title) =>
    withTrace("acquire.mediawiki", { kind: "web", summary: `${site} ${title}`, input: { site, title }, output: (r) => ({ page: r.page, sections: r.sections.length }) }, () => mediawikiSections(site, title)),
};
