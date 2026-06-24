// Pipeline tracing — every step leaves a trace so we can tell which step's
// output didn't meet expectations. Heavy detail (full prompts / raw LLM
// responses) goes to an append-only JSONL file; a tail is exposed via the API.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "pipeline.jsonl");

let seq = 0;
function eid() {
  return Date.now().toString(36) + "-" + (seq++).toString(36);
}

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Short, console-friendly preview of any value.
function brief(v, n = 180) {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s;
}

// Persist one trace record (JSONL) + echo a tagged line to the console.
export function logEvent(ev) {
  ensureDir();
  const rec = { id: eid(), ts: new Date().toISOString(), ...ev };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(rec) + "\n");
  } catch {
    /* logging must never crash the pipeline */
  }
  const status = rec.status ? ` ${rec.status}` : "";
  const ms = rec.ms != null ? ` ${rec.ms}ms` : "";
  console.log(`[${rec.step}]${status}${ms} ${brief(rec.summary)}`);
  return rec;
}

// Wrap a pipeline step: time it, persist input + output + status, rethrow on
// error (after recording it). `meta.output(result)` optionally maps the result
// to what should be stored (e.g. strip blobs). `meta.input` is stored verbatim.
export async function withTrace(step, meta = {}, fn) {
  const start = Date.now();
  console.log(`[${step}] … ${brief(meta.summary)}`);
  try {
    const out = await fn();
    logEvent({
      step,
      status: "ok",
      ms: Date.now() - start,
      kind: meta.kind,
      summary: meta.summary,
      refs: meta.refs,
      input: meta.input,
      output: meta.output ? meta.output(out) : out,
    });
    return out;
  } catch (e) {
    logEvent({
      step,
      status: "error",
      ms: Date.now() - start,
      kind: meta.kind,
      summary: meta.summary,
      refs: meta.refs,
      input: meta.input,
      error: String(e?.message || e),
    });
    throw e;
  }
}

// Most-recent-first tail of the trace log, optionally filtered.
export function readRecent(limit = 100, filter) {
  ensureDir();
  let lines = [];
  try {
    lines = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const recs = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const filtered = filter ? recs.filter(filter) : recs;
  return filtered.slice(-limit).reverse();
}
