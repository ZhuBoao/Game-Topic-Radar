// Prompt builders — v2 (物证驱动).
// 已删：pRefineDirection / pRefineTopic / pDirectionChat / pTopicChat /
//       pKeywords / pRelevance / pAnalyze / pKeywordTranslate
//       —— 这些是"无中生有脑洞"，是塌缩发动机。
// 保留：pGapQuery / pGapJudge（饱和度闸门阶段用）、pTitleChat / pThumbnailPrompts
//       （promote 之后的下游）。新增：pAnomaly（AI 透镜）。

const CN_RULE = `

涉及中文的字段请用纯中文，不要夹杂 satisfying / amazing / ultimate 这类英文词；游戏名、人名、代码符号等专有名词保留原文。`;

// ========== v3 跨区注意力雷达 ==========
// ③-a 生成"角度向"查询：拿去 YouTube/ニコニコ 按播放量采，找英日圈被真人看得多的爆点。
// LLM 只生成查询(它擅长想角度词)，真理来源是平台播放量。
export function pHarvestQueries(identity) {
  const { en, jp, aliases = [], characters = [] } = identity || {};
  return `为"跨区注意力采集"生成搜索查询。目标游戏：${en || "?"}${jp ? ` / ${jp}` : ""}${aliases.length ? `（别名：${aliases.join("、")}）` : ""}${characters.length ? `（角色：${characters.map((c) => c.jp || c.en).join("、")}）` : ""}。
我会拿这些查询去 YouTube / ニコニコ【按播放量】搜，目的是找【英日圈被真人看得多、且最可能让路人"等等这是真的?!"】的视频。
要求：
- 覆盖多种爆点角度：被砍/未用内容、开发秘话/采访、都市传说/文化现象/争议/丑闻、系列兴衰、惊人事实、跨界/glitch/速通传说。
- 【绝不要只搜游戏名】（会全是录像/实况）；每条都要带"角度词"。
- 【每条都必须把游戏名或核心人物名放在显眼处、紧贴角度词】——不要用"騒動/scandal/都市伝説"这类【裸情绪词】(会撞到无关名人八卦/综艺，把游戏内容淹掉)。要 "高橋名人 逮捕" 这种把专有名词和角度紧贴的组合。
- en[]：英文查询。jp[]：日文查询，带 都市伝説 / 裏話 / 誕生秘話 / 没データ / ボツ / 検証 / トリビア 这类词，但都要紧贴游戏/人物名。
- 各 5-7 条，具体、能在搜索里命中。
只输出 JSON：{"en":["..."],"jp":["..."]}`;
}

// ③-b 策展：从平台按播放量采回的真实视频里，滤掉录像/噪音、把同角度合并、提炼角度。
// 播放量=真人注意力。LLM 在这里是"判断真实视频是不是选题"，不是凭空造。
// ③-b 翻译/标注（代码已先滤掉明显录像/直播垃圾）。LLM 只做：把每条标题翻成中文一句话
// + 仅对【与本游戏完全无关的撞车】标 skip。【不替用户判断爆不爆、不做下标映射】(LLM 对整数下标不可靠)。
// 务必按原顺序、等长输出。
export function pGloss(game, titles) {
  const list = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  return `下面是关于《${game}》的视频标题（已去掉游戏录像/直播）。我是中文创作者、读不了日文。
请【逐条、按原顺序、输出与输入【等长】的数组】，每条：
- a：中文一句话——这视频讲什么角度/冷知识/故事（让我读不了日文也能一眼看懂它讲啥）。
- skip：以下情况填 true，其余一律 false（【不要替我判断够不够有意思——有角度的都留】）：
  (1) 和《${game}》完全无关：撞车同名内容、别的游戏、泛泛的"速通合集/世界纪录大盘点"(没具体讲本游戏)、纯综艺八卦；
  (2) 就是一段游戏录像/实况/playthrough/试玩——只是有人在玩、没有讲解某个角度（正则可能没滤干净，你再兜一道）。
标题：
${list}
只输出 JSON 数组（长度必须等于 ${titles.length}、严格按原顺序）：[{"a":"中文角度","skip":false}]`;
}

