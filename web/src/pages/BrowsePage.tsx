import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";
import { getAffixes, getAffixIndex, getEntries, getFamiliesIndex, getLevels, getMeta, getSummary, getTopics } from "../data/api";
import type { AffixTable, FamilyIndexEntry, LevelMaps, LexEntry, Meta, SummaryRow, Topics } from "../data/types";
import { LEVELS, POS_LIST } from "../data/types";
import { isFiltering, matchNode, parseFilters, posChangeLabel, writeFilters, type FilterState, type NodeFacts } from "../lib/filters";
import { levelOf, levelRank, type LevelSource } from "../lib/levels";
import { useSettings } from "../lib/settings";
import { keyLemma } from "../lib/normalize";
import FilterPanel, { FilterChips, type FilterOptions } from "../components/FilterPanel";
import LevelBadge, { levelColor } from "../components/LevelBadge";
import Gloss from "../components/Gloss";
import { MorphWord } from "../components/Morph";

const PAGE = 50;

interface BrowseData {
  index: FamilyIndexEntry[];
  summary: Record<string, SummaryRow>;
  levels: LevelMaps;
  topics: Topics;
  affixIndex: Record<string, { lemma: string; family_id: string }[]>;
  affixes: AffixTable;
  meta: Meta;
}

function factsFor(key: string, row: SummaryRow | undefined, d: BrowseData, src: LevelSource, member: FamilyIndexEntry["members"][number]): NodeFacts {
  const [pos, stars, gender, animacy, aspect, refl, trans, motion, uncertain] =
    row ?? (["OTHER", 1, "", "", "", 0, "", 0, 0] as SummaryRow);
  return {
    key,
    pos,
    features: {
      gender: gender || undefined,
      animacy: animacy || undefined,
      aspect: aspect || undefined,
      reflexive: !!refl,
      transitivity: trans || undefined,
      motion_verb: !!motion,
    },
    stars,
    uncertain: !!uncertain,
    level: levelOf(key, d.levels, src),
    topics: d.topics.lemmas[key] ?? [],
    edge: member[1] >= 0 ? { pos_change: member[2], semantic_type: member[3] || null } : null,
    affixes: member[4] ? member[4].split("|") : [],
  };
}

function usePageEntries(keys: string[]) {
  const [entries, setEntries] = useState<Record<string, LexEntry>>({});
  const sig = keys.join(",");
  useEffect(() => {
    let alive = true;
    if (!keys.length) return;
    getEntries(keys)
      .then((e) => alive && setEntries((prev) => ({ ...prev, ...e })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return entries;
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="pagination">
      <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("browse.prev")}>
        ←
      </button>
      <span>{t("browse.page", { n: page, m: pages })}</span>
      <button className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t("browse.next")}>
        →
      </button>
    </nav>
  );
}

export default function BrowsePage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<BrowseData | null>(null);
  const [error, setError] = useState(false);
  const tab = params.get("tab") ?? "families";

  useEffect(() => {
    Promise.all([getFamiliesIndex(), getSummary(), getLevels(), getTopics(), getAffixIndex(), getAffixes(), getMeta()])
      .then(([index, summary, levels, topics, affixIndex, affixes, meta]) =>
        setData({ index, summary, levels, topics, affixIndex, affixes, meta }),
      )
      .catch(() => setError(true));
  }, []);

  const setTab = (tb: string) => {
    const p = new URLSearchParams();
    if (tb !== "families") p.set("tab", tb);
    setParams(p);
  };

  return (
    <div className="page">
      <h1 style={{ margin: "0 0 4px" }}>{t("browse.title")}</h1>
      <div className="tabs" role="tablist">
        {(
          [
            ["families", "browse.families"],
            ["affix", "browse.byAffix"],
            ["formation", "browse.byFormation"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(label)}
          </button>
        ))}
      </div>
      {error && <p className="error-box" role="alert">{t("common.error")}</p>}
      {!data && !error && <p className="loading">{t("common.loading")}</p>}
      {data && tab === "families" && <FamiliesTab data={data} />}
      {data && tab === "affix" && <AffixTab data={data} />}
      {data && tab === "formation" && <FormationTab data={data} />}
    </div>
  );
}

