import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import type { VisibleNode } from "../lib/visibleTree";
import type { NodeView } from "./nodeView";
import { MorphWord } from "./Morph";
import Gloss from "./Gloss";

interface Props {
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

export default function OutlineView(p: Props) {
  const { t } = useI18n();
  const refs = useRef(new Map<string, HTMLElement>());

  const order = useMemo(() => {
    const out: { id: string; v: VisibleNode; parent: string | null }[] = [];
    const walk = (v: VisibleNode, parent: string | null) => {
      out.push({ id: v.id, v, parent });
      v.children.forEach((c) => walk(c, v.id));
    };
    walk(p.visible, null);
    return out;
  }, [p.visible]);

  useEffect(() => {
    if (p.centerOn) refs.current.get(p.centerOn)?.scrollIntoView({ block: "center" });
  }, [p.centerOn]);

  const focusKey = p.focusId ?? p.visible.id;
  const move = (id: string) => {
    p.onFocusChange(id);
    refs.current.get(id)?.focus();
  };

  const onKey = (e: KeyboardEvent, id: string) => {
    const idx = order.findIndex((o) => o.id === id);
    const item = order[idx];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (order[idx + 1]) move(order[idx + 1].id);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (order[idx - 1]) move(order[idx - 1].id);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (item.v.hasChildren && !item.v.expanded) p.onToggle(id);
        else if (item.v.children[0]) move(item.v.children[0].id);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (item.v.expanded) p.onToggle(id);
        else if (item.parent) move(item.parent);
        break;
      case "Enter":
        e.preventDefault();
        p.onSelect(id);
        break;
      case " ":
        e.preventDefault();
        if (item.v.hasChildren) p.onToggle(id);
        break;
    }
  };

  const render = (v: VisibleNode) => {
    const nv = p.view(v.id);
    const lbl = nv.edgeLabel;
    return (
      <li
        key={v.id}
        role="treeitem"
        aria-level={v.depth + 1}
        aria-expanded={v.hasChildren ? v.expanded : undefined}
        aria-selected={p.selected === v.id}
        aria-label={nv.ariaLabel}
        tabIndex={focusKey === v.id ? 0 : -1}
        ref={(el) => {
          if (el) refs.current.set(v.id, el);
          else refs.current.delete(v.id);
        }}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget) onKey(e, v.id);
        }}
        onFocus={(e) => {
          if (e.target === e.currentTarget) p.onFocusChange(v.id);
        }}
      >
        <div
          className={`row${p.selected === v.id ? " selected" : ""}${nv.myClass === "next" ? " next" : ""}`}
          style={{ opacity: nv.opacity }}
          title={nv.pathNode ? t("tree.pathNode") : undefined}
        >
          {v.hasChildren ? (
            <button
              className="toggle"
              tabIndex={-1}
              aria-label={v.expanded ? t("tree.collapse") : t("tree.expand")}
              onClick={() => p.onToggle(v.id)}
            >
              {v.expanded ? "−" : "+"}
            </button>
          ) : (
            <span style={{ width: 22, flex: "none" }} aria-hidden="true" />
          )}
          <span className="swatch" style={{ background: nv.fill }} aria-hidden="true" />
          <button className="word" tabIndex={-1} onClick={() => p.onSelect(v.id)}>
            <MorphWord entry={nv.entry} fallback={nv.lemma} />
          </button>
          <span className="pos-tag">{nv.posShort}</span>
          <span
            className={`badge${nv.levelEstimated ? " estimated" : ""}`}
            style={{ background: nv.badgeFill === "var(--surface)" ? nv.fill : nv.badgeFill }}
          >
            {nv.levelShort}
          </span>
          {nv.myClass === "next" && <span className="next-tag">{t("level.next")}</span>}
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            <Gloss entry={nv.entry} />
          </span>
          {lbl && (
            <span className="edge">
              <span className="ru">{lbl.affixes}</span>
              {lbl.type && ` · ${lbl.type}`}
              {lbl.alt && ` · ${t("tree.rootAlternation")}`}
            </span>
          )}
        </div>
        {v.expanded && (
          <ul role="group">
            {v.children.map(render)}
            {v.hiddenCount > 0 && (
              <li role="none">
                <button className="btn" style={{ margin: "4px 0 4px 30px" }} onClick={() => p.onShowMore(v.id)}>
                  {t("tree.showMore", { n: v.hiddenCount })}
                </button>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="outline">
      <p className="visually-hidden">{t("tree.keyboardHint")}</p>
      <ul role="tree" aria-label={t("tree.label", { root: p.rootLabel })}>
        {render(p.visible)}
      </ul>
    </div>
  );
}