// ---------- v2 核心：AI 透镜（多角度，不只考古） ----------
// 对一段一手材料(代码/TCRF/采访/口碑评价/IP命运…)挑出有观众缘的选题。铁律：claim
// 必须握着材料里某句原文(anchorQuote)；任何角度都行(再评价/怀旧/IP史/考古/设计/剧情)；
// 纯噪音(导航/广告/版权页)就返回 []。
export function pAnomaly({ game, origin, snippet, hint }) {
  return `你是一个游戏视频的"选题猎手"，服务一个中文 YouTube/B站频道。从下面这段【一手材料】里挑出【真正有人想看】的选题（路过的普通玩家刷到标题会忍不住点）。

【关键：不要只盯 glitch/被砍内容】——这段材料可能讲的是口碑评价、IP 命运、玩法、剧情、地区差异、开发内幕…【任何角度】都可以，按材料实际有什么来：
- reappraisal 再评价/翻案：评论平平却被玩家(或某媒体)打高分、被低估的 cult、被高估、东西方评价反差
- nostalgia 怀旧回顾：被遗忘的神作、当年多火、它超前在哪
- ip-history IP兴衰：系列/工作室怎么没的、为什么再无续作
- archaeology 考古：glitch/被砍/隐藏/调试——【只在材料里真有时】
- design 设计向：为什么神/为什么崩/为什么超前
- story 剧情解析

${CALIB}

# 这次的游戏
我要的是《${game}》。如果材料其实主要讲同系列【别的作品】，在 aboutGame 写清并大幅降低 watchability。

# 材料
来源：${origin}${hint ? `\n线索：${hint}` : ""}
\`\`\`
${snippet}
\`\`\`

# 按顺序卡（任一不过=这条毙掉）
1. 握原句：claim 必须握着材料里某句原文(anchorQuote)才说得出口，逐字摘抄（评分/评论原话/采访原句都算）。
2. 别编：legend / 评价分歧 / 误解 必须是材料里真实存在的，绝不凭空造"大家都以为是X"这种不存在的说法。
3. 残酷标题测试：写真实标题(draftTitle)，以路过玩家身份老实判断会不会点，"有病谁看"的毙。
4. 纯噪音返回 []：材料若主要是导航栏/广告/榜单/版权页/无意义列表，提取不出真东西就返回 []。
5. 质量 >> 数量：最多 3 条最强的；一条够格都没有就返回 []。

# 每条字段
- family: reappraisal | nostalgia | ip-history | archaeology | design | story
- claim: 一句话核心论断（中文）
- anchorQuote: 论断所握的那句原文（逐字摘抄）
- claimZh: 展开两三句（中文）
- legend: 材料里真实存在的那个传说/评价分歧/集体认知（没有就空字符串）
- evidence: 这条材料如何支撑它（中文）
- reversal: 反转点（没有就空字符串）
- aboutGame: 这条实际讲的是哪部作品
- draftTitle: 一个真实的视频标题
- hook: 一个路过的普通人为什么会点（一句话）
- watchability: 1-5 整数（5=接近频道爆款；1=有病谁看）
- titleTest: 路过玩家看到 draftTitle 的反应（会点/大概率划走/有病谁看）
- confidence: high | medium | low

只输出 JSON 数组，不要任何其它文字：
[{ "family": "...", "claim": "...", "anchorQuote": "...", "claimZh": "...", "legend": "...", "evidence": "...", "reversal": "...", "aboutGame": "...", "draftTitle": "...", "hook": "...", "watchability": 1, "titleTest": "...", "confidence": "..." }]${CN_RULE}`;
}

// ---------- v2 发现流水线（多源、可追踪） ----------

// 想看度及格线，发现/透镜共用，保证尺子一致。
const CALIB = `# 频道及格线（你的输出必须接近这一档）
爆款：《皮卡丘的第三段进化在初代里真实存在？！》41万、《200万次输入把旷野之息林克送进时之笛》9万、《初代马里奥真有负1关卡 vs 传说水下256关》4万。
共同点：一个路过的普通人也会"等等，这是真的？！"，勾着大家本来就好奇 / 有感情 / 听说过的东西。
扑街：《跳大绳200次奖励》769、《呆呆兽攻略》496——只有死忠粉关心、没钩子。
残酷标题测试：给每条写真实标题，以路过玩家身份判断会不会点。被砍杂兵 / 改名道具 / 数值600→800 / 没用上的音效——路过的人"有病谁看"，一律毙，除非它有：(a)广为人知的传说被坐实/推翻 (b)"这也行？！"的荒诞震撼 (c)勾着有感情的角色/名场面且颠覆认知 (d)阴暗/细思极恐/开发者刻意隐藏。`;

