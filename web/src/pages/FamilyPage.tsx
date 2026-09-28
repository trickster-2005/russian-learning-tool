import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { getMeta, nodeKey } from "../data/api";
import type { Meta } from "../data/types";
import { affixLookup, segmentationAffixes, useFamily, type FamilyModel } from "../data/useFamily";
import {
  isFiltering,
  matchNode,
  parseFilters,
  parseMode,
  pruneVisible,
  subtreeMatches,
  writeFilters,
  type FilterState,
  type Mode,
  type NodeFacts,
} from "../lib/filters";
import { levelOf, levelRank } from "../lib/levels";
import { useSettings } from "../lib/settings";
import { readStore, writeStore } from "../lib/storage";
import { ancestors, CHILD_LIMIT, defaultExpanded, visibleTree, type TreeShape } from "../lib/visibleTree";
import TreeView from "../components/TreeView";
import OutlineView from "../components/OutlineView";
import DetailPanel from "../components/DetailPanel";
import FilterPanel, { FilterChips, type FilterOptions } from "../components/FilterPanel";
import { makeNodeView, type NodeView } from "../components/nodeView";
import { MorphWord } from "../components/Morph";
import LevelBadge from "../components/LevelBadge";
import Gloss from "../components/Gloss";

const isWide = () => typeof window === "undefined" || window.innerWidth >= 768;
/** Same breakpoint as the CSS: above it the filter panel sits beside the tree. */
const isDrawerInline = () => typeof window === "undefined" || window.innerWidth > 900;

export default function FamilyPage() {
  const { id } = useParams();
  const state = useFamily(id);
  const { t } = useI18n();

  useEffect(() => {
    if (id) writeStore("rwf.lastFamily", id);
  }, [id]);

  if (state.status === "loading") return <p className="loading">{t("common.loading")}</p>;
  if (state.status === "error")
    return (
      <div className="page">
        <p className="error-box" role="alert">
          {state.notFound ? t("family.notFound") : t("common.error")}
        </p>
        <Link to="/">{t("family.back")}</Link>
      </div>
    );
  return <FamilyView key={state.data.family.id} model={state.data} />;
}

