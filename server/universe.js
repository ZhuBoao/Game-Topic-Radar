// 游戏库（IP universe）。工具不该要求创作者"已经知道要查哪个游戏"——这里提供
// 一个可点选、可被 AI 自动扩充的候选池，驱动整个采集。每条带英文官方名(给
// speedrun/wiki 等 API 用) + 别名(含中文名，解析"丝之歌"这类输入)。
import * as store from "./store.js";

// 种子：16 个语料库对应的游戏 + 一批策展候选（含中文别名）。宝可梦保持极少。
const SEED = [
  { name: "Pokémon Red/Blue", aliases: ["宝可梦 红/蓝", "口袋妖怪", "pokered"], series: "Pokémon", era: "GB 1996", why: "初代内部数据、被删宝可梦、Gen1 bug", source: "corpus" },
  { name: "Doom", aliases: ["毁灭战士"], series: "id Software", era: "PC 1993", why: "官方源码、开发者吐槽、cheat 码", source: "corpus" },
  { name: "Quake III Arena", aliases: ["雷神之锤3"], series: "id Software", era: "PC 1999", why: "Fast InvSqrt、被砍单人战役、bot AI", source: "corpus" },
  { name: "Super Mario 64", aliases: ["超级马里奥64", "马里奥64"], series: "Mario", era: "N64 1996", why: "未用动画、debug、Luigi 残留", source: "corpus" },
  { name: "The Legend of Zelda: Ocarina of Time", aliases: ["塞尔达传说 时之笛", "时之笛"], series: "Zelda", era: "N64 1998", why: "debug ROM、未用 actor、被砍场景", source: "corpus" },
  { name: "Metal Gear Solid", aliases: ["合金装备", "潜龙谍影"], series: "Metal Gear", era: "PS1 1998", why: "debug menu、dev build 变体", source: "corpus" },
  { name: "Castlevania: Symphony of the Night", aliases: ["恶魔城 月下夜想曲", "月下"], series: "Castlevania", era: "PS1 1997", why: "跨 build 差异、被砍房间/敌人", source: "corpus" },
  { name: "Silent Hill", aliases: ["寂静岭"], series: "Silent Hill", era: "PS1 1999", why: "未用怪物、预览原型版、审查内幕", source: "corpus" },
  { name: "Sonic the Hedgehog 2", aliases: ["索尼克2", "音速小子2"], series: "Sonic", era: "Genesis 1992", why: "Hidden Palace 被砍关卡残留", source: "corpus" },
  { name: "Super Mario Bros. 3", aliases: ["超级马里奥兄弟3"], series: "Mario", era: "NES 1988", why: "未用砖块/管道", source: "corpus" },
  { name: "Final Fantasy VI", aliases: ["最终幻想6", "FF6"], series: "Final Fantasy", era: "SNES 1994", why: "Vanish-Doom、Sketch 崩档、未用魔法", source: "corpus" },
  { name: "Donkey Kong", aliases: ["大金刚（街机）"], series: "Donkey Kong", era: "街机 1981", why: "kill screen 22 关溢出 bug", source: "corpus" },
  { name: "Diablo", aliases: ["暗黑破坏神"], series: "Diablo", era: "PC 1996", why: "泄露符号表、被砍点子、debug 工具", source: "corpus" },
  { name: "Command & Conquer: Red Alert", aliases: ["命令与征服 红色警戒", "红警"], series: "C&C", era: "PC 1996", why: "未实装单位/超武、被砍触发", source: "corpus" },
  { name: "Sonic the Hedgehog", aliases: ["索尼克1", "音速小子"], series: "Sonic", era: "Genesis 1991", why: "未用关卡、调试模式开关", source: "corpus" },
  { name: "Frogger", aliases: ["青蛙过河"], series: "Frogger", era: "PS1 1997", why: "原始源码 TODO/注释", source: "corpus" },
  // 策展候选（展示游戏库可超出语料库 / 可被 AI 扩充）
  { name: "EarthBound", aliases: ["地球冒险2", "Mother 2"], series: "Mother", era: "SNES 1994", why: "原型 vs 零售差异、被砍内容", source: "curated" },
  { name: "GoldenEye 007", aliases: ["黄金眼007"], series: "007", era: "N64 1997", why: "被禁多人 cheat、All Bonds 残留", source: "curated" },
  { name: "Banjo-Kazooie", aliases: ["班卓熊大冒险"], series: "Banjo", era: "N64 1998", why: "Stop 'n' Swop 被砍跨游戏功能（天花板级悬案）", source: "curated" },
  { name: "Undertale", aliases: ["传说之下"], series: "Undertale", era: "PC 2015", why: "隐藏 fun value、被砍 boss、彩蛋", source: "curated" },
  { name: "Hollow Knight: Silksong", aliases: ["空洞骑士 丝之歌", "丝之歌"], series: "Hollow Knight", era: "PC", why: "超长开发周期、预告/demo 差异", source: "curated" },
];

export function getUniverse() {
  let list = store.list("universe");
  if (list.length === 0) {
    SEED.forEach((g) => store.insert("universe", { ...g, mined: false }));
    list = store.list("universe");
  }
  return list;
}

export function names() {
  return getUniverse().map((g) => g.name);
}
