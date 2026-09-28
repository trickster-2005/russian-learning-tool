import type { Level, LevelMaps } from "../data/types";
import { LEVELS } from "../data/types";

export type LevelSource = "teaching" | "frequency";
export interface LevelInfo {
  level: Level | null;
  source: "smartool" | "kelly" | "estimated" | null;
  estimated: boolean;
}

const ORDER: Record<LevelSource, ("smartool" | "kelly" | "estimated")[]> = {
  teaching: ["smartool", "kelly", "estimated"],
  frequency: ["kelly", "smartool", "estimated"],
};

export function levelOf(key: string, maps: LevelMaps | null, source: LevelSource): LevelInfo {
  if (!maps) return { level: null, source: null, estimated: false };
  for (const src of ORDER[source]) {
    const lvl = maps[src][key];
    if (lvl) return { level: lvl, source: src, estimated: src === "estimated" };
  }
  return { level: null, source: null, estimated: false };
}

export function levelRank(l: Level | null): number {
  return l ? LEVELS.indexOf(l) : 99;
}

export type MyLevelClass = "normal" | "next" | "above" | "none";

/** ≤ my level → normal; one above → next; higher → above (faded). */
export function classifyForMyLevel(level: Level | null, my: Level | null): MyLevelClass {
  if (!my) return "none";
  if (!level) return "normal";
  const d = levelRank(level) - levelRank(my);
  if (d <= 0) return "normal";
  if (d === 1) return "next";
  return "above";
}
