import type { Intent, Job, Race, SceneId, Stat } from "./types.js";
export const VERSION = "mist-coast-1.0.0";
export const races: Record<Race, { name: string; bonus: Stat; lore: string }> =
  {
    human: {
      name: "海岸人",
      bonus: "insight",
      lore: "在港口長大的旅人，熟悉人心與潮汐。",
    },
    elf: {
      name: "霧林精靈",
      bonus: "agility",
      lore: "腳步輕盈，能循著迷霧中的細小痕跡前進。",
    },
    dwarf: {
      name: "礁岩矮人",
      bonus: "strength",
      lore: "來自海崖的石匠，有著如礁石般的韌性。",
    },
  };
export const jobs: Record<
  Job,
  { name: string; equipment: string[]; skill: string; stat: Stat }
> = {
  guardian: {
    name: "守衛",
    equipment: ["鐵劍", "圓盾", "皮甲"],
    skill: "破陣斬：消耗 1 專注，命中造成 8 傷害",
    stat: "strength",
  },
  ranger: {
    name: "遊俠",
    equipment: ["短弓", "獵刀", "旅行披風"],
    skill: "穿霧箭：消耗 1 專注，命中造成 8 傷害",
    stat: "agility",
  },
  arcanist: {
    name: "秘術師",
    equipment: ["符文杖", "潮汐書", "布袍"],
    skill: "潮汐衝擊：消耗 1 專注，命中造成 8 傷害",
    stat: "insight",
  },
};
export const statNames: Record<Stat, string> = {
  strength: "力量",
  agility: "敏捷",
  insight: "洞察",
};
export const scenes: Record<
  SceneId,
  { name: string; subtitle: string; description: string; x: number; y: number }
> = {
  harbor: {
    name: "暮潮港",
    subtitle: "旅程的起點",
    description:
      "繫船柱旁的風鈴不再作響。守燈人留下半張潮汐圖，老船長仍在碼頭等一個回答。",
    x: 125,
    y: 270,
  },
  marsh: {
    name: "低語濕地",
    subtitle: "霧中的道路",
    description:
      "潮水吞沒石徑，蘆葦間藏著古老刻文。每一步，都像踩進另一段記憶。",
    x: 285,
    y: 190,
  },
  tower: {
    name: "無光燈塔",
    subtitle: "海崖的盡頭",
    description: "熄滅的燈室俯瞰黑色海面。入口處，潮汐守衛仍在等待失落的誓言。",
    x: 465,
    y: 90,
  },
};
export const questNames = ["重燃霧海之燈", "守燈人的回聲"];
export const objectives = [
  "尋找兩份線索，通過潮汐守衛，重燃燈塔。",
  "重訪港口與濕地，尋回新的回聲，修復燈塔中的航路石。",
];
export const intentNames: Record<Intent, string> = {
  observe: "觀察四周",
  talk: "交談",
  interact: "調查／操作",
  attack: "普通攻擊",
  skill: "職業技能",
  defend: "防禦",
  heal: "使用藥水",
  move: "前往區域",
  pass: "跳過行動",
};