// 6 个"切入方式家族"——切入方式不该只有考古，要看 IP 处境。
export const FAMILY_DESC = {
  archaeology: "考古向：著名 glitch / 被砍·未用内容(TCRF) / 隐藏 / 调试 / ACE / 速通传奇——【只对常青大作或本身话题度高的才合适】，对褪色/小众 IP 直接上 glitch 观众会莫名其妙",
  nostalgia: "怀旧回顾：你可能玩过但忘了的神作 / 当年多火 / 它超前在哪 / 那些年的回忆——【褪色 IP 首选】",
  "ip-history": "IP兴衰史：这个系列 / 工作室怎么从辉煌走到消失、它去哪了",
  reappraisal: "再评价/翻案：被低估或被高估、'负评如潮的X真有那么烂吗'、被时间证明",
  design: "设计向论点：为什么神 / 为什么崩 / 为什么超前 / 一个机制的来龙去脉",
  story: "剧情解析：世界观 / 剧情 / 角色深挖",
};

// ① 解析 + 计划（【联网核实身份】）：先用 WebSearch 搞清这到底是哪款游戏，再给画像 +
// 为每个下游发现源(采访/TCRF/大频道/speedrun)备好【精确查询种子】。本步不出选题。
export function pResolvePlan(game, mode) {
  const manual = mode && mode !== "auto" && FAMILY_DESC[mode];
  return `你是一个为【游戏考古/冷知识中文 YouTube 频道】做选题调研的资深策划。频道爆款的共同点：让一个路过的普通人也会『等等，这是真的?!』——勾着大家本来就好奇/有感情/隐约听说过的东西(皮卡丘真有第三段进化、马里奥负1关卡、200万次输入把旷野之息送进时之笛、负评如潮某作再评价)。创作者读中英文、不读日文(但会让AI翻)、人在墙外。

任务：把用户给的【模糊游戏/IP】解析成结构化『调研画像』，为后续多源发现(采访挖掘 / TCRF / 速通术语 / 英文大频道)产出【精确查询种子】。【本步不出选题】，只解析与画像。
用户输入：${game}

【身份核实铁律】先用 WebSearch 查清它到底是哪款游戏：真实英文/日文官方名、平台、年代、厂商。中文名直译常错(「光明之魂」≠「Soul of Light」，是世嘉《Shining Soul》)，以搜索为准。【绝不凭印象编英文名/日文名/身份】；不确定就标 uncertain，宁可 null 不臆造；【严禁编造"大家都以为它是X"这类不存在的误解】。
${manual ? `【用户手动指定切入方式】：${mode} —— ${FAMILY_DESC[mode]}。families 只放这一个，各 seeds 围绕它生成。` : `【自动】：按核实后的真实热度分层，自己挑 2-3 个最合适的 family（别每个都做）。`}

family 家族：${Object.keys(FAMILY_DESC).join(" / ")}
（${Object.entries(FAMILY_DESC).map(([k, v]) => `${k}=${v}`).join("；")}）

热度分层(决定源路由)：evergreen(常青大作，TCRF多金矿、采访多、英文区可能做烂=强负索引) / nostalgic(怀旧褪色，采访长尾套利大) / niche(小众，TCRF多残桩、wiki极薄→直接重仓 Tier3 日访谈/blog，别在TCRF/wiki浪费) / obscure。

输出 JSON（只输出 JSON）：
{
  "englishName": "精确英文标题(含平台消歧，如 Super Mario 64 (Nintendo 64))",
  "japaneseName": "精确日文标题(给日文采访站搜；不确定给最可能写法)",
  "aliases": ["中文名", "缩写", "罗马音"],
  "coreCharacters": [{ "en": "角色英文名", "jp": "角色日文名" }],
  "meta": { "year": "", "developer": "", "publisher": "", "series": "" },
  "profile": { "fame": "evergreen|nostalgic|niche|obscure", "peak": "巅峰年代/哪作", "whyFaded": "若褪色为什么(没有空字符串)", "confidence": "high|low", "needsMetacritic": false, "note": "一句话定位" },
  "families": ["选定的 family key"],
  "interviewEnSeeds": ["英译聚合站 + 西方开发者采访/博客/GDC。日系游戏：shmuplations/Lava Cut Content/Iwata Asks(如 Super Mario 64 developer interview cut content shmuplations)；西方游戏：ex-开发者采访/博客(如 GTA San Andreas ex-Rockstar developer interview cut content / Obbe Vermeij blog)"],
  "interviewJpSeeds": ["日文原生站，【必须带具体被砍词】(ボツ/幻の/お蔵入り/当初は/没データ)，禁单独泛词。如 マリオ64 インタビュー ボツ site:4gamer.net / <角色日文名> 読売新聞 誕生秘話。【纯西方游戏、无日文渊源的留空数组】"],
  "bigchannelSeeds": ["大频道视频 + 异常术语，如 Did You Know Gaming <title> cut content / Summoning Salt <title> world record / <title> arbitrary code execution explained / Boundary Break <title>"],
  "writeupSeeds": ["文字深度考据(各wiki/粉丝考据站/游戏媒体深度长文/GDC文字/retrospective)，如 <title> beta unused cut content wiki / <title> retrospective what happened / <title> developer postmortem"],
  "tcrfSeeds": ["site:tcrf.net 形式，如 site:tcrf.net Super Mario 64 unused / site:tcrf.net <title> regional differences"],
  "routingAdvice": "一句路由建议(如 evergreen→采访+TCRF并重但先过负索引；niche→跳TCRF主力、重仓日文采访长尾；纯西方游戏→interviewJpSeeds 留空、重仓 interviewEn+writeups)"
}`;
}

