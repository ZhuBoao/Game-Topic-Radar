import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import * as store from "./store.js";
import { runClaudeJson } from "./claude.js";
import * as P from "./prompts.js";
import { generateThumbnail, runOpenAIJsonGrounded } from "./openai.js";
import * as yt from "./youtube.js";
import * as corpus from "./corpus.js";
import * as acquire from "./acquire.js";
import * as discover from "./discover.js";
import * as runs from "./runs.js";
import * as universe from "./universe.js";
import { withTrace, readRecent } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/images", express.static(path.join(__dirname, "images")));

const ok = (res, data) => res.json(data);
const fail = (res, e) => {
  console.error(e);
  res.status(500).json({ error: e.message || String(e) });
};
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => fail(res, e));

// cheap stable hash for dedupe
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

/* ---------- Videos (YouTube) — 基础设施，保留 ---------- */
app.get("/api/youtube/status", (req, res) => ok(res, { connected: yt.isConnected() }));
app.get("/api/youtube/auth", (req, res) => {
  try {
    res.redirect(yt.getAuthUrl());
  } catch (e) {
    fail(res, e);
  }
});
app.get("/oauth2callback", wrap(async (req, res) => {
  await yt.handleCallback(req.query.code);
  res.send("<script>window.close && window.close();</script><p>YouTube 已连接，可关闭此页面返回应用。</p>");
}));
app.post("/api/youtube/disconnect", (req, res) => {
  yt.disconnect();
  ok(res, { connected: false });
});
app.get("/api/videos", (req, res) => ok(res, store.list("videos")));
app.post("/api/videos/refresh", wrap(async (req, res) => {
  const videos = await yt.fetchRecentVideos(20);
  store.replaceAll("videos", videos);
  ok(res, videos);
}));

/* ====================================================================== */
/*  v2 物证驱动管线                                                          */
/* ====================================================================== */

/* ---------- ① 采集：本地语料库 (Tier-1) ---------- */
app.get("/api/corpus/repos", (req, res) => ok(res, corpus.listRepos()));

// git-grep 一个仓库的异常标记，返回候选片段（还不是 source）
app.post("/api/corpus/scan", wrap(async (req, res) => {
  const { repo, limit } = req.body;
  if (!repo) return res.status(400).json({ error: "缺少 repo" });
  const hits = await withTrace(
    "acquire.scan",
    { kind: "corpus", summary: `git grep ${repo}`, input: { repo, limit }, refs: { repo },
      output: (h) => ({ count: h.length, sample: h.slice(0, 5) }) },
    () => corpus.scanRepo(repo, { limit: Number(limit) || 150 })
  );
  ok(res, { repo, game: corpus.gameOf(repo), hits });
}));

// 把一条候选片段（或手动粘贴）纳入 sources
app.post("/api/corpus/ingest", wrap(async (req, res) => {
  const { repo, file, line } = req.body;
  if (!repo || !file || !line) return res.status(400).json({ error: "缺少 repo/file/line" });
  const source = await withTrace(
    "acquire.ingest",
    { kind: "corpus", summary: `ingest ${repo}/${file}:${line}`, input: { repo, file, line }, refs: { repo, file, line } },
    async () => {
      const snip = corpus.readSnippet(repo, file, line);
      const dedupeHash = hash(`${repo}:${file}:${line}`);
      const existing = store.list("sources", (s) => s.dedupeHash === dedupeHash)[0];
      if (existing) return existing;
      const hitLine = snip.lines.find((l) => l.hit);
      return store.insert("sources", {
        kind: "sourcecode",
        sourceTier: "primary",
        fetchedVia: "local-grep",
        repo,
        game: corpus.gameOf(repo),
        file,
        line: Number(line),
        rawQuote: (hitLine?.text || "").trim(),
        snippet: snip.rendered,
        url: "",
        status: "new",
        dedupeHash,
      });
    }
  );
  ok(res, source);
}));

