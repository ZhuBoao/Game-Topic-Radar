import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, "tokens.json");

const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];

function oauthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error("未配置 Google OAuth 凭证，请在 .env 里填上 GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI");
  }
  const c = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  const tokens = loadTokens();
  if (tokens) c.setCredentials(tokens);
  c.on("tokens", (t) => {
    const merged = { ...loadTokens(), ...t };
    saveTokens(merged);
  });
  return c;
}

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function isConnected() {
  return !!process.env.YOUTUBE_API_KEY || !!loadTokens();
}

// 搜索/读取公开数据：优先用 API key（简单、不靠 IP、不用授权流程），没有再回退 OAuth。
function ytClient() {
  const key = process.env.YOUTUBE_API_KEY;
  if (key) return google.youtube({ version: "v3", auth: key });
  return google.youtube({ version: "v3", auth: oauthClient() });
}

export function getAuthUrl() {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function handleCallback(code) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  saveTokens({ ...loadTokens(), ...tokens });
}

export function disconnect() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {}
}

// Fetch the most recent N videos from the authenticated user's channel.
export async function fetchRecentVideos(max = 20) {
  if (!isConnected()) throw new Error("尚未连接 YouTube，请先授权");
  const auth = oauthClient();
  const yt = google.youtube({ version: "v3", auth });

  const ch = await yt.channels.list({ part: "contentDetails", mine: true });
  const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error("找不到上传列表，账号下可能没有频道");

  const pl = await yt.playlistItems.list({
    part: "contentDetails",
    playlistId: uploads,
    maxResults: max,
  });
  const ids = (pl.data.items || []).map((i) => i.contentDetails.videoId);
  if (ids.length === 0) return [];

  const vids = await yt.videos.list({
    part: "snippet,statistics",
    id: ids.join(","),
  });

  return (vids.data.items || []).map((v) => ({
    videoId: v.id,
    title: v.snippet.title,
    thumbnail:
      v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || "",
    viewCount: Number(v.statistics?.viewCount ?? 0),
    likeCount: Number(v.statistics?.likeCount ?? 0),
    publishedAt: v.snippet.publishedAt,
  }));
}

const TREND_REGION = { zh: "TW", en: "US", ja: "JP", es: "ES", pt: "BR", ru: "RU" };
const TREND_RELLANG = { zh: "zh-Hant", en: "en", ja: "ja", es: "es", pt: "pt", ru: "ru" };

// Parse an ISO-8601 duration (PT#H#M#S) into seconds.
function isoToSeconds(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

// Find recent high-view gaming videos for one keyword in one language region.
// Shorts (< 3 min) and videos below minViews are dropped. Sorted by viewCount desc.
export async function searchTrending(lang, days, query, max = 15, excludes = [], minViews = 0) {
  if (!isConnected()) throw new Error("尚未连接 YouTube（缺 YOUTUBE_API_KEY 或未授权）");
  const yt = ytClient();
  const publishedAfter = new Date(Date.now() - days * 86400000).toISOString();
  // YouTube q supports negative terms; quote multi-word terms.
  const negative = excludes
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (/\s/.test(t) ? `-"${t}"` : `-${t}`))
    .join(" ");
  const q = negative ? `${query} ${negative}` : query;

  const r = await yt.search.list({
    part: "snippet",
    type: "video",
    videoCategoryId: "20",
    q,
    order: "viewCount",
    publishedAfter,
    maxResults: 50, // grab a big pool; most top-by-views are Shorts we'll drop
    relevanceLanguage: TREND_RELLANG[lang] || lang,
    regionCode: TREND_REGION[lang] || undefined,
  });
  const ids = (r.data.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (ids.length === 0) return [];

  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const v = await yt.videos.list({
      part: "snippet,statistics,contentDetails",
      id: ids.slice(i, i + 50).join(","),
    });
    for (const it of v.data.items || []) {
      if (isoToSeconds(it.contentDetails?.duration) < 180) continue; // drop Shorts
      if (Number(it.statistics?.viewCount ?? 0) < minViews) continue; // not viral enough
      out.push({
        videoId: it.id,
        title: it.snippet.title,
        channelTitle: it.snippet.channelTitle,
        thumbnail:
          it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || "",
        viewCount: Number(it.statistics?.viewCount ?? 0),
        publishedAt: it.snippet.publishedAt,
        channelId: it.snippet.channelId,
        lang,
        keyword: query,
      });
    }
  }
  out.sort((a, b) => b.viewCount - a.viewCount);
  return out.slice(0, max);
}