// ①-b 针对 TCRF / DataCrystal 的定向搜索（直接抓 TCRF 已被 IP 封，改让联网模型去读）。
export function pTcrfSearch(englishName) {
  return `用 WebSearch 找 The Cutting Room Floor (tcrf.net) 和 DataCrystal (datacrystal.tcrf.net) 上关于《${englishName}》的条目：未用内容 / 被砍内容 / beta·原型 / 地区差异 / 调试功能。

规则：只用 WebSearch；给搜索结果里真实出现的 URL（多为 tcrf.net / datacrystal.tcrf.net）；每条附一句它具体讲什么（你在结果里看到的）。最多 6 条，绝不编 URL；找不到就少给。
只输出 JSON 数组：[{ "title": "条目标题", "url": "https://...", "note": "它讲了什么" }]`;
}

// ② Web 搜索（联网，有界）：只把这些查询的真实结果 URL 列出来，不抓正文。
export function pWebSearchUrls(englishName, queries) {
  return `用 WebSearch 跑下面这些查询，把搜索结果里真实出现的、与《${englishName}》考古选题相关的网页列出来。
查询：
${(queries || []).map((q, i) => `${i + 1}. ${q}`).join("\n")}

规则：只用 WebSearch，【别打开网页正文】（正文我自己抓）。最多 8 条，绝不编 URL。
只输出 JSON 数组：[{ "title": "网页标题", "url": "https://...", "note": "一句它大概讲什么" }]`;
}

