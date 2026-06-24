// Tier-1 local corpus: cloned decompilation / disassembly / source-release repos.
// Acquisition = git-grep the source for "anomaly markers" (unused/debug/TODO/…),
// returning candidate excerpts with file:line. The creator (or the AI lens) then
// picks which excerpts become `sources`. Zero network, highest signal density.
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const CORPUS_DIR = process.env.CORPUS_DIR || "C:/Users/Leonardo/dev/corpus/tier1";

// repo dir name -> human game name (auto-fills source.game on ingest)
const REPO_GAME = {
  pokered: "宝可梦 红/蓝 (Gen 1)",
  DOOM: "DOOM (1993)",
  "Quake-III-Arena": "Quake III Arena",
  sm64: "超级马里奥64",
  oot: "塞尔达传说 时之笛",
  mgs_reversing: "合金装备 (MGS1)",
  "sotn-decomp": "恶魔城 月下夜想曲",
  "silent-hill-decomp": "寂静岭 (1999)",
  s2disasm: "索尼克2",
  smb3: "超级马里奥兄弟3",
  ff6: "最终幻想6",
  dkdasm: "大金刚 (街机)",
  devilution: "暗黑破坏神 (1996)",
  CnC_Red_Alert: "命令与征服 红色警戒",
  s1disasm: "索尼克1",
  "frogger-psx": "青蛙过河 (1997)",
};

// High-signal anomaly markers. Passed as repeated `-e` plain words (no regex
// metachars, no spaces) so spawning git under cmd.exe on Windows stays safe.
const MARKERS = [
  "unused", "leftover", "stub", "debug", "TODO", "FIXME", "HACK",
  "kludge", "disabled", "deprecated", "placeholder", "prototype",
  "hardcoded", "workaround", "glitch",
];

export function corpusDir() {
  return CORPUS_DIR;
}

export function gameOf(repo) {
  return REPO_GAME[repo] || repo;
}

export function listRepos() {
  let names = [];
  try {
    names = fs
      .readdirSync(CORPUS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  return names.map((name) => ({ repo: name, game: gameOf(name) }));
}

// git-grep the repo for anomaly markers. Returns {file, line, text, marker}.
// Caps per-file hits so results spread across many files instead of flooding
// from one. git grep exits 1 on "no matches" — that is not an error.
export function scanRepo(repo, { limit = 150, perFile = 4 } = {}) {
  const dir = path.join(CORPUS_DIR, repo);
  if (!fs.existsSync(dir)) return Promise.reject(new Error("仓库不存在: " + repo));
  // shell:true 的正确用法是传整条命令字符串（传 args 数组会被拼接，Windows 下
  // git 收不到参数）。markers 都是纯单词，拼进命令安全。
  // 只搜源码扩展名（decomp 的 .c/.h + 反汇编的 .asm/.s/.inc），滤掉
  // CHANGES/Doxyfile/.gitignore/README 这类文档配置噪声。cmd.exe 用双引号包 glob。
  const exts = ["*.c", "*.h", "*.cpp", "*.hpp", "*.cc", "*.s", "*.S", "*.asm", "*.inc"];
  const cmd =
    "git grep -n -I -i --no-color " +
    MARKERS.map((m) => `-e ${m}`).join(" ") +
    " -- " +
    exts.map((e) => `"${e}"`).join(" ");
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { cwd: dir, shell: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code > 1) return reject(new Error(err || `git grep exit ${code}`));
      // split on \r?\n — git emits CRLF on Windows and JS "." won't match \r,
      // which would otherwise break the `$` anchor below and match nothing.
      const lines = out.split(/\r?\n/).filter(Boolean);
      const perFileCount = {};
      const hits = [];
      for (const ln of lines) {
        const m = ln.match(/^(.+?):(\d+):(.*)$/);
        if (!m) continue;
        const [, file, line, text] = m;
        perFileCount[file] = (perFileCount[file] || 0) + 1;
        if (perFileCount[file] > perFile) continue;
        const t = text.trim();
        const marker = MARKERS.find((k) => t.toLowerCase().includes(k.toLowerCase())) || "";
        hits.push({ file, line: Number(line), text: t.slice(0, 300), marker });
        if (hits.length >= limit) break;
      }
      resolve(hits);
    });
  });
}

// Read a context window around file:line, marking the hit line. Used when an
// excerpt is promoted to a `source` so the AI lens sees surrounding code.
export function readSnippet(repo, file, line, ctx = 8) {
  const full = path.join(CORPUS_DIR, repo, file);
  const all = fs.readFileSync(full, "utf-8").split("\n");
  const idx = Math.max(0, line - 1);
  const from = Math.max(0, idx - ctx);
  const to = Math.min(all.length, idx + ctx + 1);
  const lines = [];
  for (let i = from; i < to; i++) {
    lines.push({ n: i + 1, text: all[i], hit: i === idx });
  }
  // a plain-text rendering for prompts / display
  const rendered = lines
    .map((l) => `${l.hit ? ">" : " "} ${l.n}: ${l.text}`)
    .join("\n");
  return { lines, rendered };
}