/* ---------- 游戏库 (IP universe)：点选 / AI 扩充 ---------- */
app.get("/api/universe", (req, res) => ok(res, universe.getUniverse()));
app.post("/api/universe", (req, res) => {
  const { name, aliases, series, era, why } = req.body;
  if (!name) return res.status(400).json({ error: "缺少 name" });
  ok(res, store.insert("universe", {
    name, aliases: aliases || [], series: series || "", era: era || "", why: why || "", source: "manual", mined: false,
  }));
});
app.patch("/api/universe/:id", (req, res) => ok(res, store.update("universe", req.params.id, req.body)));
app.delete("/api/universe/:id", (req, res) => { store.remove("universe", req.params.id); ok(res, { ok: true }); });
app.post("/api/universe/expand", wrap(async (req, res) => {
  const { focus } = req.body;
  const existing = universe.names();
  const proposed = await withTrace(
    "universe.expand",
    { kind: "ai", summary: `AI 扩充游戏库 ${focus || ""}`, input: { focus, existingCount: existing.length },
      output: (a) => ({ count: Array.isArray(a) ? a.length : 0 }) },
    () => runClaudeJson(P.pUniverseExpand(existing, focus))
  );
  const have = new Set(existing.map((n) => n.toLowerCase()));
  const added = [];
  for (const g of Array.isArray(proposed) ? proposed : []) {
    if (!g.name || have.has(g.name.toLowerCase())) continue;
    have.add(g.name.toLowerCase());
    added.push(store.insert("universe", {
      name: g.name, aliases: g.aliases || [], series: g.series || "", era: g.era || "", why: g.why || "", source: "ai", mined: false,
    }));
  }
  ok(res, added);
}));

/* ---------- ① 采集：网络源（AI 探源 / 网页 / speedrun / MediaWiki） ---------- */
// AI 探源 = 多源发现流水线。后台异步跑，立刻返回 runId；前端轮询 /api/runs/:id 画 DAG。
// 把一条候选规整成 finding（探源/喂料统一形状），落库进点子池。
function candidateToFinding(game, c, origin) {
  return {
    game: game || "", title: (c.title || "").trim(), claim: c.claim || "", family: c.family || "",
    watchability: Number(c.watchability) || 0,
    evidence: Array.isArray(c.evidence) ? c.evidence : (c.evidence ? [{ quote: String(c.evidence) }] : []),
    url: c.url || "", saturated: !!c.saturated, saturatedNote: c.saturatedNote || "",
    verifyNext: c.verifyNext || "", translationNote: c.translationNote || "",
    origin, status: "new",
  };
}
// 探源完成后：候选【自动进点子池】（按 game+title 去重，重跑同游戏不重复）。
function depositCandidates(game, candidates) {
  const existing = store.list("findings");
  let n = 0;
  for (const c of candidates || []) {
    const title = (c.title || "").trim();
    if (!title) continue;
    if (existing.some((f) => f.game === game && (f.title || "").trim() === title)) continue;
    store.insert("findings", candidateToFinding(game, c, "discovery"));
    n++;
  }
  return n;
}

app.post("/api/acquire/search", (req, res) => {
  const { game, mode } = req.body;
  if (!game) return res.status(400).json({ error: "缺少 game" });
  const run = runs.createRun({ game, angle: mode || "auto", dag: discover.DAG });
  // 把池子里这个游戏已有的点子标题传给 merge，重跑只补【新】点子、不重复
  const excludeTitles = store.list("findings").filter((f) => f.game === game).map((f) => f.title).filter(Boolean);
  discover.discover(game, mode, run, { excludeTitles })
    .then((result) => {
      try { depositCandidates(game, result.candidates); } // 点子自动进池；入池失败不该拖累整跑
      catch (e) { console.error("[deposit] 候选入池失败", e); }
      runs.finishRun(run, { result });
    })
    .catch((e) => runs.finishRun(run, { error: e }));
  ok(res, { runId: run.id });
});

// 手动喂料：贴 URL 或一段文字 → 自动提炼(同探源的 extract) → 点子直接进池。
app.post("/api/feed", wrap(async (req, res) => {
  const { url, text, game } = req.body;
  let snippet = (text || "").trim();
  if (!snippet && url) {
    const m = await acquire.pageMaterial(url, 8000);
    snippet = m.snippet || "";
  }
  if (!snippet) return res.status(400).json({ error: "没有可提炼的内容（URL 抓不到正文，或没贴文字）" });
  const block = `### 手动喂料 ${url || ""}\n` + snippet;
  const raw = await runClaudeJson(
    P.pExtractCandidates(game || "(未指定游戏)", null, [], block),
    { timeoutMs: 300000, model: "claude-sonnet-4-6", effort: "medium" }
  );
  const cands = (Array.isArray(raw) ? raw : []).map((c) => ({ ...c, url: c.url || url || "" }));
  const created = cands.filter((c) => (c.title || "").trim()).map((c) => store.insert("findings", candidateToFinding(game, c, "feed")));
  ok(res, created);
}));
app.get("/api/runs", (req, res) => ok(res, runs.listRuns()));
app.get("/api/runs/:id", (req, res) => {
  const r = runs.getRun(req.params.id);
  if (!r) return res.status(404).json({ error: "run 不存在" });
  ok(res, r);
});

