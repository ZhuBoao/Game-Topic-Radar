import type {
  CorpusHit,
  Episode,
  Finding,
  MediaWikiResult,
  MyVideo,
  PageResult,
  RepoInfo,
  Run,
  RunSummary,
  ScanResult,
  Source,
  SpeedrunResult,
  Trace,
  UniverseGame,
} from "./types";

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `请求失败 ${res.status}`);
  }
  return res.json();
}

const get = <T>(u: string) => req<T>(u);
const post = <T>(u: string, body?: unknown) =>
  req<T>(u, { method: "POST", body: JSON.stringify(body ?? {}) });
const patch = <T>(u: string, body: unknown) =>
  req<T>(u, { method: "PATCH", body: JSON.stringify(body) });
const del = (u: string) => req<{ ok: boolean }>(u, { method: "DELETE" });

export const api = {
  // videos (channel reference)
  videos: () => get<MyVideo[]>("/api/videos"),
  refreshVideos: () => post<MyVideo[]>("/api/videos/refresh"),

  // 游戏库
  universe: () => get<UniverseGame[]>("/api/universe"),
  expandUniverse: (focus?: string) => post<UniverseGame[]>("/api/universe/expand", { focus }),
  addUniverseGame: (g: Partial<UniverseGame>) => post<UniverseGame>("/api/universe", g),
  updateUniverseGame: (id: string, p: Partial<UniverseGame>) =>
    patch<UniverseGame>(`/api/universe/${id}`, p),
  delUniverseGame: (id: string) => del(`/api/universe/${id}`),

  // ① 采集：发现流水线（异步 + DAG 可视化）
  startSearch: (game: string, mode?: string) =>
    post<{ runId: string }>("/api/acquire/search", { game, mode }),
  // 手动喂料：URL/文字 → 自动提炼成点子直接进池
  feed: (p: { game?: string; url?: string; text?: string }) =>
    post<Finding[]>("/api/feed", p),
  getRun: (id: string) => get<Run>(`/api/runs/${id}`),
  runsList: () => get<RunSummary[]>("/api/runs"),
  fetchPage: (url: string) => post<PageResult>("/api/acquire/page", { url }),
  ingestUrl: (p: { url: string; game?: string; kind?: string; note?: string }) =>
    post<Source>("/api/acquire/ingest-url", p),
  speedrun: (game: string) => post<SpeedrunResult>("/api/acquire/speedrun", { game }),
  mediawiki: (site: string, title: string) =>
    post<MediaWikiResult>("/api/acquire/mediawiki", { site, title }),

  // ① 采集：本地代码（Tier-1，验证用）
  repos: () => get<RepoInfo[]>("/api/corpus/repos"),
  scan: (repo: string, limit?: number) =>
    post<ScanResult>("/api/corpus/scan", { repo, limit }),
  ingest: (repo: string, file: string, line: number) =>
    post<Source>("/api/corpus/ingest", { repo, file, line }),

  // sources
  sources: () => get<Source[]>("/api/sources"),
  addManualSource: (s: { game?: string; kind?: string; url?: string; rawQuote?: string; note?: string }) =>
    post<Source>("/api/sources", s),
  deleteSource: (id: string) => del(`/api/sources/${id}`),

  // ② 透镜
  runLens: (sourceId: string) => post<Finding[]>(`/api/sources/${sourceId}/lens`),

  // findings（点子池）
  findings: (sourceId?: string) =>
    get<Finding[]>(`/api/findings${sourceId ? `?sourceId=${sourceId}` : ""}`),
  saveFinding: (f: Partial<Finding>) => post<Finding>("/api/findings", f), // 收藏探源候选进池
  deleteFinding: (id: string) => del(`/api/findings/${id}`),

  // ④ episodes（一集/视频）
  episodes: () => get<Episode[]>("/api/episodes"),
  composeEpisode: (findingIds: string[], note?: string, episodeId?: string) =>
    post<Episode>("/api/episodes/compose", { findingIds, note, episodeId }),
  updateEpisode: (id: string, p: Partial<Episode>) => patch<Episode>(`/api/episodes/${id}`, p),
  deleteEpisode: (id: string) => del(`/api/episodes/${id}`),

  // 留痕
  traces: (limit?: number, step?: string) =>
    get<Trace[]>(`/api/traces?limit=${limit ?? 120}${step ? `&step=${step}` : ""}`),
};

export type { CorpusHit };
