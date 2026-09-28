export const CHILD_LIMIT = 8;
export const MAX_VISIBLE = 300;

export interface VisibleNode {
  id: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  children: VisibleNode[];
  hiddenCount: number;
}

export interface TreeShape {
  root: string;
  childrenOf: Map<string, string[]>;
  parentOf: Map<string, string | null>;
}

/**
 * Build the visible tree. `allowed` (prune mode) restricts which nodes exist;
 * `priority` nodes (subtrees with matches) sort first so they are not hidden behind "show more".
 */
export function visibleTree(
  shape: TreeShape,
  expanded: Set<string>,
  showAll: Set<string>,
  allowed: Set<string> | null,
  priority: Map<string, boolean> | null,
): VisibleNode {
  const build = (id: string, depth: number): VisibleNode => {
    let kids = (shape.childrenOf.get(id) ?? []).filter((c) => !allowed || allowed.has(c));
    if (priority) kids = [...kids].sort((a, b) => Number(priority.get(b) ?? 0) - Number(priority.get(a) ?? 0));
    const isOpen = expanded.has(id) && kids.length > 0;
    let shown = kids;
    let hidden = 0;
    if (isOpen && !showAll.has(id) && kids.length > CHILD_LIMIT) {
      shown = kids.slice(0, CHILD_LIMIT);
      hidden = kids.length - CHILD_LIMIT;
    }
    return {
      id,
      depth,
      hasChildren: kids.length > 0,
      expanded: isOpen,
      children: isOpen ? shown.map((c) => build(c, depth + 1)) : [],
      hiddenCount: isOpen ? hidden : 0,
    };
  };
  return build(shape.root, 0);
}

export function flatten(v: VisibleNode): VisibleNode[] {
  const out: VisibleNode[] = [];
  const walk = (n: VisibleNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(v);
  return out;
}

export function countVisible(v: VisibleNode): number {
  return flatten(v).length;
}

/** Nodes at depth < maxDepth are expanded. */
export function expandToDepth(shape: TreeShape, maxDepth: number): Set<string> {
  const out = new Set<string>();
  const walk = (id: string, d: number) => {
    if (d >= maxDepth) return;
    out.add(id);
    for (const c of shape.childrenOf.get(id) ?? []) walk(c, d + 1);
  };
  walk(shape.root, 0);
  return out;
}

export function ancestors(shape: TreeShape, id: string): string[] {
  const out: string[] = [];
  let cur = shape.parentOf.get(id) ?? null;
  while (cur != null) {
    out.push(cur);
    cur = shape.parentOf.get(cur) ?? null;
  }
  return out;
}

/**
 * Default expansion: only the root is open (the root and its direct children are
 * visible); deeper levels start collapsed. The page adds the path to a focused word.
 * (Spec §13.3 said 2 levels; changed at the user's request to keep trees compact.)
 */
export function defaultExpanded(shape: TreeShape): Set<string> {
  return expandToDepth(shape, 1);
}
