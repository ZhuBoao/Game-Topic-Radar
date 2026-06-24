// 发现流水线的"运行"对象 —— 支撑 Airflow 式 DAG 可视化 + 持久化（刷新/重启都在）。
// 每个 run 预置全部节点为 pending，pipeline 边跑边把节点切到 running/done/error，
// 并记录每步的 input / output / logs / 耗时。落盘到 runs.json，server 重启也保留。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logEvent } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "runs.json");
const KEEP = 20; // 最多保留最近 N 次运行

const runs = new Map();
let seq = 0;
const rid = () => `run_${Date.now().toString(36)}_${(seq++).toString(36)}`;

function trunc(v, n = 18000) {
  if (v == null) return null;
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s.length > n ? s.slice(0, n) + `\n…(+${s.length - n} 字)` : s;
}

// 启动时载入历史；把上次没跑完的（server 被重启打断的）标成中断，别让 DAG 永远转圈。
(function load() {
  try {
    const arr = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    for (const r of arr) {
      if (r.status === "running") {
        r.status = "error";
        r.error = r.error || "服务端重启，该运行被中断";
        for (const st of Object.values(r.steps || {})) {
          if (st.status === "running") st.status = "error";
          else if (st.status === "pending") st.status = "skipped";
        }
      }
      runs.set(r.id, r);
    }
  } catch { /* 没有历史文件，正常 */ }
})();

function persist() {
  try {
    const arr = [...runs.values()].slice(-KEEP);
    fs.writeFileSync(FILE, JSON.stringify(arr));
  } catch { /* 落盘失败不该影响流水线 */ }
}

export function createRun({ game, angle, dag }) {
  const id = rid();
  const steps = {};
  for (const node of dag) {
    steps[node.name] = {
      name: node.name, label: node.label, dependsOn: node.dependsOn || [],
      status: "pending", startedAt: null, endedAt: null, ms: null,
      input: null, output: null, error: null, logs: [],
    };
  }
  const run = {
    id, game, angle: angle || "",
    status: "running", startedAt: new Date().toISOString(), endedAt: null,
    dag: dag.map((n) => ({ name: n.name, label: n.label, dependsOn: n.dependsOn || [] })),
    steps, result: null, error: null,
  };
  runs.set(id, run);
  if (runs.size > KEEP + 10) runs.delete(runs.keys().next().value);
  persist();
  return run;
}

export function getRun(id) { return runs.get(id); }
export function listRuns() {
  return [...runs.values()].slice(-KEEP).reverse()
    .map((r) => ({ id: r.id, game: r.game, status: r.status, startedAt: r.startedAt }));
}

export function stepCtl(run, name) {
  const st = run.steps[name];
  return {
    start(input) {
      st.status = "running"; st.startedAt = new Date().toISOString();
      st.input = input !== undefined ? trunc(input) : null;
      logEvent({ step: `run.${name}`, status: "start", summary: run.game });
      // start 不落盘（在线轮询读内存即可，少写盘）
    },
    log(msg) { st.logs.push({ t: new Date().toISOString(), msg: String(msg) }); },
    done(output) {
      st.status = "done"; st.endedAt = new Date().toISOString();
      st.ms = st.startedAt ? Date.parse(st.endedAt) - Date.parse(st.startedAt) : null;
      // 单独存一份 count（output 过长会被截断导致前端 JSON.parse 取不到计数）
      if (output && typeof output === "object" && typeof output.count === "number") st.count = output.count;
      st.output = output !== undefined ? trunc(output) : null;
      logEvent({ step: `run.${name}`, status: "ok", ms: st.ms, summary: run.game });
      persist();
    },
    fail(err) {
      st.status = "error"; st.endedAt = new Date().toISOString();
      st.ms = st.startedAt ? Date.parse(st.endedAt) - Date.parse(st.startedAt) : null;
      st.error = String(err?.message || err);
      logEvent({ step: `run.${name}`, status: "error", ms: st.ms, error: st.error, summary: run.game });
      persist();
    },
  };
}

export function finishRun(run, { result, error }) {
  run.status = error ? "error" : "done";
  run.endedAt = new Date().toISOString();
  run.result = result || null;
  run.error = error ? String(error?.message || error) : null;
  for (const st of Object.values(run.steps)) {
    if (st.status === "running") st.status = error ? "error" : "done";
    else if (st.status === "pending") st.status = "skipped";
  }
  persist();
}