function FamiliesTab({ data }: { data: BrowseData }) {
  const { t } = useI18n();
  const { levelSource } = useSettings();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const filtering = isFiltering(filters);
  const min = Math.max(1, Number(params.get("min")) || 1);
  const sort = params.get("sort") ?? "level";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [drawer, setDrawer] = useState(false);

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null) p.delete(k);
    else p.set(k, v);
    if (k !== "page") p.delete("page");
    setParams(p, { replace: true });
  };
  const updateFilters = (s: FilterState) => {
    const p = writeFilters(s, params);
    p.delete("page");
    setParams(p, { replace: true });
  };

  const rows = useMemo(() => {
    return data.index.map((fam) => {
      const counts: Record<string, number> = {};
      let matches = 0;
      let entry = 99;
      for (const m of fam.members) {
        const key = m[0];
        const f = factsFor(key, data.summary[key], data, levelSource, m);
        const lvl = f.level.level;
        counts[lvl ?? "none"] = (counts[lvl ?? "none"] ?? 0) + 1;
        entry = Math.min(entry, levelRank(lvl));
        if (!filtering || matchNode(f, filters)) matches++;
      }
      return { fam, counts, matches, entry };
    });
  }, [data, levelSource, filters, filtering]);

  const filtered = useMemo(() => {
    const out = rows.filter((r) => r.matches >= min);
    out.sort((a, b) => {
      if (sort === "size") return b.fam.size - a.fam.size;
      if (sort === "alpha") return a.fam.root_lemma.localeCompare(b.fam.root_lemma, "ru");
      return a.entry - b.entry || b.fam.size - a.fam.size;
    });
    return out;
  }, [rows, min, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageRows = filtered.slice((page - 1) * PAGE, page * PAGE);
  const entries = usePageEntries(pageRows.map((r) => r.fam.root_key));

  const options: FilterOptions = {
    posChanges: data.meta.pos_changes,
    semanticTypes: data.meta.semantic_types,
    topics: Object.entries(data.topics.topics).map(([k, v]) => [k, v.en]),
    affixes: Object.keys(data.affixIndex).sort((a, b) => data.affixIndex[b].length - data.affixIndex[a].length).slice(0, 300),
  };

  const minControl = (
    <fieldset>
      <legend>
        <label htmlFor="browse-min">{t("browse.minMatchesLabel")}</label>
      </legend>
      <input
        id="browse-min"
        type="text"
        inputMode="numeric"
        value={min}
        onChange={(e) => setParam("min", Number(e.target.value) > 1 ? String(Number(e.target.value)) : null)}
        style={{ width: 80 }}
      />
    </fieldset>
  );

  return (
    <div className="browse-grid">
      <aside className={`filter-drawer-inline`} aria-label={t("filter.title")}>
        <button className="btn" aria-expanded={drawer} onClick={() => setDrawer((d) => !d)} style={{ marginBottom: 8 }}>
          {t("filter.title")}
        </button>
        <div hidden={!drawer && typeof window !== "undefined" && window.innerWidth < 900}>
          <FilterPanel state={filters} onChange={updateFilters} options={options} extra={minControl} />
        </div>
      </aside>
      <section>
        <FilterChips state={filters} onChange={updateFilters} />
        <div className="controls-row">
          <span className="muted">{t("browse.results", { n: filtered.length.toLocaleString() })}</span>
          <label>
            {t("browse.sortBy")}{" "}
            <select value={sort} onChange={(e) => setParam("sort", e.target.value === "level" ? null : e.target.value)}>
              <option value="level">{t("browse.entryLevel")}</option>
              <option value="size">{t("browse.size")}</option>
              <option value="alpha">{t("browse.sort.alpha")}</option>
            </select>
          </label>
          {min > 1 && <span className="tag">{t("browse.minMatches", { n: min })}</span>}
        </div>
        {filtered.length === 0 ? (
          <p className="empty">{t("browse.empty")}</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t("browse.root")}</th>
                <th className="hide-sm">{t("browse.meaning")}</th>
                <th>{t("browse.entryLevel")}</th>
                <th>{t("browse.size")}</th>
                <th className="hide-sm">{t("browse.levels")}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ fam, counts, entry, matches }) => {
                const e = entries[fam.root_key];
                const lvl = entry < 99 ? [...LEVELS][entry] : null;
                return (
                  <tr key={fam.id}>
                    <td className="ru">
                      <Link to={`/family/${fam.id}${filtering ? `?${writeFilters(filters, new URLSearchParams())}` : ""}`} lang="ru">
                        {e?.stressed ?? fam.root_lemma}
                      </Link>
                    </td>
                    <td className="hide-sm">
                      <Gloss entry={e} />
                    </td>
                    <td>{lvl ? <LevelBadge info={{ level: lvl, source: null, estimated: false }} /> : "–"}</td>
                    <td>
                      {filtering ? `${matches} / ${fam.size}` : fam.size}
                    </td>
                    <td className="hide-sm">
                      <MiniBar counts={counts} size={fam.size} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pager page={page} pages={pages} onPage={(n) => setParam("page", String(n))} />
      </section>
    </div>
  );
}

function MiniBar({ counts, size }: { counts: Record<string, number>; size: number }) {
  const parts = [...LEVELS, "none"].filter((l) => counts[l]);
  const label = parts.map((l) => `${l === "none" ? "–" : l}: ${counts[l]}`).join(", ");
  return (
    <div className="minibar" role="img" aria-label={label} title={label}>
      {parts.map((l) => (
        <span key={l} style={{ width: `${(100 * counts[l]) / size}%`, background: levelColor(l === "none" ? null : l) }} />
      ))}
    </div>
  );
}

function LevelPosPicker({
  level,
  pos,
  onLevel,
  onPos,
}: {
  level: string[];
  pos?: string[];
  onLevel: (v: string[]) => void;
  onPos?: (v: string[]) => void;
}) {
  const { t } = useI18n();
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="filters" style={{ marginBottom: 12 }}>
      <fieldset>
        <legend>{t("filter.level")}</legend>
        <div className="opts">
          {LEVELS.map((l) => (
            <label key={l} className="check">
              <input type="checkbox" checked={level.includes(l)} onChange={() => onLevel(flip(level, l))} />
              {l === "beyond" ? t("level.beyond") : l}
            </label>
          ))}
        </div>
      </fieldset>
      {pos && onPos && (
        <fieldset>
          <legend>{t("filter.pos")}</legend>
          <div className="opts">
            {POS_LIST.map((p) => (
              <label key={p} className="check">
                <input type="checkbox" checked={pos.includes(p)} onChange={() => onPos(flip(pos, p))} />
                {t(`pos.${p}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

function AffixTab({ data }: { data: BrowseData }) {
  const { t } = useI18n();
  const { levelSource } = useSettings();
  const [params, setParams] = useSearchParams();
  const affix = params.get("a") ?? "";
  const level = (params.get("level") ?? "").split(",").filter(Boolean);
  const pos = (params.get("pos") ?? "").split(",").filter(Boolean);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    setParams(p, { replace: true });
  };

  const known = useMemo(
    () => Object.keys(data.affixIndex).sort((a, b) => data.affixIndex[b].length - data.affixIndex[a].length),
    [data],
  );
  const affixMeaning = (a: string) =>
    [...data.affixes.prefixes, ...data.affixes.suffixes, ...data.affixes.postfixes].find((x) => x.affix === a);
  const { lang } = useI18n();

  const items = useMemo(() => {
    const list = data.affixIndex[affix] ?? [];
    return list.filter((it) => {
      const row = data.summary[it.lemma];
      if (pos.length && !(row && pos.includes(row[0]))) return false;
      if (level.length) {
        const l = levelOf(it.lemma, data.levels, levelSource).level;
        if (!l || !level.includes(l)) return false;
      }
      return true;
    });
  }, [data, affix, pos, level, levelSource]);
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const pageItems = items.slice((page - 1) * PAGE, page * PAGE);
  const entries = usePageEntries(pageItems.map((i) => i.lemma));
  const meaning = affixMeaning(affix);

  return (
    <div className="browse-grid">
      <div>
        <label htmlFor="affix-pick" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
          {t("browse.chooseAffix")}
        </label>
        <select id="affix-pick" value={affix} onChange={(e) => set("a", e.target.value)} style={{ width: "100%" }}>
          <option value="">—</option>
          {known.map((a) => (
            <option key={a} value={a}>
              {a} ({data.affixIndex[a].length})
            </option>
          ))}
        </select>
        <div style={{ marginTop: 12 }}>
          <LevelPosPicker
            level={level}
            pos={pos}
            onLevel={(v) => set("level", v.join(","))}
            onPos={(v) => set("pos", v.join(","))}
          />
        </div>
      </div>
      <section>
        {!affix ? (
          <p className="empty">{t("browse.pickAffixFirst")}</p>
        ) : (
          <>
            <div className="controls-row">
              <strong className="ru" lang="ru" style={{ fontSize: "var(--fs-l)" }}>
                {affix}
              </strong>
              {meaning && <span>{lang === "zh-Hant" ? meaning.meaning_zh : meaning.meaning_en}</span>}
              <span className="muted">{t("browse.results", { n: items.length })}</span>
            </div>
            {items.length === 0 ? (
              <p className="empty">{t("browse.empty")}</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("list.word")}</th>
                    <th>{t("filter.pos")}</th>
                    <th>{t("detail.level")}</th>
                    <th className="hide-sm">{t("list.meaning")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((it) => {
                    const e = entries[it.lemma];
                    return (
                      <tr key={it.lemma}>
                        <td>
                          <Link to={`/family/${it.family_id}?focus=${encodeURIComponent(it.lemma)}`} style={{ textDecoration: "none" }}>
                            <MorphWord entry={e} fallback={keyLemma(it.lemma)} />
                          </Link>
                        </td>
                        <td className="pos-tag">{data.summary[it.lemma] ? t(`pos.${data.summary[it.lemma][0]}`) : ""}</td>
                        <td>
                          <LevelBadge info={levelOf(it.lemma, data.levels, levelSource)} />
                        </td>
                        <td className="hide-sm">
                          <Gloss entry={e} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <Pager page={page} pages={pages} onPage={(n) => set("page", String(n))} />
          </>
        )}
      </section>
    </div>
  );
}

function FormationTab({ data }: { data: BrowseData }) {
  const { t } = useI18n();
  const { levelSource } = useSettings();
  const [params, setParams] = useSearchParams();
  const pc = params.get("pc") ?? "";
  const st = params.get("st") ?? "";
  const level = (params.get("level") ?? "").split(",").filter(Boolean);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== "page") p.delete("page");
    setParams(p, { replace: true });
  };
  const posName = (p: string) => t(`pos.${p}`);

  const pairs = useMemo(() => {
    if (!pc && !st) return [];
    const out: { parent: string; child: string; family: string; st: string }[] = [];
    for (const fam of data.index) {
      for (const m of fam.members) {
        if (m[1] < 0) continue;
        if (pc && m[2] !== pc) continue;
        if (st && m[3] !== st) continue;
        if (level.length) {
          const l = levelOf(m[0], data.levels, levelSource).level;
          if (!l || !level.includes(l)) continue;
        }
        out.push({ parent: fam.members[m[1]][0], child: m[0], family: fam.id, st: m[3] });
      }
    }
    out.sort(
      (a, b) =>
        levelRank(levelOf(a.child, data.levels, levelSource).level) -
        levelRank(levelOf(b.child, data.levels, levelSource).level),
    );
    return out;
  }, [data, pc, st, level, levelSource]);

  const pages = Math.max(1, Math.ceil(pairs.length / PAGE));
  const pageItems = pairs.slice((page - 1) * PAGE, page * PAGE);
  const entries = usePageEntries(pageItems.flatMap((p) => [p.parent, p.child]));

  return (
    <div className="browse-grid">
      <div>
        <label htmlFor="pc-pick" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
          {t("browse.patternPos")}
        </label>
        <select id="pc-pick" value={pc} onChange={(e) => set("pc", e.target.value)} style={{ width: "100%" }}>
          <option value="">{t("filter.any")}</option>
          {data.meta.pos_changes.map((x) => (
            <option key={x} value={x}>
              {posChangeLabel(x, posName)}
            </option>
          ))}
        </select>
        <label htmlFor="st-pick" style={{ display: "block", fontWeight: 600, margin: "12px 0 4px" }}>
          {t("browse.patternType")}
        </label>
        <select id="st-pick" value={st} onChange={(e) => set("st", e.target.value)} style={{ width: "100%" }}>
          <option value="">{t("filter.any")}</option>
          {data.meta.semantic_types.map((x) => (
            <option key={x} value={x}>
              {t(`semantic.${x}`)}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 12 }}>
          <LevelPosPicker level={level} onLevel={(v) => set("level", v.join(","))} />
        </div>
      </div>
      <section>
        {!pc && !st ? (
          <p className="empty">{t("browse.pickPatternFirst")}</p>
        ) : pairs.length === 0 ? (
          <p className="empty">{t("browse.empty")}</p>
        ) : (
          <>
            <p className="muted">{t("browse.pairs", { n: pairs.length })}</p>
            <table className="data">
              <tbody>
                {pageItems.map((p) => (
                  <tr key={`${p.parent}>${p.child}`}>
                    <td>
                      <MorphWord entry={entries[p.parent]} fallback={keyLemma(p.parent)} />
                      <span className="muted"> → </span>
                      <Link to={`/family/${p.family}?focus=${encodeURIComponent(p.child)}`} style={{ textDecoration: "none" }}>
                        <MorphWord entry={entries[p.child]} fallback={keyLemma(p.child)} />
                      </Link>
                    </td>
                    <td>
                      <LevelBadge info={levelOf(p.child, data.levels, levelSource)} />
                    </td>
                    <td className="hide-sm">{p.st ? t(`semantic.${p.st}`) : ""}</td>
                    <td className="hide-sm">
                      <Gloss entry={entries[p.child]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={page} pages={pages} onPage={(n) => set("page", String(n))} />
          </>
        )}
      </section>
    </div>
  );
}