// 抓网页（TCRF / DataCrystal / 采访 / 任意 URL）→ 分节
app.post("/api/acquire/page", wrap(async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "缺少 url" });
  const sections = await acquire.traced.fetchPageSections(url);
  ok(res, { url, sections });
}));

// speedrun.com 备注
app.post("/api/acquire/speedrun", wrap(async (req, res) => {
  const { game } = req.body;
  if (!game) return res.status(400).json({ error: "缺少 game" });
  ok(res, await acquire.traced.speedrunNotes(game));
}));

// MediaWiki（Bulbapedia / Wikipedia）→ 分节
app.post("/api/acquire/mediawiki", wrap(async (req, res) => {
  const { site, title } = req.body;
  if (!site || !title) return res.status(400).json({ error: "缺少 site/title" });
  ok(res, await acquire.traced.mediawikiSections(site, title));
}));

// 从一个 URL 直接抓全文入库为 source（AI 探源的「纳入」走这里，拿到的是实质素材而非短摘录）
app.post("/api/acquire/ingest-url", wrap(async (req, res) => {
  const { url, game, kind, note } = req.body;
  if (!url) return res.status(400).json({ error: "缺少 url" });
  const mat = await withTrace(
    "acquire.ingest-url",
    { kind: "web", summary: `抓正文入库 ${url}`, input: { url },
      output: (m) => ({ chars: m?.snippet?.length || 0, used: m?.used, sections: m?.sectionCount }) },
    () => acquire.pageMaterial(url)
  );
  if (!mat.snippet || mat.snippet.length < 80) {
    return res.status(422).json({ error: "这个页面抓不到可用正文（可能 JS 重 / 反爬）。请打开页面复制，用「手动」tab 粘贴。" });
  }
  const dedupeHash = hash(norm(url));
  const existing = store.list("sources", (s) => s.dedupeHash === dedupeHash)[0];
  if (existing) return ok(res, existing);
  ok(res, store.insert("sources", {
    kind: kind || "web", sourceTier: "primary", fetchedVia: "web", game: game || "",
    url, note: note || "", rawQuote: mat.snippet.slice(0, 200), snippet: mat.snippet, status: "new", dedupeHash,
  }));
}));

/* ---------- sources ---------- */
app.get("/api/sources", (req, res) => ok(res, store.list("sources")));

// 手动喂料（粘贴一段原文 / 一个冷门 URL）
app.post("/api/sources", (req, res) => {
  const { game, kind, url, rawQuote, note } = req.body;
  if (!rawQuote && !url) return res.status(400).json({ error: "至少给一段原文或一个 URL" });
  const dedupeHash = hash(norm(`${url}|${rawQuote}`));
  const existing = store.list("sources", (s) => s.dedupeHash === dedupeHash)[0];
  if (existing) return ok(res, existing);
  ok(res, store.insert("sources", {
    kind: kind || "manual",
    sourceTier: "primary",
    fetchedVia: "manual",
    game: game || "",
    rawQuote: rawQuote || "",
    snippet: rawQuote || "",
    note: note || "",
    url: url || "",
    status: "new",
    dedupeHash,
  }));
});

app.delete("/api/sources/:id", (req, res) => {
  // also drop its findings
  for (const f of store.list("findings", (f) => f.sourceId === req.params.id)) store.remove("findings", f.id);
  store.remove("sources", req.params.id);
  ok(res, { ok: true });
});

