import type { FamilyModel } from "../data/useFamily";
import type { LexEntry } from "../data/types";
import { nodeKey } from "../data/api";
import { classifyForMyLevel, levelOf, type LevelInfo, type LevelSource, type MyLevelClass } from "../lib/levels";
import type { ColorBy } from "../lib/settings";
import type { Level } from "../data/types";
import { levelColor, posColor } from "./LevelBadge";

export interface NodeView {
  id: string;
  key: string;
  lemma: string;
  entry: LexEntry | undefined;
  stressed: string;
  posShort: string;
  level: LevelInfo;
  levelShort: string;
  levelEstimated: boolean;
  fill: string;
  badgeFill: string;
  opacity: number;
  myClass: MyLevelClass;
  pathNode: boolean;
  matched: boolean;
  edgeLabel: { affixes: string; type: string; alt: boolean } | null;
  ariaLabel: string;
  crossLinks: { href: string; lemma: string }[];
}

export interface ViewContext {
  model: FamilyModel;
  levelSource: LevelSource;
  myLevel: Level | null;
  colorBy: ColorBy;
  filtering: boolean;
  mode: "dim" | "prune" | "list";
  matched: Set<string>;
  t: (k: string, v?: Record<string, string | number>) => string;
}

export function makeNodeView(ctx: ViewContext, id: string): NodeView {
  const { model, t } = ctx;
  const node = model.nodes.get(id)!;
  const key = nodeKey(node);
  const entry = model.entries[key];
  const level = levelOf(key, model.levels, ctx.levelSource);
  const myClass = classifyForMyLevel(level.level, ctx.myLevel);
  const matched = !ctx.filtering || ctx.matched.has(id);
  let opacity = 1;
  if (ctx.filtering && !matched) opacity = ctx.mode === "prune" ? 0.4 : 0.25;
  if (myClass === "above") opacity = Math.min(opacity, 0.5);
  const edge = model.edgeOf.get(id);
  let edgeLabel: NodeView["edgeLabel"] = null;
  if (edge) {
    const added = [...edge.added_prefixes, ...edge.added_suffixes, ...edge.added_postfixes];
    const type = edge.semantic_type ? t(`semantic.${edge.semantic_type}`) : "";
    if (added.length || type || edge.root_alternation) {
      edgeLabel = { affixes: added.join(" "), type, alt: edge.root_alternation };
    }
  }
  const levelShort = level.level ? (level.level === "beyond" ? "C2+" : level.level) : "–";
  const stressed = entry?.stressed ?? node.lemma;
  const pathNode = node.is_path_node;
  return {
    id,
    key,
    lemma: node.lemma,
    entry,
    stressed,
    posShort: t(`posShort.${node.pos}`),
    level,
    levelShort,
    levelEstimated: level.estimated,
    fill: ctx.colorBy === "pos" ? posColor(node.pos) : level.level ? levelColor(level.level) : "var(--surface)",
    badgeFill: ctx.colorBy === "pos" ? levelColor(level.level) : "var(--surface)",
    opacity,
    myClass,
    pathNode,
    matched,
    edgeLabel,
    ariaLabel: [
      node.lemma,
      t(`pos.${node.pos}`),
      level.level ? (level.estimated ? `${levelShort} (${t("detail.estimated")})` : levelShort) : t("level.none"),
      myClass === "next" ? t("level.next") : "",
      pathNode ? t("tree.pathNode") : "",
    ]
      .filter(Boolean)
      .join(", "),
    crossLinks: model.family.cross_links
      .filter((c) => c.from === id)
      .map((c) => ({ href: `#/family/${c.family_id}?focus=${encodeURIComponent(c.key)}`, lemma: c.lemma })),
  };
}