function FamilyView({ model }: { model: FamilyModel }) {
  const { t } = useI18n();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const mode = parseMode(params);
  const filtering = isFiltering(filters);
  const focusParam = params.get("focus");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [view, setView] = useState<"tree" | "outline">(isWide() ? "tree" : "outline");
  // Filters start open on tablets/desktops (remembered per browser); on phones
  // the panel is a full-screen sheet, so it starts closed.
  const [drawer, setDrawerState] = useState(() => {
    if (!isDrawerInline()) return false;
    return readStore("rwf.filtersOpen") !== "0";
  });
  const setDrawer = (open: boolean) => {
    setDrawerState(open);
    if (isDrawerInline()) writeStore("rwf.filtersOpen", open ? "1" : "0");
  };
  // Crossing into phone width (rotation, resizing) turns the panel into a
  // full-screen sheet; don't let it cover the tree unasked. Back on wide
  // screens, restore the remembered preference.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setDrawerState(mq.matches ? false : readStore("rwf.filtersOpen") !== "0");
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const [listSort, setListSort] = useState<"level" | "stars" | "alpha">("level");

  useEffect(() => {
    getMeta().then(setMeta).catch(() => undefined);
  }, []);

  const shape: TreeShape = useMemo(
    () => ({ root: model.root, childrenOf: model.childrenOf, parentOf: model.parentOf }),
    [model],
  );
  const lookup = useMemo(() => affixLookup(model.affixes), [model.affixes]);

  const focusId = useMemo(() => {
    if (!focusParam) return null;
    for (const n of model.nodes.values()) if (nodeKey(n) === focusParam) return n.id;
    for (const n of model.nodes.values()) if (n.lemma === focusParam) return n.id;
    return null;
  }, [focusParam, model]);

  // ---------- filtering ----------
  const facts = useMemo(() => {
    const out = new Map<string, NodeFacts>();
    for (const n of model.nodes.values()) {
      const key = nodeKey(n);
      const e = model.entries[key];
      const edge = model.edgeOf.get(n.id);
      out.set(n.id, {
        key,
        pos: n.pos,
        features: e?.features ?? {},
        stars: e?.freq_stars ?? 1,
        uncertain: !!e?.segmentation?.uncertain,
        level: levelOf(key, model.levels, settings.levelSource),
        topics: model.topics.lemmas[key] ?? [],
        edge: edge ? { pos_change: edge.pos_change, semantic_type: edge.semantic_type } : null,
        affixes: [
          ...(edge ? [...edge.added_prefixes, ...edge.added_suffixes, ...edge.added_postfixes] : []),
          ...segmentationAffixes(e, lookup),
        ],
      });
    }
    return out;
  }, [model, settings.levelSource, lookup]);

  const matched = useMemo(() => {
    const s = new Set<string>();
    if (!filtering) return s;
    for (const [nid, f] of facts) if (matchNode(f, filters)) s.add(nid);
    return s;
  }, [facts, filters, filtering]);

  const allowed = useMemo(
    () => (filtering && mode === "prune" ? pruneVisible(model.parentOf, matched) : null),
    [filtering, mode, matched, model],
  );
  const priority = useMemo(
    () => (filtering ? subtreeMatches(model.root, model.childrenOf, matched) : null),
    [filtering, matched, model],
  );

  // ---------- expansion ----------
  const filterSig = params.toString();
  const initialExpansion = useCallback(() => {
    let exp: Set<string>;
    if (!filtering) exp = defaultExpanded(shape);
    else if (mode === "prune") exp = new Set(allowed ?? []);
    else {
      exp = new Set<string>();
      for (const [nid] of model.nodes) {
        const kids = model.childrenOf.get(nid) ?? [];
        if (kids.some((k) => priority?.get(k))) exp.add(nid);
      }
      exp.add(model.root);
    }
    const all = new Set<string>();
    if (focusId) {
      for (const a of ancestors(shape, focusId)) exp.add(a);
      const parent = model.parentOf.get(focusId);
      if (parent) {
        const sibs = model.childrenOf.get(parent) ?? [];
        if (sibs.indexOf(focusId) >= CHILD_LIMIT) all.add(parent);
      }
    }
    return { exp, all };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSig, model, focusId]);

  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpansion().exp);
  const [showAll, setShowAll] = useState<Set<string>>(() => initialExpansion().all);
  // On phones the detail panel is a bottom sheet over the tree, so arriving with ?focus only highlights the word.
  const [selected, setSelected] = useState<string | null>(isDrawerInline() ? focusId : null);
  const [kbFocus, setKbFocus] = useState<string | null>(focusId);
  const [centerOn, setCenterOn] = useState<string | null>(focusId);

  useEffect(() => {
    const { exp, all } = initialExpansion();
    setExpanded(exp);
    setShowAll(all);
  }, [initialExpansion]);

  useEffect(() => {
    if (focusId) {
      if (isDrawerInline()) setSelected(focusId);
      setCenterOn(focusId);
      setKbFocus(focusId);
    }
  }, [focusId]);

  const visible = useMemo(
    () => visibleTree(shape, expanded, showAll, allowed, priority),
    [shape, expanded, showAll, allowed, priority],
  );

  // ---------- node views ----------
  const viewCache = useMemo(() => new Map<string, NodeView>(), [
    model,
    settings.levelSource,
    settings.myLevel,
    settings.colorBy,
    filtering,
    mode,
    matched,
    t,
  ]);
  const viewOf = useCallback(
    (nid: string) => {
      let v = viewCache.get(nid);
      if (!v) {
        v = makeNodeView(
          {
            model,
            levelSource: settings.levelSource,
            myLevel: settings.myLevel,
            colorBy: settings.colorBy,
            filtering,
            mode,
            matched,
            t,
          },
          nid,
        );
        viewCache.set(nid, v);
      }
      return v;
    },
    [viewCache, model, settings.levelSource, settings.myLevel, settings.colorBy, filtering, mode, matched, t],
  );

  // ---------- handlers ----------
  const updateFilters = (s: FilterState) => setParams(writeFilters(s, params), { replace: true });
  const setMode = (m: Mode) => {
    const p = new URLSearchParams(params);
    if (m === "dim") p.delete("mode");
    else p.set("mode", m);
    setParams(p, { replace: true });
  };
  const toggle = (nid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nid)) next.delete(nid);
      else next.add(nid);
      return next;
    });
  const showMore = (nid: string) => setShowAll((prev) => new Set(prev).add(nid));
  const select = (nid: string) => {
    setSelected(nid);
    for (const a of ancestors(shape, nid)) if (!expanded.has(a)) setExpanded((prev) => new Set(prev).add(a));
  };
  const expandAll = () => setExpanded(new Set([...model.nodes.keys()]));
  const collapseAll = () => setExpanded(new Set([model.root]));

  const options: FilterOptions = useMemo(
    () => ({
      posChanges: meta?.pos_changes ?? [...new Set(model.family.edges.map((e) => e.pos_change))].sort(),
      semanticTypes: meta?.semantic_types ?? [],
      topics: Object.entries(model.topics.topics).map(([k, v]) => [k, v.en] as [string, string]),
      affixes: [
        ...model.affixes.prefixes.map((a) => a.affix),
        ...model.affixes.suffixes.map((a) => a.affix),
        ...model.affixes.postfixes.map((a) => a.affix),
      ].filter((a, i, arr) => arr.indexOf(a) === i),
    }),
    [meta, model],
  );

  const rootNode = model.nodes.get(model.root)!;
  const rootEntry = model.entries[nodeKey(rootNode)];
  const total = model.nodes.size;
  const activeFilterCount = [...params.keys()].filter((k) => !["focus", "mode", "lang"].includes(k)).length;

  const listRows = useMemo(() => {
    const ids = [...(filtering ? matched : new Set(model.nodes.keys()))];
    const rank = (nid: string) => levelRank(facts.get(nid)!.level.level);
    return ids.sort((a, b) => {
      if (listSort === "level") return rank(a) - rank(b) || (facts.get(b)!.stars - facts.get(a)!.stars);
      if (listSort === "stars") return facts.get(b)!.stars - facts.get(a)!.stars;
      return model.nodes.get(a)!.lemma.localeCompare(model.nodes.get(b)!.lemma, "ru");
    });
  }, [filtering, matched, model, facts, listSort]);

  const treeProps = {
    visible,
    view: viewOf,
    selected,
    focusId: kbFocus,
    centerOn,
    rootLabel: rootNode.lemma,
    onSelect: select,
    onToggle: toggle,
    onShowMore: showMore,
    onFocusChange: setKbFocus,
  };

  return (
    <div className="family-layout">
      <aside className="filter-drawer" hidden={!drawer} aria-label={t("filter.title")}>
        <FilterPanel
          state={filters}
          onChange={updateFilters}
          options={options}
          mode={mode}
          onMode={setMode}
          onClose={() => setDrawer(false)}
        />
      </aside>
      <section className="canvas-col" aria-labelledby="family-title">
        <div className="family-title">
          <h1 id="family-title">
            <MorphWord entry={rootEntry} fallback={rootNode.lemma} />
          </h1>
          <span className="muted">
            <Gloss entry={rootEntry} />
          </span>
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            {filtering ? t("filter.matches", { n: matched.size, total }) : t("tree.nodes", { n: total })}
          </span>
        </div>
        <div className="toolbar">
          <button className="btn" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
            {t("filter.title")}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          {mode !== "list" && (
            <div className="segmented" role="group" aria-label={t("view.label")}>
              <button aria-pressed={view === "tree"} onClick={() => setView("tree")}>
                {t("view.tree")}
              </button>
              <button aria-pressed={view === "outline"} onClick={() => setView("outline")}>
                {t("view.outline")}
              </button>
            </div>
          )}
          {mode !== "list" && (
            <>
              <button className="btn-ghost" onClick={expandAll}>
                {t("tree.expandAll")}
              </button>
              <button className="btn-ghost" onClick={collapseAll}>
                {t("tree.collapseAll")}
              </button>
            </>
          )}
          <span className="spacer" />
          {model.family.related_families.length > 0 && (
            <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                {t("tree.relatedFamilies")}:
              </span>
              {model.family.related_families.map((r) => (
                <Link key={r.id} to={`/family/${r.id}`} className="ru" title={r.label}>
                  {r.root_lemma}
                </Link>
              ))}
            </span>
          )}
        </div>
        <FilterChips state={filters} onChange={updateFilters} />
        {mode === "list" ? (
          <div className="match-list">
            <div className="controls-row">
              <label>
                {t("list.sortBy")}{" "}
                <select value={listSort} onChange={(e) => setListSort(e.target.value as typeof listSort)}>
                  <option value="level">{t("list.sort.level")}</option>
                  <option value="stars">{t("list.sort.stars")}</option>
                  <option value="alpha">{t("list.sort.alpha")}</option>
                </select>
              </label>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>{t("list.word")}</th>
                  <th>{t("filter.pos")}</th>
                  <th>{t("detail.level")}</th>
                  <th className="hide-sm">{t("list.meaning")}</th>
                  <th className="hide-sm">{t("detail.frequency")}</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((nid) => {
                  const nv = viewOf(nid);
                  return (
                    <tr key={nid}>
                      <td>
                        <button className="btn-ghost" onClick={() => select(nid)}>
                          <MorphWord entry={nv.entry} fallback={nv.lemma} />
                        </button>
                      </td>
                      <td className="pos-tag">{t(`pos.${model.nodes.get(nid)!.pos}`)}</td>
                      <td>
                        <LevelBadge info={nv.level} />
                      </td>
                      <td className="hide-sm">
                        <Gloss entry={nv.entry} />
                      </td>
                      <td className="hide-sm stars">{"★".repeat(nv.entry?.freq_stars ?? 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : view === "tree" ? (
          <TreeView {...treeProps} />
        ) : (
          <OutlineView {...treeProps} />
        )}
      </section>
      {selected && model.nodes.has(selected) && (
        <>
          <div className="panel-backdrop" onClick={() => setSelected(null)} aria-hidden="true" />
          <DetailPanel
            model={model}
            id={selected}
            levelSource={settings.levelSource}
            onClose={() => setSelected(null)}
            onSelect={(nid) => {
              select(nid);
              setCenterOn(nid);
            }}
          />
        </>
      )}
    </div>
  );
}
