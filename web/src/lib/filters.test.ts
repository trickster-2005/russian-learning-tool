import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  isFiltering,
  matchNode,
  parseFilters,
  pruneVisible,
  subtreeMatches,
  writeFilters,
  type FilterState,
  type NodeFacts,
} from "./filters";
import { classifyForMyLevel, levelOf } from "./levels";
import type { LevelMaps } from "../data/types";
import en from "../i18n/en.json";
import zh from "../i18n/zh-Hant.json";
import { normKey, shardOf } from "./normalize";

function facts(p: Partial<NodeFacts>): NodeFacts {
  return {
    key: "x",
    pos: "NOUN",
    features: {},
    stars: 3,
    uncertain: false,
    level: { level: "A1", source: "smartool", estimated: false },
    topics: [],
    edge: null,
    affixes: [],
    ...p,
  };
}
const F = (p: Partial<FilterState>): FilterState => ({ ...DEFAULT_FILTERS, ...p });

describe("filter logic", () => {
  it("is OR within a dimension", () => {
    const s = F({ pos: ["VERB", "NOUN"] });
    expect(matchNode(facts({ pos: "NOUN" }), s)).toBe(true);
    expect(matchNode(facts({ pos: "VERB" }), s)).toBe(true);
    expect(matchNode(facts({ pos: "ADJ" }), s)).toBe(false);
  });

  it("is AND across dimensions", () => {
    const s = F({ pos: ["VERB"], level: ["A1", "A2"] });
    expect(matchNode(facts({ pos: "VERB" }), s)).toBe(true);
    expect(matchNode(facts({ pos: "VERB", level: { level: "B1", source: "kelly", estimated: false } }), s)).toBe(false);
    expect(matchNode(facts({ pos: "NOUN" }), s)).toBe(false);
  });

  it("treats estimated levels according to the est switch", () => {
    const est = facts({ level: { level: "A2", source: "estimated", estimated: true } });
    expect(matchNode(est, F({ level: ["A2"] }))).toBe(true);
    expect(matchNode(est, F({ level: ["A2"], est: false, unleveled: false }))).toBe(false);
    expect(matchNode(est, F({ level: ["A2"], est: false, unleveled: true }))).toBe(true);
  });

  it("applies noun sub-filters only to nouns, with an Other option", () => {
    const s = F({ gender: ["femn"] });
    expect(matchNode(facts({ features: { gender: "femn" } }), s)).toBe(true);
    expect(matchNode(facts({ pos: "VERB" }), s)).toBe(false);
    expect(matchNode(facts({ features: {} }), F({ gender: ["unknown"] }))).toBe(true);
  });

  it("applies word-formation filters to the child of the edge", () => {
    const s = F({ pc: ["VERB>NOUN"] });
    const root = facts({ key: "читать", pos: "VERB", edge: null });
    const child = facts({ key: "чтение", pos: "NOUN", edge: { pos_change: "VERB>NOUN", semantic_type: "action_noun" } });
    expect(matchNode(root, s)).toBe(false);
    expect(matchNode(child, s)).toBe(true);
    expect(matchNode(child, F({ st: ["action_noun"] }))).toBe(true);
    expect(matchNode(child, F({ st: ["agent_noun"] }))).toBe(false);
  });

  it("matches affixes, stars, uncertainty", () => {
    expect(matchNode(facts({ affixes: ["за-"] }), F({ affix: ["вы-", "за-"] }))).toBe(true);
    expect(matchNode(facts({ affixes: [] }), F({ affix: ["за-"] }))).toBe(false);
    expect(matchNode(facts({ stars: 2 }), F({ stars: 3 }))).toBe(false);
    expect(matchNode(facts({ uncertain: true }), F({ certain: true }))).toBe(false);
  });

  it("round-trips through the URL", () => {
    const p = new URLSearchParams("level=A1,A2&pos=VERB&mode=prune&focus=записать");
    const s = parseFilters(p);
    expect(s.level).toEqual(["A1", "A2"]);
    expect(s.pos).toEqual(["VERB"]);
    expect(isFiltering(s)).toBe(true);
    const out = writeFilters(s, p);
    expect(out.get("mode")).toBe("prune");
    expect(out.get("focus")).toBe("записать");
    expect(parseFilters(out)).toEqual(s);
    expect(isFiltering(DEFAULT_FILTERS)).toBe(false);
  });
});

describe("prune mode", () => {
  it("keeps every ancestor of a matching node", () => {
    const parent = new Map<string, string | null>([
      ["n0", null],
      ["n1", "n0"],
      ["n2", "n1"],
      ["n3", "n0"],
    ]);
    const vis = pruneVisible(parent, new Set(["n2"]));
    expect([...vis].sort()).toEqual(["n0", "n1", "n2"]);
  });

  it("finds subtrees without matches", () => {
    const children = new Map([
      ["n0", ["n1", "n3"]],
      ["n1", ["n2"]],
    ]);
    const m = subtreeMatches("n0", children, new Set(["n2"]));
    expect(m.get("n0")).toBe(true);
    expect(m.get("n1")).toBe(true);
    expect(m.get("n3")).toBe(false);
  });
});

describe("my level", () => {
  it("groups levels relative to my level", () => {
    expect(classifyForMyLevel("A1", "A2")).toBe("normal");
    expect(classifyForMyLevel("A2", "A2")).toBe("normal");
    expect(classifyForMyLevel("B1", "A2")).toBe("next");
    expect(classifyForMyLevel("B2", "A2")).toBe("above");
    expect(classifyForMyLevel("beyond", "C2")).toBe("next");
    expect(classifyForMyLevel("B2", null)).toBe("none");
    expect(classifyForMyLevel(null, "A1")).toBe("normal");
  });

  it("picks the level source by preference", () => {
    const maps: LevelMaps = { kelly: { мир: "B1" }, smartool: { мир: "A1" }, estimated: { мир: "A2", дом: "A1" } };
    expect(levelOf("мир", maps, "teaching").level).toBe("A1");
    expect(levelOf("мир", maps, "frequency").level).toBe("B1");
    expect(levelOf("дом", maps, "teaching")).toEqual({ level: "A1", source: "estimated", estimated: true });
  });
});

describe("i18n", () => {
  it("has exactly the same keys in both languages", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
});

describe("normalization", () => {
  it("matches the build's keys and shards", () => {
    expect(normKey(" Ёлка ")).toBe("елка");
    expect(normKey("записа́л")).toBe("записал");
    expect(shardOf("записал")).toBe("за");
    expect(shardOf("я")).toBe("я_");
  });
});
