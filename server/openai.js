import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { extractJson, JSON_RULE } from "./claude.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, "images");
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5.5-mini";

let client;
function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("未配置 OPENAI_API_KEY，请在 .env 里填上");
  }
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

// Run an OpenAI text model on the prompt and parse JSON from the reply.
export async function runOpenAIJson(prompt) {
  const res = await getClient().chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: "user", content: prompt + JSON_RULE }],
  });
  const text = res.choices?.[0]?.message?.content || "";
  return extractJson(text);
}

// Like runOpenAIJson, but with the hosted web_search tool so the model can
// verify facts online (via the Responses API).
export async function runOpenAIJsonGrounded(prompt) {
  const res = await getClient().responses.create({
    model: TEXT_MODEL,
    tools: [{ type: "web_search" }],
    input: prompt + JSON_RULE,
  });
  return extractJson(res.output_text || "");
}

// Generate a 1280x720 thumbnail, save to images/, return public path.
export async function generateThumbnail(prompt) {
  const res = await getClient().images.generate({
    model: "gpt-image-2",
    size: "1280x720",
    quality: "low",
    prompt,
  });

  const data = res.data?.[0];
  let buffer;
  if (data?.b64_json) {
    buffer = Buffer.from(data.b64_json, "base64");
  } else if (data?.url) {
    const r = await fetch(data.url);
    buffer = Buffer.from(await r.arrayBuffer());
  } else {
    throw new Error("OpenAI 没有返回图片数据");
  }

  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
  fs.writeFileSync(path.join(IMG_DIR, name), buffer);
  return `/images/${name}`;
}
