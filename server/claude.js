import { spawn } from "child_process";
import os from "os";
import { logEvent } from "./logger.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// Run `claude -p` feeding the prompt via stdin (avoids Windows arg-escaping/
// truncation issues with long multi-line prompts) and return stdout text.
// opts.grounded enables the WebSearch tool so claude verifies facts online.
export function runClaude(prompt, opts = {}) {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs || Number(process.env.CLAUDE_TIMEOUT_MS) || 240000;
  return new Promise((resolve, reject) => {
    const args = ["-p"];
    if (opts.grounded) args.push("--allowedTools", "WebSearch");
    if (opts.model) args.push("--model", opts.model);
    if (opts.fallbackModel) args.push("--fallback-model", opts.fallbackModel);
    if (opts.effort) args.push("--effort", opts.effort);
    // 在中性临时目录里跑：prompt 自包含，绝不要让 nested claude 读到本项目/
    // 其它工作目录(pokecrossroads 等)的 CLAUDE.md/上下文——那会污染游戏解析
    // （曾把"旷野之息"解析成 "Pokémon Crossroads"）。
    const child = spawn(CLAUDE_BIN, args, {
      shell: process.platform === "win32",
      cwd: os.tmpdir(),
    });
    let out = "";
    let err = "";
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const tag = `claude${opts.grounded ? " (web)" : ""}`;
    const timer = setTimeout(() => {
      // shell:true 下 child 是 cmd 包装，SIGKILL 杀不到真正的 claude 孙进程，
      // Windows 用 taskkill /T 杀整棵树，避免留孤儿进程继续占用。
      try {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"]);
        } else {
          child.kill("SIGKILL");
        }
      } catch { /* already gone */ }
      const ms = Date.now() - start;
      logEvent({ step: "llm.claude", status: "error", ms, input: prompt, output: out, error: `timeout ${timeoutMs}ms`, summary: `${tag} 超时` });
      const why = opts.grounded ? "多半是联网搜索卡住了" : "材料太大或多个提炼并发争抢资源";
      finish(() => reject(new Error(`claude 超时（${Math.round(timeoutMs / 1000)}s 没出结果，${why}，请重试或换个游戏）`)));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      logEvent({ step: "llm.claude", status: "error", ms: Date.now() - start, input: prompt, error: String(e?.message || e) });
      finish(() => reject(e));
    });
    child.on("close", (code) => {
      const ms = Date.now() - start;
      if (code !== 0) {
        // 失败时把 stdout/stderr 末尾一并带出来，别再只给一句 "exit 1"
        const detail = (err || out || "").trim().slice(-500);
        logEvent({ step: "llm.claude", status: "error", ms, input: prompt, output: out, error: detail || `exit ${code}`, summary: `${tag} exit ${code}` });
        finish(() => reject(new Error(`claude 退出码 ${code}${detail ? "：" + detail : "（无输出，多半是联网搜索超时/中断，请重试）"}`)));
      } else {
        const text = out.trim();
        logEvent({ step: "llm.claude", status: "ok", ms, input: prompt, output: text, summary: `${tag} → ${text.length}b` });
        finish(() => resolve(text));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Extract the first JSON value (object or array) from claude's text output.
// String-aware: braces/brackets inside string literals don't affect depth.
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("未找到 JSON：" + text.slice(0, 200));
  const open = body[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error("JSON 不完整：" + text.slice(0, 200));
}

export const JSON_RULE = `

重要：只输出严格合法的 JSON，不要有任何多余文字、说明或 markdown。字符串内部如果需要引号，一律使用中文引号「」或书名号《》，绝对不要在字符串里使用未转义的英文双引号 "。`;

// Run claude and parse JSON. Retries, then asks claude to repair its own output.
// opts.grounded lets claude use WebSearch to verify facts.
export async function runClaudeJson(prompt, opts = {}) {
  let lastErr;
  let lastText = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    lastText = await runClaude(prompt + JSON_RULE, opts);
    try {
      return extractJson(lastText);
    } catch (e) {
      lastErr = e;
    }
  }
  // repair pass: hand the malformed output back to claude
  try {
    const fixed = await runClaude(
      `下面的内容本应是 JSON，但格式有误。请只输出修正后的、严格合法的 JSON（字符串里的英文双引号要么转义、要么换成中文引号），不要任何解释或多余文字：\n\n${lastText}`
    );
    return extractJson(fixed);
  } catch (e) {
    lastErr = e;
  }
  throw lastErr;
}