// ③ 提炼候选（不联网）：只从【实际抓到的多源材料】里提炼有观众缘的选题。
// 铁律：逐字证据 + 负面索引去重(英文区做烂的标 saturated) + 坐实下一步 + 日文必译。
export function pExtractCandidates(game, profile, families, materialBlock) {
  const fam = (families && families.length ? families : ["archaeology"]).join(", ");
  const p = profile || {};
  return `你是一个为【游戏考古/冷知识中文 YouTube 频道】提炼选题候选的资深策划。及格线只有一条：让路过的普通人脱口而出『等等，这是真的?!』——必须可坐实、具体、带情绪钩子的异常/秘闻/被砍设计/惊人事实；不是路人皆知的泛常识，也不是逆向噪音。对标爆款：皮卡丘真有第三段进化Gorochu / 200万次输入把旷野之息送进时之笛 / 马里奥负1关 / 负评如潮某作再评价。

下面是从【多个来源实际抓取到】的《${game}》材料（标了来源+URL）。请【只从这些真实材料里】提炼候选。

# IP 画像（据此判断角度，别用一把尺子量所有游戏）
- 处境：${p.fame || "未知"}${p.peak ? ` · 巅峰 ${p.peak}` : ""}${p.whyFaded ? ` · 褪色 ${p.whyFaded}` : ""}　定位：${p.note || ""}　切入家族：${fam}
- evergreen 常青大作 → 深挖 glitch/传说/被砍才有观众缘；nostalgic/niche/obscure → 怀旧回顾/IP兴衰/再评价/设计向就【合格】，【绝不】对褪色 IP 硬塞刷金币类 glitch 当入口。

${CALIB}

# 提炼规则（直面质量问题，逐条卡）
1. 【逐字证据】每条 evidence 必须含材料里【逐字原句】(尤其被砍/改动的理由)，不要转述化概括。日文原句【必须保留并附中文翻译】(创作者不读日文)。
2. 【摘要不可信，但别埋掉好题】纯靠搜索摘要(note)、无任何正文/标题实锤的 → watchability≤2；若是大频道视频(标题已明确指向某个具体现象)但机制细节在视频本体里没抓到正文 → 最多给 3，并在 verifyNext 注明"须看片坐实"。采访/TCRF 这类抓到了正文逐字句的，可正常给高分。
3. 【负面索引去重】判断该异常是否已被英文区做烂：材料里若同一异常已有 TCRF 条目 / Summoning Salt / Did You Know Gaming 等大频道覆盖 → saturated=true，并在 saturatedNote 给建议（『降权』或『转中文区空白/再评价角度』）。这是防止把英文区做烂的题再做一遍。
4. 【别编】legend/评价分歧/误解必须材料里真实存在，绝不凭空造"大家都以为是X"。
5. 【残酷标题测试】以路过玩家身份判断会不会点，"有病谁看"的毙。
6. 质量 >> 数量：最多 6 条最强的；一条够格都没有就返回 []。残桩页/纯链接集合/纯导航=不出候选。
7. 【别让单一源垄断】TCRF 的逐字未用内容很扎实、容易霸榜，但它多半"英文区已做烂"；若 interview 源抓到了有价值的开发者采访秘闻(尤其日文译来的、中文区空白的)，至少保留 1-2 条采访角度候选，不要让 TCRF 把采访套利角度全挤掉。

# 材料
${materialBlock}

每条字段：
- title: 中文选题标题（钩子式问句/惊叹式，对齐及格线）
- claim: 一句话核心论断（那个"等等这是真的?!"的事实本身，具体可坐实）
- family: archaeology|nostalgia|ip-history|reappraisal|design|story
- watchability: 1-5 整数。评分必须综合：(a)『普通人会说等等这是真的?!』程度【最高权重】；(b)可坐实(有逐字证据=高/只有传闻摘要=降)；(c)情绪钩子；(d)叙事张力(被砍/改动/超前/跨界天然加分)；(e)【中文区空白度，高权重】——本频道的护城河是"中文区空白就够"：英文区有料但中文区还没人做的【加分】，尤其【从日文采访/日文资料 translate 过来的开发秘闻】(中文区几乎没有、别人也搬不动)是本频道最高价值，要【顶格加分】；反之英文区+中文区都做烂的(已有中文爆款对标的)【明显减分】。
- evidence: 数组，逐条 { "quote": "逐字原句(日文保留+附中译)", "source_url": "https://...", "source_type": "interview|tcrf|bigchannel|wiki" }
- url: 最该深挖的那条来源 URL
- saturated: 布尔，是否已被英文区做烂
- saturatedNote: 若 saturated=true，给处理建议；否则空字符串
- verifyNext: 坐实下一步（发现≠坐实）。需字节级确认就指出回哪验（Pokémon 系可回本地 decomp git grep；其它回 DataCrystal/官方采访原文）。decomp/代码【仅坐实，不作发现源】。
- translationNote: 若关键证据来自日文，注明是否已译成中文

按 watchability 降序，只输出 JSON 数组，不要任何其它文字：
[{ "title": "...", "claim": "...", "family": "...", "watchability": 1, "evidence": [{"quote":"...","source_url":"https://...","source_type":"..."}], "url": "https://...", "saturated": false, "saturatedNote": "", "verifyNext": "...", "translationNote": "" }]`;
}

