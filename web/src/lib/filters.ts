import type { Features, Pos } from "../data/types";
import type { LevelInfo } from "./levels";

export type Mode = "dim" | "prune" | "list";

export interface FilterState {
  level: string[];
  est: boolean;
  unleveled: boolean;
  pos: string[];
  gender: string[];
  anim: string[];
  aspect: string[];
  refl: boolean;
  trans: string[];
  motion: boolean;
  pc: string[];
  st: string[];
  affix: string[];
  topic: string[];
  stars: number;
  certain: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  level: [],
  est: true,
  unleveled: true,
  pos: [],
  gender: [],
  anim: [],
  aspect: [],
  refl: false,
  trans: [],
  motion: false,
  pc: [],
  st: [],
  affix: [],
  topic: [],
  stars: 0,
  certain: false,
};

const LIST_KEYS = ["level", "pos", "gender", "anim", "aspect", "trans", "pc", "st", "affix", "topic"] as const;
type ListKey = (typeof LIST_KEYS)[number];
const URL_NAME: Record<ListKey, string> = {
  level: "level",
  pos: "pos",
  gender: "gender",
  anim: "anim",
  aspect: "aspect",
  trans: "trans",
  pc: "pc",
  st: "st",
  affix: "affix",
  topic: "topic",
};

function list(v: string | null): string[] {
  return v ? v.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

export function parseFilters(p: URLSearchParams): FilterState {
  const s: FilterState = { ...DEFAULT_FILTERS };
  for (const k of LIST_KEYS) s[k] = list(p.get(URL_NAME[k]));
  s.est = p.get("est") !== "0";
  s.unleveled = p.get("unleveled") !== "0";
  s.refl = p.get("refl") === "1";
  s.motion = p.get("motion") === "1";
  s.certain = p.get("certain") === "1";
  const stars = Number(p.get("stars"));
  s.stars = Number.isFinite(stars) && stars >= 1 && stars <= 5 ? Math.floor(stars) : 0;
  return s;
}

/** Write filter params into a copy of `base` (other params such as focus/mode are kept). */
export function writeFilters(s: FilterState, base: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const k of LIST_KEYS) {
    if (s[k].length) p.set(URL_NAME[k], s[k].join(","));
    else p.delete(URL_NAME[k]);
  }
  const flag = (name: string, on: boolean, def: boolean) => {
    if (on === def) p.delete(name);
    else p.set(name, on ? "1" : "0");
  };
  flag("est", s.est, true);
  flag("unleveled", s.unleveled, true);
  flag("refl", s.refl, false);
  flag("motion", s.motion, false);
  flag("certain", s.certain, false);
  if (s.stars) p.set("stars", String(s.stars));
  else p.delete("stars");
  return p;
}

export function isFiltering(s: FilterState): boolean {
  return (
    LIST_KEYS.some((k) => s[k].length > 0) ||
    !s.est ||
    !s.unleveled ||
    s.refl ||
    s.motion ||
    s.certain ||
    s.stars > 0
  );
}

export function parseMode(p: URLSearchParams): Mode {
  const m = p.get("mode");
  return m === "prune" || m === "list" ? m : "dim";
}

export interface NodeFacts {
  key: string;
  pos: Pos;
  features: Features;
  stars: number;
  uncertain: boolean;
  level: LevelInfo;
  topics: string[];
  /** Incoming edge (null for the family root). */
  edge: { pos_change: string; semantic_type: string | null } | null;
  /** Affixes on the incoming edge plus canonical affixes found in the segmentation. */
  affixes: string[];
}

const some = (a: string[], b: string[]) => a.some((x) => b.includes(x));

/** AND across dimensions, OR within one dimension. */
export function matchNode(f: NodeFacts, s: FilterState): boolean {
  const effective = f.level.level && (!f.level.estimated || s.est) ? f.level.level : null;
  if (s.level.length) {
    if (effective) {
      if (!s.level.includes(effective)) return false;
    } else if (!s.unleveled) return false;
  } else if (!effective && !s.unleveled) return false;

  if (s.pos.length && !s.pos.includes(f.pos)) return false;

  const isNoun = f.pos === "NOUN";
  const isVerb = f.pos === "VERB";
  if (s.gender.length && !(isNoun && s.gender.includes(f.features.gender ?? "unknown"))) return false;
  if (s.anim.length && !(isNoun && s.anim.includes(f.features.animacy ?? "unknown"))) return false;
  if (s.aspect.length && !(isVerb && s.aspect.includes(f.features.aspect ?? "unknown"))) return false;
  if (s.trans.length && !(isVerb && s.trans.includes(f.features.transitivity ?? "unknown"))) return false;
  if (s.refl && !(isVerb && f.features.reflexive)) return false;
  if (s.motion && !(isVerb && f.features.motion_verb)) return false;

  // Word-formation filters apply to the edge; the matching word is the child.
  if (s.pc.length && !(f.edge && s.pc.includes(f.edge.pos_change))) return false;
  if (s.st.length && !(f.edge && f.edge.semantic_type && s.st.includes(f.edge.semantic_type))) return false;

  if (s.affix.length && !some(s.affix, f.affixes)) return false;
  if (s.topic.length && !some(s.topic, f.topics)) return false;
  if (s.stars && f.stars < s.stars) return false;
  if (s.certain && f.uncertain) return false;
  return true;
}

/** Prune mode: matched nodes plus every ancestor up to the root. Same rule as the build's path preservation. */
export function pruneVisible(parentOf: Map<string, string | null>, matched: Set<string>): Set<string> {
  const visible = new Set<string>();
  for (const id of matched) {
    let cur: string | null | undefined = id;
    while (cur != null && !visible.has(cur)) {
      visible.add(cur);
      cur = parentOf.get(cur);
    }
  }
  return visible;
}

/** For each node: does its subtree (itself included) contain a match? */
export function subtreeMatches(
  root: string,
  childrenOf: Map<string, string[]>,
  matched: Set<string>,
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const visit = (id: string): boolean => {
    let any = matched.has(id);
    for (const c of childrenOf.get(id) ?? []) if (visit(c)) any = true;
    out.set(id, any);
    return any;
  };
  visit(root);
  return out;
}

export function posChangeLabel(pc: string, posName: (p: string) => string): string {
  const [a, b] = pc.split(">");
  return `${posName(a)} → ${posName(b)}`;
}
