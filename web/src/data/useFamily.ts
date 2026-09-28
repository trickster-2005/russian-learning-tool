import { useEffect, useState } from "react";
import { getAffixes, getEntries, getFamily, getLevels, getTopics, NotFoundError, nodeKey } from "./api";
import type { AffixEntry, AffixTable, Family, FamilyEdge, FamilyNode, LevelMaps, LexEntry, Topics } from "./types";

export interface FamilyModel {
  family: Family;
  nodes: Map<string, FamilyNode>;
  entries: Record<string, LexEntry>;
  parentOf: Map<string, string | null>;
  childrenOf: Map<string, string[]>;
  edgeOf: Map<string, FamilyEdge>;
  depthOf: Map<string, number>;
  root: string;
  levels: LevelMaps;
  topics: Topics;
  affixes: AffixTable;
}

export type LoadState<T> = { status: "loading" } | { status: "error"; notFound: boolean } | { status: "ready"; data: T };

export function buildModel(
  family: Family,
  entries: Record<string, LexEntry>,
  levels: LevelMaps,
  topics: Topics,
  affixes: AffixTable,
): FamilyModel {
  const nodes = new Map(family.nodes.map((n) => [n.id, n]));
  const parentOf = new Map<string, string | null>(family.nodes.map((n) => [n.id, null]));
  const childrenOf = new Map<string, string[]>();
  const edgeOf = new Map<string, FamilyEdge>();
  for (const e of family.edges) {
    parentOf.set(e.child, e.parent);
    edgeOf.set(e.child, e);
    const list = childrenOf.get(e.parent) ?? [];
    list.push(e.child);
    childrenOf.set(e.parent, list);
  }
  const zipf = (id: string) => entries[nodeKey(nodes.get(id)!)]?.zipf ?? 0;
  for (const list of childrenOf.values()) list.sort((a, b) => zipf(b) - zipf(a));
  const root = family.nodes[0].id;
  const depthOf = new Map<string, number>();
  const stack: [string, number][] = [[root, 0]];
  while (stack.length) {
    const [id, d] = stack.pop()!;
    depthOf.set(id, d);
    for (const c of childrenOf.get(id) ?? []) stack.push([c, d + 1]);
  }
  return { family, nodes, entries, parentOf, childrenOf, edgeOf, depthOf, root, levels, topics, affixes };
}

export function useFamily(id: string | undefined): LoadState<FamilyModel> {
  const [state, setState] = useState<LoadState<FamilyModel>>({ status: "loading" });
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setState({ status: "loading" });
    (async () => {
      const family = await getFamily(id);
      const [entries, levels, topics, affixes] = await Promise.all([
        getEntries(family.nodes.map(nodeKey)),
        getLevels(),
        getTopics().catch(() => ({ lemmas: {}, topics: {} }) as Topics),
        getAffixes().catch(() => ({ prefixes: [], suffixes: [], postfixes: [] }) as AffixTable),
      ]);
      if (alive) setState({ status: "ready", data: buildModel(family, entries, levels, topics, affixes) });
    })().catch((err) => {
      if (alive) setState({ status: "error", notFound: err instanceof NotFoundError });
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

/** Canonical affix lookup: variant string (without hyphens) -> entries. */
export function affixLookup(table: AffixTable) {
  const prefix = new Map<string, AffixEntry>();
  const suffix = new Map<string, AffixEntry[]>();
  for (const p of table.prefixes) for (const v of p.variants ?? [p.affix]) prefix.set(v.replace(/-/g, ""), p);
  for (const s of [...table.suffixes, ...table.postfixes]) {
    for (const v of s.variants ?? [s.affix]) {
      const k = v.replace(/-/g, "");
      suffix.set(k, [...(suffix.get(k) ?? []), s]);
    }
  }
  const byAffix = new Map<string, AffixEntry[]>();
  for (const e of [...table.prefixes, ...table.suffixes, ...table.postfixes]) {
    byAffix.set(e.affix, [...(byAffix.get(e.affix) ?? []), e]);
  }
  return { prefix, suffix, byAffix };
}

/** Pick the affix-table entry for an added affix, using the parent's POS for suffixes. */
export function affixEntry(
  lookup: ReturnType<typeof affixLookup>,
  affix: string,
  parentPos: string,
): AffixEntry | undefined {
  const list = lookup.byAffix.get(affix);
  if (!list) return undefined;
  if (list.length === 1) return list[0];
  const score = (e: AffixEntry) =>
    e.input_pos === parentPos ? 3 : Array.isArray(e.input_pos) && e.input_pos.includes(parentPos as never) ? 2 : 0;
  return [...list].sort((a, b) => score(b) - score(a))[0];
}

/** Canonical affixes present in a word's segmentation (for the "contains affix" filter). */
export function segmentationAffixes(entry: LexEntry | undefined, lookup: ReturnType<typeof affixLookup>): string[] {
  const out: string[] = [];
  const ms = entry?.segmentation?.morphemes ?? [];
  ms.forEach((m, i) => {
    const t = m.text.toLowerCase().replace(/ё/g, "е");
    if (m.type === "PREF") out.push(lookup.prefix.get(t)?.affix ?? `${t}-`);
    else if (m.type === "SUFF" || m.type === "POSTFIX") {
      const next = ms[i + 1];
      const withEnd = next && next.type === "END" ? t + next.text : null;
      const hit = lookup.suffix.get(t) ?? (withEnd ? lookup.suffix.get(withEnd) : undefined);
      out.push(hit ? hit[0].affix : `-${t}`);
    }
  });
  return out;
}