// ③.5 合并（map-reduce 的 reduce 步）：各源各自 extract 出候选后，做跨源合并去重 + 负面索引 + 重排。
// 【只输出决策、引用编号】，不重写候选内容——否则重新生成带证据的完整候选输出太大、会超时。
// 完整候选由调用方按编号从各源结果重组。
export function pMergeCandidates(game, profile, indexedList, excludeTitles = []) {
  const p = profile || {};
  const exclude = (excludeTitles || []).filter(Boolean).slice(0, 60);
  const excludeBlock = exclude.length
    ? `\n【点子池里已有这些点子——凡和它们【同一个话题/事实】的候选，一律【不要列入输出】(哪怕措辞不同)，本次只补真正的新点子】：\n${exclude.map((t) => "· " + t).join("\n")}\n`
    : "";
  return `你是《${game}》选题主编。下面是各发现源各自提炼的候选，已编号(#0,#1,…)，每条带 [源|想看度] 标题 :: 论断。
IP 画像：${p.fame || "未知"}${p.note ? " · " + p.note : ""}
${excludeBlock}
请做"合并去重 + 排序"的【决策】——【不要重写标题/论断/证据，只引用编号】：
1. 【合并】同一个现象/事实被多个源提到的，归为一组：primary 选最该当代表的那条编号，mergeWith 列出同组的其余编号（它们的证据会被并进来）。不同现象不要硬合。
2. 【负面索引 saturated】某组若同时来自 TCRF + 大频道(英文区强覆盖)→ saturated=true + saturatedNote(降权或转中文区空白/再评价角度)；主要来自【日文采访 / 冷门文字考据】(中文区空白、别人搬不动)→ saturated=false。
3. 【重排 watchability 1-5】维度：(a)『普通人会说等等这是真的?!』【最高权重】(b)可坐实(c)情绪钩子(d)叙事张力(e)【中文区空白度高权重，日文采访译来的最高】；多源互证可加分。
4. 【宁缺毋滥但别误杀】明显重复/流水账/纯噪音不要列入；有料的别因"英文区有"就删，标 saturated 即可。最多 12 组，按 watchability 降序。

候选编号列表：
${indexedList}

只输出 JSON 数组（只含决策，引用编号；不要重写标题/证据）：
[{ "primary": 0, "mergeWith": [3, 7], "watchability": 5, "saturated": false, "saturatedNote": "" }]`;
}

// ---------- v2 游戏库：AI 扩充 ----------
// 让工具自己提名"值得做考古的游戏/IP"，创作者点选即可，不必自己想。
export function pUniverseExpand(existing, focus) {
  return `我在维护一个"值得做考古向视频的游戏库"。请提名一批【新的】游戏/IP（绝不和已有的重复），优先：有丰富被砍/未用内容、有开发内幕或采访、有版本/地区差异、有硬核速通技术——也就是 TCRF/DataCrystal/采访 里料多的。${focus ? `重点方向：${focus}。` : ""}避免太热门、已被中文区做烂的；偏冷门、有英文资料但中文区少人深做的优先。

已有（不要重复）：
${existing.join("、")}

每个给：name(英文官方名，给 API 用)、aliases(别名数组，含中文名)、series、era、why(为什么料多、中文区为什么可能没做)。
只输出 JSON 数组，不要任何其它文字：
[{ "name": "English name", "aliases": ["中文名", "别名"], "series": "...", "era": "...", "why": "..." }]`;
}

// ---------- v2 组集：把手选的几个 findings 导演成一集视频 ----------
// 用户手动挑几条"点"（可跨游戏），AI 当导演：找统一母题、开场钩子、叙事排序、判够不够 10 分钟。
export function pCompose(findings, note) {
  const list = findings
    .map((f, i) => `${i + 1}. [${f.game || "?"}] ${f.title}\n   钩子：${f.hook || "(无)"}\n   证据：${f.evidence || "(无)"}`)
    .join("\n");
  return `我手动挑了下面这几个"点"（findings），想把它们组成【一集视频】（约 10 分钟）。请你当导演，把它们串成一个有钩子、有叙事的整体。${note ? `\n我的额外要求：${note}` : ""}

这些点【可能来自不同游戏，跨游戏完全没关系】——你的关键工作就是找到把它们连起来的那个"母题/共同点"，让它们不像拼盘而像一个完整故事。
${list}

请输出这一集的结构：
- title: 视频标题（中文，有点击欲）
- angle: 把这几条串起来的统一母题/论点（一句话）——这是"包装"的核心
- coldOpen: 开场钩子（30 秒内抓住路过的人；通常拿最炸的那条当引子，写清怎么开场）
- beats: 叙事骨架——给【我选的每个点】排序和定位，承上启下要顺
    [{ "findingIndex": 这条是上面第几个(从1数), "role": "钩子/递进/高潮/反转/对比/收尾", "oneLine": "这一段讲什么、怎么接上一段" }]
- why10min: 一句话——为什么这几条连起来撑得起约 10 分钟；如果其实撑不起，就【老实说】，并指出还缺一个什么样的点
- leftover: 哪些我选的点其实不搭、建议拿掉（findingIndex 数组，没有就空数组）

只输出 JSON 对象，不要任何其它文字：
{ "title": "", "angle": "", "coldOpen": "", "beats": [{ "findingIndex": 1, "role": "", "oneLine": "" }], "why10min": "", "leftover": [] }`;
}

