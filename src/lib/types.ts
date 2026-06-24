// v2 物证驱动管线的类型。旧的 Direction/Trend/Reference/Keyword 等已删。

export interface MyVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  viewCount: number;
  likeCount: number;
  publishedAt: string;
}

// ① 采集：本地语料库
export interface RepoInfo {
  repo: string;
  game: string;
}

// git grep 出来的候选片段（还不是 source）
export interface CorpusHit {
  file: string;
  line: number;
  text: string;
  marker: string;
}

export interface ScanResult {
  repo: string;
  game: string;
  hits: CorpusHit[];
}

// 一手素材（新漏斗顶点）
export interface Source {
  id: string;
  kind: string;
  sourceTier: string;
  fetchedVia: string;
  repo?: string;
  game: string;
  file?: string;
  line?: number;
  rawQuote: string;
  snippet: string;
  url?: string;
  note?: string;
  status: "new" | "triaged" | "promoted" | "dropped";
  createdAt: string;
}

// 游戏库（IP universe）
export interface UniverseGame {
  id: string;
  name: string;
  aliases: string[];
  series: string;
  era: string;
  why: string;
  source: "corpus" | "curated" | "ai" | "manual";
  mined: boolean;
  createdAt: string;
}

// AI 探源候选
export interface EvidenceItem {
  quote: string;
  source_url?: string;
  source_type?: string;
}
export interface DiscoverItem {
  title: string;
  url: string;
  claim?: string;
  family?: string;
  watchability?: number;
  evidence?: EvidenceItem[];
  saturated?: boolean;
  saturatedNote?: string;
  verifyNext?: string;
  translationNote?: string;
  // legacy（旧 run 仍可能有）
  kind?: string;
  why?: string;
  hook?: string;
}
export interface IpProfile {
  fame?: string;
  peak?: string;
  whyFaded?: string;
  confidence?: string;
  needsMetacritic?: boolean;
  note?: string;
}
export interface DiscoverSource {
  source: string;
  label: string;
  ok: boolean;
  count: number;
  error?: string;
}
export interface DiscoverResult {
  plan: { englishName: string; japaneseName?: string; coreCharacters?: { en: string; jp: string }[]; aliases: string[]; webQueries: string[]; profile?: IpProfile; families?: string[] };
  sources: DiscoverSource[];
  candidates: DiscoverItem[];
}

// 发现流水线的"运行"（DAG 可视化）
export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";
export interface RunStep {
  name: string;
  label: string;
  dependsOn: string[];
  status: StepStatus;
  startedAt: string | null;
  endedAt: string | null;
  ms: number | null;
  input: string | null;
  output: string | null;
  count?: number;
  error: string | null;
  logs: { t: string; msg: string }[];
}
export interface RunSummary {
  id: string;
  game: string;
  status: "running" | "done" | "error";
  startedAt: string;
}
export interface Run {
  id: string;
  game: string;
  angle: string;
  status: "running" | "done" | "error";
  startedAt: string;
  endedAt: string | null;
  dag: { name: string; label: string; dependsOn: string[] }[];
  steps: Record<string, RunStep>;
  result: DiscoverResult | null;
  error: string | null;
}

// 网页/MediaWiki 分节
export interface PageSection {
  idx: number;
  heading: string;
  level: number;
  chars: number;
  interesting: boolean;
  preview: string;
  text: string;
}
export interface PageResult {
  url: string;
  sections: PageSection[];
}
export interface MediaWikiResult {
  page: string;
  url?: string;
  sections: PageSection[];
}

// speedrun 备注
export interface SpeedrunItem {
  heading: string;
  url: string;
  text: string;
}
export interface SpeedrunResult {
  game: string;
  gameUrl?: string;
  items: SpeedrunItem[];
  note?: string;
}

export type Lens = "anomaly" | "reversal" | "connection" | "subtraction";

// 点子池里的一个"点"——可能来自透镜(lens)或探源收藏(discovery)，字段并集（多为可选）
export interface Finding {
  id: string;
  game: string;
  status: string;
  createdAt: string;
  origin?: "discovery" | "lens" | string;
  // 透镜路径
  sourceId?: string;
  file?: string;
  line?: number | null;
  lens?: Lens;
  claim?: string;
  anchorQuote?: string;
  claimZh?: string;
  legend?: string;
  reversal?: string;
  aboutGame?: string;
  draftTitle?: string;
  titleTest?: string;
  confidence?: "high" | "medium" | "low";
  qualified?: boolean;
  anchorInSnippet?: boolean;
  // 探源/喂料路径 / 共有
  title?: string;
  hook?: string;
  why?: string;
  evidence?: string | EvidenceItem[];
  url?: string;
  kind?: string;
  watchability?: number;
  // 新统一形状（探源 merge / 喂料 extract 产出）
  family?: string;
  saturated?: boolean;
  saturatedNote?: string;
  verifyNext?: string;
  translationNote?: string;
}

// ④ 一集/视频 = 手选若干 findings → AI 导演成统一角度+钩子+叙事
export interface EpisodeBeat { findingId: string; role: string; oneLine: string; }
export interface Episode {
  id: string;
  title: string;
  angle: string;
  coldOpen: string;
  why10min: string;
  beats: EpisodeBeat[];
  findingIds: string[];
  leftoverIds: string[];
  status: string;
  createdAt: string;
}

// 留痕
export interface Trace {
  id: string;
  ts: string;
  step: string;
  status?: "ok" | "error";
  ms?: number;
  kind?: string;
  summary?: string;
  refs?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  error?: string;
}
