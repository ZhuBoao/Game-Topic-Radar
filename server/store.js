import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data.json");

// v2 (物证驱动)：sources(一手素材) → findings(透镜产出) 是新漏斗顶点。
// 保留 videos(频道参考) 与 topics/titles/thumbnails/todos(promote 之后的下游)。
// 已删：directions / references / searches / keywords（旧生成式业务逻辑）。
const empty = {
  videos: [],
  universe: [], // 游戏库（IP universe）：可 AI 扩充、点选驱动采集
  sources: [],
  findings: [], // 点子池：透镜产出 + 探源候选(收藏)，episode 的建材
  episodes: [], // 一集/视频：手动选几条 findings → AI 导演成统一角度+钩子+叙事
  topics: [],
  titles: [],
  thumbnails: [],
  todos: [],
};

let db = load();

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return { ...structuredClone(empty), ...JSON.parse(raw) };
  } catch {
    return structuredClone(empty);
  }
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

export function getDb() {
  return db;
}

export function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// generic collection helpers
export function list(coll, filter) {
  const items = db[coll];
  return filter ? items.filter(filter) : items;
}

export function get(coll, itemId) {
  return db[coll].find((x) => x.id === itemId);
}

export function insert(coll, obj) {
  const row = { id: id(), createdAt: new Date().toISOString(), ...obj };
  db[coll].push(row);
  save();
  return row;
}

export function update(coll, itemId, patch) {
  const row = db[coll].find((x) => x.id === itemId);
  if (!row) return null;
  Object.assign(row, patch);
  save();
  return row;
}

export function remove(coll, itemId) {
  const i = db[coll].findIndex((x) => x.id === itemId);
  if (i === -1) return false;
  db[coll].splice(i, 1);
  save();
  return true;
}

// replace entire collection (used for video refresh)
export function replaceAll(coll, rows) {
  db[coll] = rows;
  save();
}