// ---------- 饱和度闸门阶段（保留，MVP 暂未接线） ----------
export function pGapQuery(claim) {
  return `下面是一个游戏视频的选题论断。我想看看中文区有没有人做过同样主题的视频。请你：
1. 提炼出这个选题的核心主题（一句中文）
2. 给一个最适合在中文区搜索这个主题的关键词（别太长，是观众真的会搜的词）

选题论断：${claim}

请只输出 JSON 对象，不要任何其它文字：
{ "topic": "一句话中文主题", "query": "中文搜索关键词" }`;
}

export function pGapJudge(topic, candidates) {
  const list = candidates.map((c, i) => `${i}. 《${c.title}》 播放 ${c.viewCount}`).join("\n");
  return `我想确认中文区有没有人认真做过这个主题的视频。

主题：${topic}

中文区搜到的视频：
${list || "（没有搜到任何视频）"}

请判断这些视频里有没有真正在讲这个主题的（不是只是关键词撞上、内容无关）：
- 有至少一个明显在讲同一主题、且有一定播放量 → covered=true
- 都不相关、或只有很零星很冷门 → covered=false

请只输出 JSON 对象，不要任何其它文字：
{ "covered": true 或 false, "note": "一句话说明", "matches": [真正相关的视频编号数组] }`;
}

// ---------- promote 之后的下游（保留） ----------
function transcriptBlock(messages) {
  if (!messages || messages.length === 0) return "（还没有对话，请先给第一批标题）";
  return messages
    .map((m) =>
      m.role === "assistant"
        ? `你（上一轮给的标题）：\n${(m.content || "").split("\n").filter(Boolean).map((t) => `  - ${t}`).join("\n")}`
        : `我说：${m.content}`
    )
    .join("\n\n");
}

export function pTitleChat(topic, messages, saved) {
  const savedBlock = saved && saved.length ? saved.map((s) => `- ${s}`).join("\n") : "（暂无）";
  return `你是一个擅长写 YouTube 中文视频标题的策划，正在和我反复打磨这期视频的标题。我提意见你要认真采纳、调整方向，而不是换汤不换药。

选题：
描述：${topic.description}
当前示例标题：${topic.defaultTitle}

我已经存下来的标题（不要重复）：
${savedBlock}

我们到目前为止的对话：
${transcriptBlock(messages)}

请根据最新的对话给我 4 个新的标题：中文、适合 YouTube、有点击欲、方向有明显区分。
请只输出 JSON 数组（字符串数组），不要任何其它文字：
["标题1", "标题2", "标题3", "标题4"]${CN_RULE}`;
}

export function pThumbnailPrompts(title, topic, count = 5) {
  return `你是一个 YouTube 缩略图设计师。请为这期视频构思 ${count} 个【明显不同】的缩略图方案，每个写一段【中文】图像生成 prompt（直接发给绘图模型 gpt-image-2 用）。

要求：每段用中文描述画面主体/构图/风格/配色/氛围/镜头；适合有点击欲的 16:9 缩略图；${count} 个方向不要大同小异；画面和标题强相关；需要文字就建议简短中文大字并说明位置。

视频标题：${title}
选题描述：${topic.description}

请只输出 JSON 数组（字符串数组，每个元素是一段完整中文 prompt），不要任何其它文字：
["方案1", "方案2"]`;
}