// Fetch subscriber counts for channels. Returns { channelId: number|null }
// (null = the channel hides its subscriber count).
export async function fetchChannelSubs(channelIds) {
  if (!channelIds.length) return {};
  const yt = ytClient();
  const out = {};
  for (let i = 0; i < channelIds.length; i += 50) {
    const r = await yt.channels.list({ part: "statistics", id: channelIds.slice(i, i + 50).join(",") });
    for (const c of r.data.items || []) {
      out[c.id] = c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? 0);
    }
  }
  return out;
}

// Search the Chinese region for coverage of a topic (all-time, by view count).
export async function searchChineseCoverage(query, max = 8) {
  if (!isConnected()) throw new Error("尚未连接 YouTube（缺 YOUTUBE_API_KEY 或未授权）");
  const yt = ytClient();
  const r = await yt.search.list({
    part: "snippet",
    type: "video",
    q: query,
    order: "viewCount",
    maxResults: max,
    relevanceLanguage: "zh-Hant",
    regionCode: "TW",
  });
  const ids = (r.data.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (ids.length === 0) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const v = await yt.videos.list({ part: "snippet,statistics", id: ids.slice(i, i + 50).join(",") });
    for (const it of v.data.items || []) {
      out.push({
        videoId: it.id,
        title: it.snippet.title,
        channelTitle: it.snippet.channelTitle,
        viewCount: Number(it.statistics?.viewCount ?? 0),
      });
    }
  }
  out.sort((a, b) => b.viewCount - a.viewCount);
  return out;
}

// Search YouTube for videos matching the given keywords, enrich with stats,
// and return them sorted by view count (desc). lang: "cn" | "en".
// excludes：负关键词，在搜索层排除录像/实况（比抓回来再 LLM 滤省配额）。
export async function searchVideos(keywords, lang, perKeyword = 6, excludes = []) {
  if (!isConnected()) throw new Error("尚未连接 YouTube（缺 YOUTUBE_API_KEY 或未授权）");
  if (!keywords || keywords.length === 0) return [];
  const yt = ytClient();
  // 关键：relevanceLanguage 必须匹配查询语言，否则日文查询配 en 会撞到无关综艺/八卦
  const relevanceLanguage = lang === "cn" ? "zh-Hans" : lang === "ja" ? "ja" : "en";
  const regionCode = lang === "ja" ? "JP" : lang === "cn" ? "TW" : "US";
  const neg = excludes.map((t) => t.trim()).filter(Boolean).map((t) => (/\s/.test(t) ? `-"${t}"` : `-${t}`)).join(" ");

  const ids = new Set();
  for (const q of keywords) {
    const r = await yt.search.list({
      part: "snippet",
      q: neg ? `${q} ${neg}` : q,
      type: "video",
      maxResults: perKeyword,
      relevanceLanguage,
      regionCode,
    });
    for (const it of r.data.items || []) {
      if (it.id?.videoId) ids.add(it.id.videoId);
    }
  }
  if (ids.size === 0) return [];

  const idArr = [...ids];
  const out = [];
  for (let i = 0; i < idArr.length; i += 50) {
    const chunk = idArr.slice(i, i + 50);
    const v = await yt.videos.list({ part: "snippet,statistics", id: chunk.join(",") });
    for (const it of v.data.items || []) {
      out.push({
        videoId: it.id,
        title: it.snippet.title,
        channelTitle: it.snippet.channelTitle,
        thumbnail:
          it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || "",
        viewCount: Number(it.statistics?.viewCount ?? 0),
        publishedAt: it.snippet.publishedAt,
        lang,
      });
    }
  }
  out.sort((a, b) => b.viewCount - a.viewCount);
  return out;
}
