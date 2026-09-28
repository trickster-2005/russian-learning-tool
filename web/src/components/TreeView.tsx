import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { hierarchy, tree as d3tree } from "d3-hierarchy";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import "d3-transition";
import { useI18n } from "../i18n";
import type { VisibleNode } from "../lib/visibleTree";
import type { NodeView } from "./nodeView";
import { morphPieces } from "./Morph";

const ROW = 48;
const BOX_H = 30;
const PAD = 9;

interface Item {
  kind: "node" | "more";
  id: string; // node id, or parent id for "more"
  v?: VisibleNode;
  count?: number;
  children?: Item[];
}

let canvas: HTMLCanvasElement | null = null;
function measure(text: string, font: string): number {
  if (!canvas) canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * 9;
  ctx.font = font;
  return ctx.measureText(text).width;
}

const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export interface TreeViewProps {
  visible: VisibleNode;
  view: (id: string) => NodeView;
  selected: string | null;
  focusId: string | null;
  centerOn: string | null;
  rootLabel: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onShowMore: (id: string) => void;
  onFocusChange: (id: string) => void;
}

export default function TreeView(p: TreeViewProps) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const itemRefs = useRef(new Map<string, SVGGElement>());
  const [fontTick, setFontTick] = useState(0);
  const firstFit = useRef(true);

  useEffect(() => {
    document.fonts?.ready.then(() => setFontTick((x) => x + 1));
  }, []);

  // ---------- layout ----------
  const layout = useMemo(() => {
    void fontTick;
    const toItem = (v: VisibleNode): Item => {
      const children: Item[] = v.children.map(toItem);
      if (v.hiddenCount > 0) children.push({ kind: "more", id: v.id, count: v.hiddenCount });
      return { kind: "node", id: v.id, v, children };
    };
    const rootItem = toItem(p.visible);
    const h = hierarchy<Item>(rootItem, (d) => d.children);
    d3tree<Item>().nodeSize([ROW, 1]).separation(() => 1)(h);

    const widths = new Map<string, number>();
    const labelW = new Map<string, number>();
    const maxW: number[] = [];
    const maxLabel: number[] = [];
    for (const n of h.descendants()) {
      const d = n.depth;
      let w: number;
      if (n.data.kind === "more") w = measure(t("tree.showMore", { n: n.data.count ?? 0 }), "12px 'IBM Plex Sans'") + 2 * PAD;
      else {
        const nv = p.view(n.data.id);
        w =
          PAD +
          measure(nv.stressed, "16px 'PT Serif'") +
          8 +
          measure(nv.posShort, "11px 'IBM Plex Sans'") +
          6 +
          measure(nv.levelShort, "11px 'IBM Plex Sans'") +
          12 +
          PAD;
        const lbl = nv.edgeLabel;
        const lw = lbl ? Math.max(measure(lbl.affixes, "12px 'PT Serif'") + measure(lbl.type ? ` · ${lbl.type}` : "", "11px 'IBM Plex Sans'"), lbl.alt ? measure(t("tree.rootAlternation"), "11px 'IBM Plex Sans'") : 0) : 0;
        labelW.set(n.data.id, lw);
        maxLabel[d] = Math.max(maxLabel[d] ?? 0, lw);
      }
      widths.set(`${n.data.kind}:${n.data.id}`, w);
      maxW[d] = Math.max(maxW[d] ?? 0, w);
    }
    const colX: number[] = [0];
    for (let d = 1; d < maxW.length; d++) {
      const gap = Math.max(64, (maxLabel[d] ?? 0) + 44);
      colX[d] = colX[d - 1] + maxW[d - 1] + gap;
    }
    const positioned = h.descendants().map((n) => ({
      n,
      x: colX[n.depth],
      y: n.x ?? 0,
      w: widths.get(`${n.data.kind}:${n.data.id}`) ?? 60,
    }));
    const pos = new Map(positioned.filter((q) => q.n.data.kind === "node").map((q) => [q.n.data.id, q]));
    let minY = Infinity;
    let maxY = -Infinity;
    let maxX = 0;
    for (const q of positioned) {
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
      maxX = Math.max(maxX, q.x + q.w);
    }
    return { positioned, pos, bounds: { minY, maxY, maxX } };
  }, [p.visible, p.view, t, fontTick]);

  // ---------- zoom ----------
  // Layout effect so the behavior exists before the first fit/center below runs.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 2.5])
      .filter((ev: Event) => {
        const target = ev.target as Element;
        // Don't start panning from node clicks; wheel/drag on background is fine.
        if (ev.type === "mousedown" && target.closest(".node, .more-btn, .xlink")) return false;
        return !(ev as MouseEvent).button;
      })
      .on("zoom", (ev) => {
        gRef.current?.setAttribute("transform", ev.transform.toString());
      });
    zoomRef.current = z;
    select(svg).call(z).on("dblclick.zoom", null);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  const fit = useCallback(
    (animate: boolean) => {
      const svg = svgRef.current;
      const z = zoomRef.current;
      if (!svg || !z) return;
      const { width, height } = svg.getBoundingClientRect();
      const { minY, maxY, maxX } = layout.bounds;
      const cw = maxX + 60;
      const ch = maxY - minY + ROW + 40;
      const k = Math.max(0.35, Math.min(1.1, width / cw, height / ch));
      const tx = 30 * k;
      const ty = height / 2 - ((minY + maxY) / 2) * k;
      const transform = zoomIdentity.translate(ch * k > height ? 30 : tx, ch * k > height ? height / 2 : ty).scale(k);
      const sel = select(svg);
      if (animate && !reduceMotion()) sel.transition().duration(200).call(z.transform, transform);
      else sel.call(z.transform, transform);
    },
    [layout],
  );

  const center = useCallback(
    (id: string, animate: boolean) => {
      const svg = svgRef.current;
      const z = zoomRef.current;
      const q = layout.pos.get(id);
      if (!svg || !z || !q) return;
      const { width, height } = svg.getBoundingClientRect();
      const k = Math.max(0.8, Math.min(1.2, (svg as unknown as { __zoom?: { k: number } }).__zoom?.k ?? 1));
      const transform = zoomIdentity.translate(width / 2 - (q.x + q.w / 2) * k, height / 2 - q.y * k).scale(k);
      const sel = select(svg);
      if (animate && !reduceMotion()) sel.transition().duration(200).call(z.transform, transform);
      else sel.call(z.transform, transform);
    },
    [layout],
  );

  useLayoutEffect(() => {
    if (!firstFit.current) return;
    firstFit.current = false;
    if (p.centerOn && layout.pos.has(p.centerOn)) center(p.centerOn, false);
    else fit(false);
  }, [layout, fit, center, p.centerOn]);

  const lastCenter = useRef<string | null>(p.centerOn);
  useEffect(() => {
    if (p.centerOn && p.centerOn !== lastCenter.current && layout.pos.has(p.centerOn)) {
      lastCenter.current = p.centerOn;
      center(p.centerOn, true);
    }
  }, [p.centerOn, center, layout]);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    const sel = select(svg);
    if (reduceMotion()) sel.call(z.scaleBy, factor);
    else sel.transition().duration(200).call(z.scaleBy, factor);
  };

  // ---------- keyboard ----------
  const navOrder = useMemo(() => {
    const out: { kind: "node" | "more"; id: string }[] = [];
    const walk = (v: VisibleNode) => {
      out.push({ kind: "node", id: v.id });
      v.children.forEach(walk);
      if (v.hiddenCount > 0) out.push({ kind: "more", id: v.id });
    };
    walk(p.visible);
    return out;
  }, [p.visible]);

  const focusKey = p.focusId ?? p.visible.id;
  const moveFocus = (key: string) => {
    const el = itemRefs.current.get(key);
    if (el) {
      el.focus({ preventScroll: true });
      const svg = svgRef.current;
      if (svg) {
        const r = el.getBoundingClientRect();
        const s = svg.getBoundingClientRect();
        if (r.left < s.left || r.right > s.right || r.top < s.top || r.bottom > s.bottom) {
          const id = key.startsWith("more:") ? null : key.slice(5);
          if (id) center(id, true);
        }
      }
    }
  };

  const onKey = (e: KeyboardEvent, kind: "node" | "more", id: string) => {
    const idx = navOrder.findIndex((x) => x.kind === kind && x.id === id);
    const go = (i: number) => {
      const target = navOrder[i];
      if (!target) return;
      if (target.kind === "node") p.onFocusChange(target.id);
      moveFocus(`${target.kind}:${target.id}`);
    };
    const v = kind === "node" ? findVisible(p.visible, id) : null;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        go(idx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        go(idx - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (v?.hasChildren && !v.expanded) p.onToggle(id);
        else if (v && v.children[0]) go(idx + 1);
        break;
      case "ArrowLeft": {
        e.preventDefault();
        if (v?.expanded) p.onToggle(id);
        else {
          const parentId = kind === "more" ? id : findParent(p.visible, id);
          if (parentId) {
            p.onFocusChange(parentId);
            moveFocus(`node:${parentId}`);
          }
        }
        break;
      }
      case "Enter":
        e.preventDefault();
        if (kind === "more") p.onShowMore(id);
        else p.onSelect(id);
        break;
      case " ":
        e.preventDefault();
        if (kind === "more") p.onShowMore(id);
        else if (v?.hasChildren) p.onToggle(id);
        break;
      case "Home":
        e.preventDefault();
        go(0);
        break;
      case "End":
        e.preventDefault();
        go(navOrder.length - 1);
        break;
    }
  };

  // ---------- render ----------
  const links = layout.positioned.filter((q) => q.n.parent);
  return (
    <div className="tree-wrap">
      <svg ref={svgRef} className="tree-svg">
        <g ref={gRef}>
          <g>
            {links.map((q) => {
              const parent = layout.pos.get(q.n.parent!.data.id)!;
              const x0 = parent.x + parent.w + (parent.n.data.v?.hasChildren ? 20 : 0);
              const y0 = parent.y;
              const x1 = q.x;
              const y1 = q.y;
              const mx = (x0 + x1) / 2;
              const nv = q.n.data.kind === "node" ? p.view(q.n.data.id) : null;
              return (
                <path
                  key={`l:${q.n.data.kind}:${q.n.data.id}`}
                  className="link"
                  d={`M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`}
                  style={{ opacity: nv ? nv.opacity : 1 }}
                />
              );
            })}
          </g>
          <g role="tree" aria-label={t("tree.label", { root: p.rootLabel })}>
            {layout.positioned.map((q) => {
              if (q.n.data.kind === "more") {
                const key = `more:${q.n.data.id}`;
                const label = t("tree.showMore", { n: q.n.data.count ?? 0 });
                return (
                  <g
                    key={key}
                    ref={(el) => {
                      if (el) itemRefs.current.set(key, el);
                      else itemRefs.current.delete(key);
                    }}
                    className="more-btn"
                    transform={`translate(${q.x},${q.y})`}
                    role="button"
                    tabIndex={-1}
                    aria-label={label}
                    onClick={() => p.onShowMore(q.n.data.id)}
                    onKeyDown={(e) => onKey(e, "more", q.n.data.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <rect y={-12} width={q.w} height={24} rx={4} />
                    <text x={PAD} y={4}>
                      {label}
                    </text>
                  </g>
                );
              }
              const id = q.n.data.id;
              const v = q.n.data.v!;
              const nv = p.view(id);
              const key = `node:${id}`;
              const pieces = morphPieces(nv.entry, nv.lemma);
              const wordW = measure(nv.stressed, "16px 'PT Serif'");
              const posX = PAD + wordW + 8;
              const badgeX = posX + measure(nv.posShort, "11px 'IBM Plex Sans'") + 6;
              const badgeW = measure(nv.levelShort, "11px 'IBM Plex Sans'") + 12;
              const lbl = nv.edgeLabel;
              return (
                <g key={key}>
                  {lbl && (
                    <text className="edge-label" x={q.x - 8} y={q.y - 7} textAnchor="end" style={{ opacity: nv.opacity }}>
                      <tspan className="affix">{lbl.affixes}</tspan>
                      {lbl.type && <tspan>{` · ${lbl.type}`}</tspan>}
                      {lbl.alt && (
                        <tspan className="alt" x={q.x - 8} dy={20}>
                          {t("tree.rootAlternation")}
                        </tspan>
                      )}
                    </text>
                  )}
                  <g
                    ref={(el) => {
                      if (el) itemRefs.current.set(key, el);
                      else itemRefs.current.delete(key);
                    }}
                    className={`node${p.selected === id ? " selected" : ""}${nv.myClass === "next" ? " next" : ""}${nv.pathNode ? " path-node" : ""}`}
                    transform={`translate(${q.x},${q.y})`}
                    role="treeitem"
                    aria-level={v.depth + 1}
                    aria-expanded={v.hasChildren ? v.expanded : undefined}
                    aria-selected={p.selected === id}
                    aria-label={nv.ariaLabel}
                    tabIndex={focusKey === id ? 0 : -1}
                    onClick={() => {
                      p.onFocusChange(id);
                      p.onSelect(id);
                    }}
                    onKeyDown={(e) => onKey(e, "node", id)}
                    onFocus={() => p.onFocusChange(id)}
                    style={{ opacity: nv.opacity }}
                  >
                    {nv.pathNode && <title>{t("tree.pathNode")}</title>}
                    <rect className="focus-ring" x={-3} y={-BOX_H / 2 - 3} width={q.w + 6} height={BOX_H + 6} rx={6} fill="none" />
                    <rect
                      className="box"
                      y={-BOX_H / 2}
                      width={q.w}
                      height={BOX_H}
                      rx={4}
                      style={{ fill: nv.fill, fillOpacity: nv.pathNode ? 0.55 : 1 }}
                    />
                    <text className="word" x={PAD} y={5.5}>
                      {pieces.map((pc, i) => (
                        <tspan key={i} className={pc.type ? `m-${pc.type}` : undefined} fontWeight={pc.type === "ROOT" ? 700 : undefined}>
                          {pc.text}
                        </tspan>
                      ))}
                    </text>
                    <text className="meta" x={posX} y={4.5}>
                      {nv.posShort}
                    </text>
                    <rect
                      x={badgeX}
                      y={-9}
                      width={badgeW}
                      height={18}
                      rx={3}
                      style={{ fill: nv.badgeFill, stroke: nv.levelEstimated ? "var(--ink-muted)" : "none", strokeDasharray: nv.levelEstimated ? "3 2" : undefined, strokeWidth: 1.5 }}
                    />
                    <text className="meta" x={badgeX + 6} y={4} style={{ fill: "var(--ink)" }}>
                      {nv.levelShort}
                    </text>
                    {nv.myClass === "next" && (
                      <text className="meta" x={0} y={-BOX_H / 2 - 4} style={{ fill: "var(--accent)", fontWeight: 600 }}>
                        {t("level.next")}
                      </text>
                    )}
                    {v.hasChildren && (
                      <g
                        className="toggle"
                        transform={`translate(${q.w + 10},0)`}
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onToggle(id);
                        }}
                        aria-hidden="true"
                      >
                        <circle r={8} />
                        <text textAnchor="middle" y={4}>
                          {v.expanded ? "−" : "+"}
                        </text>
                      </g>
                    )}
                  </g>
                  {!v.expanded &&
                    nv.crossLinks.slice(0, 2).map((cl, i) => (
                      <a key={cl.href} href={cl.href} className="xlink">
                        <path className="link cross" d={`M${q.x + q.w + (v.hasChildren ? 20 : 0)},${q.y} l ${24},${i * 16}`} />
                        <text className="edge-label" x={q.x + q.w + (v.hasChildren ? 48 : 28)} y={q.y + 4 + i * 16}>
                          <tspan>↗ </tspan>
                          <tspan className="affix">{cl.lemma}</tspan>
                        </text>
                      </a>
                    ))}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <div className="tree-controls">
        <button className="icon-btn" aria-label={t("tree.zoomIn")} title={t("tree.zoomIn")} onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button className="icon-btn" aria-label={t("tree.zoomOut")} title={t("tree.zoomOut")} onClick={() => zoomBy(0.8)}>
          −
        </button>
        <button className="icon-btn" aria-label={t("tree.resetView")} title={t("tree.resetView")} onClick={() => fit(true)}>
          ⤢
        </button>
      </div>
    </div>
  );
}

function findVisible(v: VisibleNode, id: string): VisibleNode | null {
  if (v.id === id) return v;
  for (const c of v.children) {
    const r = findVisible(c, id);
    if (r) return r;
  }
  return null;
}

function findParent(v: VisibleNode, id: string): string | null {
  for (const c of v.children) {
    if (c.id === id) return v.id;
    const r = findParent(c, id);
    if (r) return r;
  }
  return null;
}
