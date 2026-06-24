import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  CorpusHit,
  DiscoverItem,
  Episode,
  Finding,
  PageSection,
  RepoInfo,
  Run,
  RunStep,
  RunSummary,
  Source,
  SpeedrunItem,
  Trace,
  UniverseGame,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";

const LENS_LABEL: Record<string, string> = { anomaly: "异常", reversal: "反转", connection: "连接", subtraction: "减法" };
const SOURCE_TAG: Record<string, string> = { corpus: "语料", curated: "策展", ai: "AI", manual: "手动" };

type Mode = "ai" | "manual";
const MODES: { key: Mode; label: string }[] = [
  { key: "ai", label: "探源（自动）" },
  { key: "manual", label: "手动喂料" },
];

export default function WorkbenchPage() {
  const [mode, setMode] = useState<Mode>("ai");
  const [universe, setUniverse] = useState<UniverseGame[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(0);
  const [expandFocus, setExpandFocus] = useState("");
  const [expandBusy, setExpandBusy] = useState(false);
  const [addName, setAddName] = useState("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selFindings, setSelFindings] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const [gameFilter, setGameFilter] = useState("");
  const [err, setErr] = useState("");

  const sel = universe.find((g) => g.id === selId) || null;
  // 点子池按游戏筛选
  const poolGames = [...new Set(findings.map((f) => f.game).filter(Boolean))].sort();
  const shownFindings = gameFilter ? findings.filter((f) => f.game === gameFilter) : findings;

  const reload = useCallback(async () => {
    const [f, e] = await Promise.all([api.findings(), api.episodes()]);
    // 按"会不会有人看"排序，最值得做的在最上面
    setFindings(
      f.slice().sort((a, b) => (b.watchability || 0) - (a.watchability || 0) || (b.createdAt > a.createdAt ? 1 : -1))
    );
    setEpisodes(e.slice().reverse());
  }, []);
  const loadUniverse = useCallback(async () => setUniverse(await api.universe()), []);

  useEffect(() => { loadUniverse(); reload(); }, [loadUniverse, reload]);

  const guard = (fn: () => Promise<void>) => { setErr(""); return fn().catch((e) => setErr(String((e as Error).message || e))); };

  // 🎲 一键自动开挖：挑一个没挖过的游戏 → 切到 AI 探源 → 自动跑
  const autoDig = () => {
    const undug = universe.filter((g) => !g.mined);
    const pool = undug.length ? undug : universe;
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setSelId(pick.id);
    setMode("ai");
    setAutoRun((t) => t + 1);
  };
  const markMined = (id: string) => { api.updateUniverseGame(id, { mined: true }).then(loadUniverse).catch(() => {}); };

  // 手动加一个游戏（秒成，不走 AI）
  const addGame = () => guard(async () => {
    const n = addName.trim();
    if (!n) return;
    const g = await api.addUniverseGame({ name: n, aliases: [n] });
    setAddName("");
    await loadUniverse();
    setSelId(g.id);
  });
  // AI 推荐更多（给一个方向，让 AI 提名一批，慢）
  const expandAI = () => guard(async () => {
    setExpandBusy(true);
    try {
      const added = await api.expandUniverse(expandFocus);
      await loadUniverse();
      if (!added.length) setErr("AI 这次没提名出新游戏（可能都已在库里）。换个方向再试，或用左边「添加游戏」直接加。");
    } finally { setExpandBusy(false); }
  });
  const delGame = (id: string) => guard(async () => {
    await api.delUniverseGame(id);
    if (selId === id) setSelId(null);
    await loadUniverse();
  });

  const delFinding = (id: string) => guard(async () => { await api.deleteFinding(id); await reload(); });

  // 点子池多选 → 组成一集
  const toggleSel = (id: string) =>
    setSelFindings((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const compose = () => guard(async () => {
    if (selFindings.length === 0) return;
    setComposing(true);
    try { await api.composeEpisode(selFindings); setSelFindings([]); await reload(); }
    finally { setComposing(false); }
  });
  const delEpisode = (id: string) => guard(async () => { await api.deleteEpisode(id); await reload(); });
  const renameEpisode = (id: string, title: string) => guard(async () => { await api.updateEpisode(id, { title }); await reload(); });
  const fTitle = (f?: Finding) => (f ? (f.title || f.draftTitle || f.claim || "(无题)") : "(已删)");
  const findingById = (id: string) => findings.find((f) => f.id === id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">物证工作台</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ① 探源（选游戏自动跑）或手动喂料 → 点子自动进【② 点子池】→ 勾几条组成【③ 视频】。
        </p>
      </div>

      {err && <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* 🎮 游戏库 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            🎮 游戏库 · {universe.length}
            <Button size="sm" onClick={autoDig} disabled={!universe.length}>🎲 自动开挖</Button>
          </CardTitle>
          {/* 添加 / AI 推荐 两条分开，别再混淆 */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              className="max-w-[13rem]"
              placeholder="加一个游戏名（如 旷野之息）"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addGame(); }}
            />
            <Button size="sm" variant="outline" onClick={addGame} disabled={!addName.trim()}>＋ 添加</Button>
            <span className="mx-1 text-xs text-muted-foreground">或让 AI 推荐一批：</span>
            <Input className="max-w-[12rem]" placeholder="方向（可选，如 PS1 RPG）" value={expandFocus} onChange={(e) => setExpandFocus(e.target.value)} />
            <Button size="sm" variant="outline" onClick={expandAI} disabled={expandBusy}>
              {expandBusy ? <Spinner className="mr-2" /> : null}AI 推荐更多
            </Button>
            {expandBusy && <span className="text-xs text-muted-foreground">AI 提名中，约 30–60 秒…</span>}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {universe.map((g) => (
              <div
                key={g.id}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-sm ${
                  selId === g.id ? "border-primary bg-primary/10 ring-1 ring-primary" : ""
                }`}
              >
                <button onClick={() => setSelId(g.id)} title={g.why} className="text-left">
                  <span className="font-medium">{g.aliases?.[0] || g.name}</span>
                  {g.series && <span className="ml-1 text-xs text-muted-foreground">{g.series}</span>}
                  <span className="ml-1 text-[10px] text-muted-foreground">{SOURCE_TAG[g.source] || g.source}</span>
                  {g.mined && <span className="ml-1 text-[10px] text-green-600">✓</span>}
                </button>
                <button
                  onClick={() => delGame(g.id)}
                  title="从游戏库删除"
                  className="px-1 text-muted-foreground hover:text-red-600"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {sel && (
            <div className="mt-3 rounded-md bg-muted p-2 text-sm">
              <span className="font-medium">{sel.name}</span>
              {sel.aliases?.length ? <span className="text-muted-foreground"> · {sel.aliases.join(" / ")}</span> : null}
              {sel.era && <span className="text-muted-foreground"> · {sel.era}</span>}
              {sel.why && <div className="text-xs text-muted-foreground">为什么值得挖：{sel.why}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ① 采集 */}
      <Card>
        <CardHeader>
          <CardTitle>① 采集{sel ? ` · ${sel.aliases?.[0] || sel.name}` : ""}</CardTitle>
          <div className="mt-2 flex flex-wrap gap-1">
            {MODES.map((m) => (
              <button key={m.key} onClick={() => setMode(m.key)}
                className={`rounded-md px-3 py-1 text-sm ${mode === m.key ? "bg-primary text-primary-foreground" : "border hover:bg-accent"}`}>
                {m.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {mode === "ai" && <AcquireAI game={sel} autoRun={autoRun} onIngest={reload} onSearched={markMined} setErr={setErr} />}
          {mode === "manual" && <AcquireManual game={sel} onIngest={reload} setErr={setErr} />}
        </CardContent>
      </Card>

      {/* ② 点子池：探源/喂料的点子【自动进这里】；勾选几条 → 组成一集（可跨游戏） */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            ② 点子池 · {gameFilter ? `${shownFindings.length}/${findings.length}` : findings.length}
            {poolGames.length > 1 && (
              <select value={gameFilter} onChange={(e) => setGameFilter(e.target.value)}
                className="h-8 max-w-[16rem] rounded-md border bg-background px-2 text-sm font-normal">
                <option value="">全部游戏</option>
                {poolGames.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <span className="text-xs font-normal text-muted-foreground">勾选几条（可跨游戏）→</span>
            <Button size="sm" onClick={compose} disabled={composing || selFindings.length === 0}>
              {composing ? <Spinner className="mr-2" /> : null}组成一集（{selFindings.length}）
            </Button>
            {selFindings.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelFindings([])}>清空选择</Button>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {findings.length === 0 && <p className="text-sm text-muted-foreground">池子空。上面「探源」一个游戏、或「手动喂料」贴个链接/文字——点子会自动落到这里。</p>}
          {findings.length > 0 && shownFindings.length === 0 && <p className="text-sm text-muted-foreground">《{gameFilter}》在池子里没有点子。<button className="text-blue-600 underline" onClick={() => setGameFilter("")}>看全部</button></p>}
          {shownFindings.map((f) => {
            const w = f.watchability || 0;
            const wCls = w >= 4 ? "border-green-500 text-green-700" : w === 3 ? "border-amber-500 text-amber-700" : "border-red-400 text-red-600";
            const checked = selFindings.includes(f.id);
            const ev = Array.isArray(f.evidence) ? f.evidence : (f.evidence ? [{ quote: String(f.evidence) }] : []);
            const originLabel = f.origin === "discovery" ? "探源" : f.origin === "feed" ? "喂料" : (LENS_LABEL[f.lens || ""] ? "透镜·" + LENS_LABEL[f.lens || ""] : "透镜");
            return (
              <div key={f.id} className={`flex gap-2 rounded-md border p-3 ${checked ? "border-primary bg-primary/5" : ""} ${w > 0 && w <= 2 ? "opacity-60" : ""}`}>
                <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={() => toggleSel(f.id)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {w > 0 && <Badge variant="outline" className={wCls}>想看度 {w}/5</Badge>}
                    <Badge variant="secondary">{originLabel}</Badge>
                    {f.family && <Badge>{FAMILY_LABEL[f.family] || f.family}</Badge>}
                    {f.saturated && <Badge variant="outline" className="border-orange-500 text-orange-700">英文区已做烂</Badge>}
                    {f.game && <span className="text-xs text-muted-foreground">{f.game}</span>}
                    {f.lens && f.qualified === false && <Badge variant="outline" className="border-red-400 text-red-600">✗ {f.anchorInSnippet ? "无原句" : "原句疑似编造"}</Badge>}
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => delFinding(f.id)}>删除</Button>
                  </div>
                  <div className="mt-1 font-medium">{fTitle(f)}</div>
                  {(f.claim || f.hook) && <div className="mt-1 text-sm"><span className="font-medium">论断：</span>{f.claim || f.hook}</div>}
                  {ev.slice(0, 3).map((e, i) => (
                    <div key={i} className="mt-1 text-xs text-muted-foreground">证据：{e.quote}
                      {e.source_url && <a href={e.source_url} target="_blank" rel="noreferrer" className="ml-1 text-blue-600 underline">[源]</a>}
                    </div>
                  ))}
                  {f.anchorQuote && <pre className="mt-1 overflow-auto rounded bg-amber-50 p-1.5 font-mono text-xs whitespace-pre-wrap text-amber-900">{f.anchorQuote}</pre>}
                  {f.saturated && f.saturatedNote && <div className="mt-1 text-xs text-orange-700">⚠ {f.saturatedNote}</div>}
                  {f.verifyNext && <div className="mt-1 text-xs text-muted-foreground">坐实下一步：{f.verifyNext}</div>}
                  {f.translationNote && <div className="mt-1 text-xs text-muted-foreground">翻译：{f.translationNote}</div>}
                  {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">出处</a>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ③ 视频：组好的一集（可编辑） */}
      <Card>
        <CardHeader><CardTitle>③ 视频 · {episodes.length}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {episodes.length === 0 && <p className="text-sm text-muted-foreground">还没有成集。去 ② 勾几条点 → 组成一集。</p>}
          {episodes.map((ep) => (
            <div key={ep.id} className="rounded-md border p-3">
              <div className="flex items-center gap-2">
                <input
                  defaultValue={ep.title}
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value !== ep.title) renameEpisode(ep.id, e.target.value.trim()); }}
                  className="flex-1 rounded-md border bg-background px-2 py-1 text-base font-semibold"
                />
                <Button size="sm" variant="ghost" onClick={() => delEpisode(ep.id)}>删除</Button>
              </div>
              {ep.angle && <div className="mt-2 text-sm"><span className="font-medium">母题：</span>{ep.angle}</div>}
              {ep.coldOpen && <div className="mt-1 rounded bg-amber-50 p-2 text-sm text-amber-900"><span className="font-medium">开场钩子：</span>{ep.coldOpen}</div>}
              {ep.beats?.length > 0 && (
                <ol className="mt-2 space-y-1">
                  {ep.beats.map((b, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <Badge variant="outline" className="shrink-0">{b.role}</Badge>
                      <div className="min-w-0">
                        <span className="font-medium">{fTitle(findingById(b.findingId))}</span>
                        {b.oneLine && <span className="text-muted-foreground"> — {b.oneLine}</span>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {ep.why10min && <div className="mt-2 text-xs text-muted-foreground">够不够10分钟：{ep.why10min}</div>}
              {ep.leftoverIds?.length > 0 && (
                <div className="mt-1 text-xs text-amber-700">建议拿掉：{ep.leftoverIds.map((id) => fTitle(findingById(id))).join("、")}</div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <TracePanel />
    </div>
  );
}

type PanelProps = { game?: UniverseGame | null; onIngest: () => void; setErr: (s: string) => void };
const useGuard = (setErr: (s: string) => void) => (fn: () => Promise<void>) => { setErr(""); return fn().catch((e) => setErr(String((e as Error).message || e))); };
const NeedGame = () => <p className="text-sm text-muted-foreground">先从上面的「游戏库」点一个游戏（或点 🎲 自动开挖）。</p>;

/* ---------- AI 探源 ---------- */
// 切入方式（不止考古）；auto = 让 AI 按 IP 画像自己挑
const FAMILIES: { key: string; label: string }[] = [
  { key: "auto", label: "自动(按IP画像)" },
  { key: "nostalgia", label: "怀旧回顾" },
  { key: "ip-history", label: "IP兴衰史" },
  { key: "reappraisal", label: "再评价/翻案" },
  { key: "archaeology", label: "考古(glitch/被砍)" },
  { key: "design", label: "设计向论点" },
  { key: "story", label: "剧情解析" },
];
const FAMILY_LABEL: Record<string, string> = {
  nostalgia: "怀旧回顾", "ip-history": "IP兴衰史", reappraisal: "再评价", archaeology: "考古", design: "设计向", story: "剧情",
};
const FAME_LABEL: Record<string, string> = {
  evergreen: "常青大作", nostalgic: "怀旧褪色", niche: "小众/cult", obscure: "冷门",
};
function AcquireAI({ game, autoRun, onIngest, onSearched, setErr }: PanelProps & { autoRun: number; onSearched: (id: string) => void }) {
  const guard = useGuard(setErr);
  const mode = "auto"; // 切入方式已移除——auto 按 IP 画像自挑，料少的游戏强行指定角度也出不来
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);

  const loadHistory = useCallback(() => { api.runsList().then(setHistory).catch(() => {}); }, []);

  // 挂载时：恢复上次的 run（刷新不丢）+ 拉历史
  useEffect(() => {
    loadHistory();
    const last = localStorage.getItem("topic.lastRunId");
    if (last) { setRunId(last); }
  }, [loadHistory]);

  const start = useCallback(() => guard(async () => {
    if (!game) return;
    setRun(null); setSel(null);
    const { runId } = await api.startSearch(game.name, mode);
    setRunId(runId);
    localStorage.setItem("topic.lastRunId", runId);
    loadHistory();
    onSearched(game.id);
  }), [game, mode]); // eslint-disable-line

  useEffect(() => { if (autoRun > 0 && game) start(); }, [autoRun]); // eslint-disable-line

  // 轮询 run 状态，驱动 DAG
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let fails = 0;
    const tick = async () => {
      try {
        const r = await api.getRun(runId);
        if (!alive) return;
        fails = 0;
        setRun(r);
        if (r.status !== "running") { loadHistory(); onIngest(); return; } // 点子已自动进池，刷新②
      } catch {
        // 拉不到（多半是这个 run 已被清掉）：重试一两次就放弃，别无限转圈卡住按钮
        if (!alive) return;
        if (++fails >= 2) {
          if (localStorage.getItem("topic.lastRunId") === runId) localStorage.removeItem("topic.lastRunId");
          setRunId(null);
          setRun(null);
          return;
        }
      }
      if (alive) setTimeout(tick, 1500);
    };
    tick();
    return () => { alive = false; };
  }, [runId, loadHistory, onIngest]);

  const pickRun = (id: string) => { setRun(null); setSel(null); setRunId(id); localStorage.setItem("topic.lastRunId", id); };

  const result = run?.result;

  if (!game) return <NeedGame />;
  const busy = run?.status === "running" || (!!runId && !run);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={start} disabled={busy}>{busy ? <Spinner className="mr-2" /> : null}探源</Button>
        {busy && <span className="text-xs text-muted-foreground">运行中，下面实时看进度（不用干等）</span>}
      </div>
      <p className="text-xs text-muted-foreground">自动按这个 IP 的画像（常青/怀旧褪色/小众…）挑最能出货的角度——冷门 IP 不会硬塞 glitch。重跑同一游戏只会补【新】点子，不重复。</p>

      {history.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">历史运行：</span>
          <select value={runId || ""} onChange={(e) => e.target.value && pickRun(e.target.value)}
            className="h-8 max-w-[22rem] rounded-md border bg-background px-2">
            <option value="">（刷新后/随时切回看某次 DAG）</option>
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {h.game} · {h.status === "done" ? "✓" : h.status === "error" ? "✗" : "…"} · {new Date(h.startedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </div>
      )}

      {run && <DagView run={run} sel={sel} onSel={setSel} />}
      {run?.status === "error" && <p className="text-sm text-red-600">流水线出错：{run.error}（点上面红色节点看详情）</p>}

      {result && run?.status === "done" && (
        result.candidates.length === 0
          ? <p className="text-sm text-muted-foreground">这些源没提炼出够格的选题（宁缺毋滥）。看 DAG 里哪个源 ✗ 了，或换游戏 / 角度。</p>
          : <p className="text-sm text-green-700">✓ 本次探出 {result.candidates.length} 条点子，已自动进【② 点子池】——下面去删/选/组视频。</p>
      )}
    </div>
  );
}

const STEP_ICON: Record<string, string> = { pending: "○", running: "●", done: "✓", error: "✗", skipped: "–" };
function stepCls(s: string) {
  return s === "done" ? "border-green-500 bg-green-50"
    : s === "running" ? "border-blue-500 bg-blue-50 animate-pulse"
    : s === "error" ? "border-red-400 bg-red-50"
    : s === "skipped" ? "border-muted bg-muted text-muted-foreground"
    : "border-dashed text-muted-foreground";
}
function StepNode({ step, sel, onSel }: { step: RunStep; sel: string | null; onSel: (s: string | null) => void }) {
  let count: number | undefined = step.count;
  if (count == null) try { const o = step.output && JSON.parse(step.output); if (o && typeof o.count === "number") count = o.count; } catch { /* output 不是 JSON */ }
  return (
    <button onClick={() => onSel(sel === step.name ? null : step.name)}
      className={`rounded-md border px-2 py-1 text-left text-xs ${stepCls(step.status)} ${sel === step.name ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-center gap-1"><span>{STEP_ICON[step.status] || "○"}</span><span className="font-medium">{step.label}</span></div>
      <div className="text-[10px] opacity-70">
        {step.status === "running" ? "运行中…" : step.ms != null ? `${(step.ms / 1000).toFixed(1)}s` : ""}
        {count != null ? ` · ${count}条` : ""}
      </div>
    </button>
  );
}
function DagView({ run, sel, onSel }: { run: Run; sel: string | null; onSel: (s: string | null) => void }) {
  const s = run.steps;
  const sourceKeys = ["interview_en", "interview_jp", "bigchannel", "writeups", "tcrf"];
  const gatherKeys = sourceKeys.map((k) => "g_" + k);
  const extractKeys = sourceKeys.map((k) => "x_" + k);
  const selStep = sel ? s[sel] : null;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">发现流水线 DAG</span>
        <Badge variant="outline">{run.status === "running" ? "运行中" : run.status === "done" ? "完成" : "出错"}</Badge>
        <span className="text-muted-foreground">
          {run.game} → {run.result?.plan.englishName || "解析中…"}
          {run.result?.plan.japaneseName ? ` / ${run.result.plan.japaneseName}` : ""}
        </span>
      </div>
      {run.result?.plan.profile && (
        <div className="rounded bg-muted/50 p-2 text-xs">
          <span className="font-medium">IP 画像：</span>
          {run.result.plan.profile.confidence === "low" && <span className="text-amber-700">⚠ 身份不确定（建议补英文名再跑）· </span>}
          {FAME_LABEL[run.result.plan.profile.fame || ""] || run.result.plan.profile.fame}
          {run.result.plan.profile.peak ? ` · 巅峰 ${run.result.plan.profile.peak}` : ""}
          {run.result.plan.profile.whyFaded ? ` · 褪色：${run.result.plan.profile.whyFaded}` : ""}
          {run.result.plan.families?.length ? (
            <span className="ml-1">→ 切入：{run.result.plan.families.map((f) => FAMILY_LABEL[f] || f).join(" / ")}</span>
          ) : null}
          {run.result.plan.profile.note && <div className="text-muted-foreground">{run.result.plan.profile.note}</div>}
          {run.result.plan.coreCharacters?.length ? (
            <div className="text-muted-foreground">核心角色：{run.result.plan.coreCharacters.map((c) => c.jp ? `${c.en}/${c.jp}` : c.en).join("、")}</div>
          ) : null}
        </div>
      )}
      {s.plan && <div className="flex"><div className="w-full sm:w-72"><StepNode step={s.plan} sel={sel} onSel={onSel} /></div></div>}
      <div className="text-center text-[10px] text-muted-foreground">↓ 并行采集（5 源）</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {gatherKeys.map((n) => s[n] && <StepNode key={n} step={s[n]} sel={sel} onSel={onSel} />)}
      </div>
      <div className="text-center text-[10px] text-muted-foreground">↓ 每源独立提炼</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {extractKeys.map((n) => s[n] && <StepNode key={n} step={s[n]} sel={sel} onSel={onSel} />)}
      </div>
      <div className="text-center text-[10px] text-muted-foreground">↓ 合并去重排序</div>
      {s.merge && <div className="flex"><div className="w-full sm:w-72"><StepNode step={s.merge} sel={sel} onSel={onSel} /></div></div>}

      {selStep && (
        <div className="space-y-1 rounded border bg-muted/40 p-2 text-xs">
          <div className="font-medium">
            {selStep.label} · {selStep.status}{selStep.ms != null ? ` · ${(selStep.ms / 1000).toFixed(1)}s` : ""}
          </div>
          {selStep.error && <div className="text-red-600">error: {selStep.error}</div>}
          {selStep.logs.length > 0 && (
            <div>logs:<pre className="whitespace-pre-wrap">{selStep.logs.map((l) => l.msg).join("\n")}</pre></div>
          )}
          {selStep.input && <details><summary className="cursor-pointer">input</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap">{selStep.input}</pre></details>}
          {selStep.output && <details><summary className="cursor-pointer">output</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap">{selStep.output}</pre></details>}
        </div>
      )}
    </div>
  );
}

/* ---------- 抓网页 ---------- */
function AcquireWeb({ game, onIngest, setErr }: PanelProps) {
  const guard = useGuard(setErr);
  const [url, setUrl] = useState("");
  const [sections, setSections] = useState<PageSection[]>([]);
  const [busy, setBusy] = useState(false);
  const run = () => guard(async () => {
    if (!url.trim()) return;
    setBusy(true);
    try { setSections((await api.fetchPage(url)).sections); } finally { setBusy(false); }
  });
  const take = (s: PageSection) => guard(async () => {
    await api.addManualSource({ game: game?.name, kind: "web", url, rawQuote: s.text, note: s.heading });
    onIngest();
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input className="flex-1 min-w-[18rem]" placeholder="URL（TCRF / DataCrystal / 采访 / 任意页）" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button onClick={run} disabled={busy || !url.trim()}>{busy ? <Spinner className="mr-2" /> : null}抓取</Button>
      </div>
      {sections.length > 0 && <p className="text-xs text-muted-foreground">{sections.length} 节，🔶=标题含 unused/cut/debug/regional 等</p>}
      <div className="max-h-80 space-y-1 overflow-auto">
        {sections.map((s) => (
          <div key={s.idx} className="flex items-start gap-2 rounded border px-2 py-1">
            {s.interesting && <span title="可能有料">🔶</span>}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{s.heading} <span className="text-xs text-muted-foreground">({s.chars}字)</span></div>
              <div className="truncate text-xs text-muted-foreground">{s.preview}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => take(s)}>纳入</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- speedrun ---------- */
function AcquireSpeedrun({ game, onIngest, setErr }: PanelProps) {
  const guard = useGuard(setErr);
  const [items, setItems] = useState<SpeedrunItem[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = () => guard(async () => {
    if (!game) return;
    setBusy(true);
    try { const r = await api.speedrun(game.name); setItems(r.items); setNote(r.note || ""); }
    finally { setBusy(false); }
  });
  const take = (it: SpeedrunItem) => guard(async () => {
    await api.addManualSource({ game: game?.name, kind: "speedrun", url: it.url, rawQuote: it.text, note: it.heading });
    onIngest();
  });
  if (!game) return <NeedGame />;
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-dashed bg-muted/40 p-2 text-xs text-muted-foreground">
        将用英文官方名 <b>{game.name}</b> 查 speedrun.com 的 verified run 备注（跑法/glitch/版本绑定 bug）。
      </div>
      <Button onClick={run} disabled={busy}>{busy ? <Spinner className="mr-2" /> : null}查询备注</Button>
      {note && <p className="text-xs text-amber-700">{note}</p>}
      {items.map((it, i) => (
        <div key={i} className="rounded border p-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{it.heading}</span>
            {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">run</a>}
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => take(it)}>纳入</Button>
          </div>
          <div className="mt-1 max-h-24 overflow-auto text-xs text-muted-foreground whitespace-pre-wrap">{it.text}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- 代码·验证 ---------- */
function AcquireCode({ onIngest, setErr }: PanelProps) {
  const guard = useGuard(setErr);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [repo, setRepo] = useState("");
  const [hits, setHits] = useState<CorpusHit[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.repos().then((r) => { setRepos(r); if (r[0]) setRepo(r[0].repo); }); }, []);
  const run = () => guard(async () => { setBusy(true); try { setHits((await api.scan(repo, 200)).hits); } finally { setBusy(false); } });
  const take = (h: CorpusHit) => guard(async () => { await api.ingest(repo, h.file, h.line); onIngest(); });
  return (
    <div className="space-y-3">
      <p className="text-xs text-amber-700">⚠️ 代码 grep 99% 是逆向噪音，仅用来"验证"已有论断，别从这发现选题。</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={repo} onChange={(e) => setRepo(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
          {repos.map((r) => <option key={r.repo} value={r.repo}>{r.game}（{r.repo}）</option>)}
        </select>
        <Button onClick={run} disabled={busy || !repo}>{busy ? <Spinner className="mr-2" /> : null}扫描标记</Button>
        {hits.length > 0 && <span className="text-sm text-muted-foreground">{hits.length} 条</span>}
      </div>
      <div className="max-h-72 space-y-1 overflow-auto">
        {hits.map((h) => (
          <div key={`${h.file}:${h.line}`} className="flex items-start gap-2 rounded border px-2 py-1">
            <Badge variant="secondary">{h.marker}</Badge>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs text-muted-foreground">{h.file}:{h.line}</div>
              <div className="truncate font-mono text-xs">{h.text}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => take(h)}>纳入</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 手动 ---------- */
function AcquireManual({ game: selGame, onIngest, setErr }: PanelProps) {
  const guard = useGuard(setErr);
  const [game, setGame] = useState(selGame?.name || "");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const feed = () => guard(async () => {
    if (!text.trim() && !url.trim()) return;
    setBusy(true); setMsg("");
    try {
      const created = await api.feed({ game: (game || selGame?.name || "").trim(), url: url.trim(), text: text.trim() });
      setText(""); setUrl(""); onIngest();
      setMsg(`✓ 提炼出 ${created.length} 条点子，已进【② 点子池】`);
    } finally { setBusy(false); }
  });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">贴个链接、或粘一段一手原文 → 自动提炼成点子直接进池（和探源同一套提炼，自己读不了的日文也会翻）。</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="游戏名（可选，默认用左边选中的）" value={game} onChange={(e) => setGame(e.target.value)} />
        <Input placeholder="来源 URL（贴链接它会自己抓正文）" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <Textarea placeholder="或直接把一手原文粘到这里…" value={text} onChange={(e) => setText(e.target.value)} />
      <Button onClick={feed} disabled={busy}>{busy ? <Spinner className="mr-2" /> : null}提炼成点子</Button>
      {msg && <p className="text-xs text-green-700">{msg}</p>}
    </div>
  );
}

function TracePanel() {
  const [open, setOpen] = useState(false);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const load = useCallback(() => { api.traces(120).then(setTraces).catch(() => {}); }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <button className="text-left" onClick={() => setOpen((o) => !o)}>留痕 · pipeline traces {open ? "▾" : "▸"}</button>
          {open && <Button size="sm" variant="outline" onClick={load}>刷新</Button>}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-1">
          {traces.length === 0 && <p className="text-sm text-muted-foreground">暂无 trace。</p>}
          {traces.map((t) => (
            <div key={t.id} className="rounded border text-xs">
              <button className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent" onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                <span className={t.status === "error" ? "font-medium text-red-600" : "font-medium text-green-700"}>{t.status || "·"}</span>
                <span className="font-mono">{t.step}</span>
                {t.ms != null && <span className="text-muted-foreground">{t.ms}ms</span>}
                <span className="truncate text-muted-foreground">{t.summary}</span>
                <span className="ml-auto text-muted-foreground">{new Date(t.ts).toLocaleTimeString()}</span>
              </button>
              {expanded === t.id && (
                <div className="space-y-1 border-t bg-muted/40 p-2">
                  {t.error && <div className="text-red-600">error: {t.error}</div>}
                  {t.input !== undefined && (
                    <details><summary className="cursor-pointer">input</summary>
                      <pre className="overflow-auto whitespace-pre-wrap">{typeof t.input === "string" ? t.input : JSON.stringify(t.input, null, 2)}</pre>
                    </details>
                  )}
                  {t.output !== undefined && (
                    <details><summary className="cursor-pointer">output</summary>
                      <pre className="overflow-auto whitespace-pre-wrap">{typeof t.output === "string" ? t.output : JSON.stringify(t.output, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