/* ---------- ② AI 透镜：source -> findings ---------- */
app.post("/api/sources/:id/lens", wrap(async (req, res) => {
  const source = store.get("sources", req.params.id);
  if (!source) return res.status(404).json({ error: "素材不存在" });
  const snippet = source.snippet || source.rawQuote || "";
  const raw = await withTrace(
    "lens.anomaly",
    { kind: "ai", summary: `透镜 ${source.game} ${source.file || ""}:${source.line || ""}`,
      input: { sourceId: source.id, game: source.game, file: source.file, line: source.line },
      refs: { sourceId: source.id }, output: (arr) => ({ count: arr.length, claims: arr.map((f) => f.claim) }) },
    () => runClaudeJson(P.pAnomaly({
      game: source.game,
      origin: source.repo
        ? `decomp ${source.repo} ${source.file}:${source.line}`
        : source.url
        ? `${source.kind}${source.note ? " · " + source.note : ""} · ${source.url}`
        : source.note || source.kind || "(手动粘贴)",
      snippet,
      hint: source.marker,
    }))
  );
  const arr = Array.isArray(raw) ? raw : [];
  const created = arr.map((f) => {
    const anchor = (f.anchorQuote || "").trim();
    // 比对时连引号字符一起归一化——JSON 规则强制用「」会破坏逐字 substring 匹配
    const clean = (s) => norm(s).replace(/[「」『』《》“”‘’"']/g, "");
    const anchorInSnippet = anchor ? clean(snippet).includes(clean(anchor)) : false;
    return store.insert("findings", {
      sourceId: source.id,
      game: source.game,
      file: source.file || "",
      line: source.line || null,
      lens: f.family || f.lens || "anomaly",
      family: f.family || "",
      claim: f.claim || "",
      anchorQuote: anchor,
      claimZh: f.claimZh || "",
      legend: f.legend || "",
      evidence: f.evidence || "",
      reversal: f.reversal || "",
      aboutGame: f.aboutGame || "",
      draftTitle: f.draftTitle || "",
      hook: f.hook || "",
      watchability: Number(f.watchability) || 0,
      titleTest: f.titleTest || "",
      confidence: f.confidence || "low",
      // 硬门：必须握着原句，且原句确实出现在材料里（防 AI 编造引用）
      qualified: !!anchor && anchorInSnippet,
      anchorInSnippet,
      status: "new",
    });
  });
  store.update("sources", source.id, { status: "triaged" });
  ok(res, created);
}));

/* ---------- findings（点子池：透镜产出 + 探源候选收藏） ---------- */
app.get("/api/findings", (req, res) => {
  const { sourceId } = req.query;
  ok(res, store.list("findings", sourceId ? (f) => f.sourceId === sourceId : null));
});
// 收藏一个探源候选进池（探源候选本身是临时的，收藏才落库当建材）
app.post("/api/findings", (req, res) => {
  const { game, title, hook, why, evidence, url, watchability, kind } = req.body;
  ok(res, store.insert("findings", {
    game: game || "", title: title || "", hook: hook || "", why: why || "",
    evidence: evidence || "", url: url || "", watchability: Number(watchability) || 0,
    kind: kind || "", origin: "discovery", status: "new",
  }));
});
app.delete("/api/findings/:id", (req, res) => {
  store.remove("findings", req.params.id);
  ok(res, { ok: true });
});

/* ---------- ④ episodes（一集/视频 = 手选 findings → AI 导演） ---------- */
app.get("/api/episodes", (req, res) => ok(res, store.list("episodes")));
app.post("/api/episodes", (req, res) =>
  ok(res, store.insert("episodes", { title: req.body.title || "未命名一集", angle: "", coldOpen: "", why10min: "", beats: [], findingIds: req.body.findingIds || [], leftoverIds: [], status: "idea" })));
app.patch("/api/episodes/:id", (req, res) => ok(res, store.update("episodes", req.params.id, req.body)));
app.delete("/api/episodes/:id", (req, res) => { store.remove("episodes", req.params.id); ok(res, { ok: true }); });

app.post("/api/episodes/compose", wrap(async (req, res) => {
  const { findingIds = [], note, episodeId } = req.body;
  const findings = findingIds.map((id) => store.get("findings", id)).filter(Boolean);
  if (findings.length === 0) return res.status(400).json({ error: "先在点子池里勾选几条" });
  // 归一化两种来源(透镜/探源)的字段，给导演看
  const norm = findings.map((f) => ({
    id: f.id, game: f.game || f.aboutGame || "",
    title: f.title || f.draftTitle || f.claim || "(无题)",
    hook: f.hook || "", evidence: f.evidence || f.anchorQuote || "",
  }));
  const draft = await withTrace(
    "episode.compose",
    { kind: "ai", summary: `组集 ${findings.length} 条`, input: norm, output: (d) => d },
    () => runClaudeJson(P.pCompose(norm, note), { timeoutMs: 150000 })
  );
  // findingIndex(1-based) 映射回 findingId
  const beats = (draft.beats || [])
    .map((b) => ({ findingId: norm[(b.findingIndex || 0) - 1]?.id || null, role: b.role || "", oneLine: b.oneLine || "" }))
    .filter((b) => b.findingId);
  const leftoverIds = (draft.leftover || []).map((i) => norm[i - 1]?.id).filter(Boolean);
  const data = {
    title: draft.title || "未命名一集", angle: draft.angle || "", coldOpen: draft.coldOpen || "",
    why10min: draft.why10min || "", beats, findingIds: findings.map((f) => f.id), leftoverIds, status: "idea",
  };
  ok(res, episodeId ? store.update("episodes", episodeId, data) : store.insert("episodes", data));
}));

/* ---------- 留痕：pipeline traces ---------- */
app.get("/api/traces", (req, res) => {
  const { limit, step } = req.query;
  const recs = readRecent(Number(limit) || 120, step ? (r) => r.step === step : null);
  ok(res, recs);
});

/* ====================================================================== */
/*  promote 之后的下游（保留，MVP 暂未在前端接线）                            */
/* ====================================================================== */
app.get("/api/topics", (req, res) => ok(res, store.list("topics")));
app.get("/api/topics/:id", (req, res) => ok(res, store.get("topics", req.params.id)));
app.post("/api/topics", (req, res) => {
  const { description, defaultTitle, sourceIds, findingId } = req.body;
  ok(res, store.insert("topics", {
    description: description || "",
    defaultTitle: defaultTitle || "",
    sourceIds: sourceIds || [],
    findingId: findingId || null,
    status: "idea",
  }));
});
app.patch("/api/topics/:id", (req, res) => ok(res, store.update("topics", req.params.id, req.body)));
app.delete("/api/topics/:id", (req, res) => {
  cascadeDeleteTopic(req.params.id);
  ok(res, { ok: true });
});

app.get("/api/titles", (req, res) => ok(res, store.list("titles", (t) => t.topicId === req.query.topicId)));
app.post("/api/titles", (req, res) => ok(res, store.insert("titles", { topicId: req.body.topicId, text: req.body.text })));
app.patch("/api/titles/:id", (req, res) => ok(res, store.update("titles", req.params.id, req.body)));
app.delete("/api/titles/:id", (req, res) => { store.remove("titles", req.params.id); ok(res, { ok: true }); });

app.get("/api/thumbnails", (req, res) => ok(res, store.list("thumbnails", (t) => t.topicId === req.query.topicId)));
app.post("/api/thumbnails/generate", wrap(async (req, res) => {
  const { topicId, prompt } = req.body;
  const image = await withTrace("thumb.generate", { kind: "ai", summary: "出图", input: { topicId } },
    () => generateThumbnail(prompt));
  ok(res, store.insert("thumbnails", { topicId, prompt, image }));
}));
app.delete("/api/thumbnails/:id", (req, res) => { store.remove("thumbnails", req.params.id); ok(res, { ok: true }); });

app.get("/api/todos", (req, res) => {
  const todos = store.list("todos").map((t) => ({
    ...t,
    title: store.get("titles", t.titleId),
    thumbnail: store.get("thumbnails", t.thumbnailId),
  }));
  ok(res, todos);
});
app.post("/api/todos", (req, res) => {
  const order = store.list("todos").length;
  ok(res, store.insert("todos", { titleId: req.body.titleId, thumbnailId: req.body.thumbnailId, done: false, planDate: null, order }));
});
app.patch("/api/todos/:id", (req, res) => ok(res, store.update("todos", req.params.id, req.body)));
app.delete("/api/todos/:id", (req, res) => { store.remove("todos", req.params.id); ok(res, { ok: true }); });

function cascadeDeleteTopic(topicId) {
  const titles = store.list("titles", (t) => t.topicId === topicId).map((t) => t.id);
  const thumbs = store.list("thumbnails", (t) => t.topicId === topicId).map((t) => t.id);
  for (const todo of store.list("todos")) {
    if (titles.includes(todo.titleId) || thumbs.includes(todo.thumbnailId)) store.remove("todos", todo.id);
  }
  for (const id of titles) store.remove("titles", id);
  for (const id of thumbs) store.remove("thumbnails", id);
  store.remove("topics", topicId);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`后端已启动 http://localhost:${PORT}`));
