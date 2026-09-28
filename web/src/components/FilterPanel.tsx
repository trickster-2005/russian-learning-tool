import { useId, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { DEFAULT_FILTERS, posChangeLabel, type FilterState, type Mode } from "../lib/filters";
import { LEVELS, POS_LIST } from "../data/types";

export interface FilterOptions {
  posChanges: string[];
  semanticTypes: string[];
  topics: [string, string][]; // [key, english name]
  affixes: string[];
}

type ListKey = "level" | "pos" | "gender" | "anim" | "aspect" | "trans" | "pc" | "st" | "topic";

interface Props {
  state: FilterState;
  onChange: (s: FilterState) => void;
  options: FilterOptions;
  mode?: Mode;
  onMode?: (m: Mode) => void;
  extra?: ReactNode;
  onClose?: () => void;
}

export default function FilterPanel({ state, onChange, options, mode, onMode, extra, onClose }: Props) {
  const { t, topicName } = useI18n();
  const [affixDraft, setAffixDraft] = useState("");
  const uid = useId();

  const toggle = (k: ListKey, v: string) => {
    const cur = state[k];
    onChange({ ...state, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const checks = (k: ListKey, values: string[], label: (v: string) => string) => (
    <div className="opts">
      {values.map((v) => (
        <label key={v} className="check">
          <input type="checkbox" checked={state[k].includes(v)} onChange={() => toggle(k, v)} />
          {label(v)}
        </label>
      ))}
    </div>
  );
  const showNoun = state.pos.length === 0 || state.pos.includes("NOUN");
  const showVerb = state.pos.length === 0 || state.pos.includes("VERB");
  const posName = (p: string) => t(`pos.${p}`);

  const addAffix = () => {
    const a = affixDraft.trim();
    if (a && !state.affix.includes(a)) onChange({ ...state, affix: [...state.affix, a] });
    setAffixDraft("");
  };

  return (
    <div className="filters">
      <h2>
        {t("filter.title")}
        <span style={{ display: "flex", gap: 6 }}>
          <button className="btn" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
            {t("filter.clear")}
          </button>
          {onClose && (
            <button className="icon-btn" aria-label={t("filter.close")} onClick={onClose}>
              ×
            </button>
          )}
        </span>
      </h2>

      {mode && onMode && (
        <fieldset>
          <legend>{t("filter.mode")}</legend>
          <div className="opts">
            {(["dim", "prune", "list"] as const).map((m) => (
              <label key={m} className="check">
                <input type="radio" name={`${uid}-mode`} checked={mode === m} onChange={() => onMode(m)} />
                {t(`filter.mode.${m}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {extra}

      <fieldset>
        <legend>{t("filter.level")}</legend>
        {checks("level", LEVELS, (l) => (l === "beyond" ? t("level.beyond") : l))}
        <label className="check">
          <input type="checkbox" checked={state.est} onChange={(e) => onChange({ ...state, est: e.target.checked })} />
          {t("filter.includeEstimated")}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={state.unleveled}
            onChange={(e) => onChange({ ...state, unleveled: e.target.checked })}
          />
          {t("filter.includeUnleveled")}
        </label>
      </fieldset>

      <fieldset>
        <legend>{t("filter.pos")}</legend>
        {checks("pos", POS_LIST, posName)}
      </fieldset>

      {showNoun && (
        <>
          <fieldset>
            <legend>{t("filter.gender")}</legend>
            {checks("gender", ["masc", "femn", "neut", "common", "plural_only", "unknown"], (v) => t(`gender.${v}`))}
          </fieldset>
          <fieldset>
            <legend>{t("filter.animacy")}</legend>
            {checks("anim", ["anim", "inan", "unknown"], (v) => t(`animacy.${v}`))}
          </fieldset>
        </>
      )}
      {showVerb && (
        <>
          <fieldset>
            <legend>{t("filter.aspect")}</legend>
            {checks("aspect", ["perf", "impf", "biasp", "unknown"], (v) => t(`aspect.${v}`))}
          </fieldset>
          <fieldset>
            <legend>{t("filter.transitivity")}</legend>
            {checks("trans", ["tran", "intr", "unknown"], (v) => t(`transitivity.${v}`))}
            <label className="check">
              <input type="checkbox" checked={state.refl} onChange={(e) => onChange({ ...state, refl: e.target.checked })} />
              {t("filter.reflexive")}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={state.motion}
                onChange={(e) => onChange({ ...state, motion: e.target.checked })}
              />
              {t("filter.motion")}
            </label>
          </fieldset>
        </>
      )}

      <fieldset>
        <legend>{t("filter.posChange")}</legend>
        {checks("pc", options.posChanges, (pc) => posChangeLabel(pc, posName))}
      </fieldset>
      <fieldset>
        <legend>{t("filter.semanticType")}</legend>
        {checks("st", options.semanticTypes, (s) => t(`semantic.${s}`))}
      </fieldset>

      <fieldset>
        <legend>
          <label htmlFor={`${uid}-affix`}>{t("filter.affix")}</label>
        </legend>
        <div className="search-row">
          <input
            id={`${uid}-affix`}
            type="text"
            lang="ru"
            list={`${uid}-affixes`}
            value={affixDraft}
            placeholder={t("filter.affixPlaceholder")}
            onChange={(e) => setAffixDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAffix();
              }
            }}
          />
          <button className="btn" onClick={addAffix}>
            {t("filter.addAffix")}
          </button>
        </div>
        <datalist id={`${uid}-affixes`}>
          {options.affixes.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        {state.affix.length > 0 && (
          <div className="pick-list">
            {state.affix.map((a) => (
              <span key={a} className="chip ru">
                {a}
                <button
                  aria-label={t("filter.remove", { name: a })}
                  onClick={() => onChange({ ...state, affix: state.affix.filter((x) => x !== a) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </fieldset>

      {options.topics.length > 0 && (
        <fieldset>
          <legend>{t("filter.topic")}</legend>
          {checks(
            "topic",
            options.topics.map(([k]) => k),
            (k) => topicName(k, options.topics.find(([x]) => x === k)?.[1]),
          )}
        </fieldset>
      )}

      <fieldset>
        <legend>
          <label htmlFor={`${uid}-stars`}>{t("filter.freq")}</label>
        </legend>
        <select
          id={`${uid}-stars`}
          value={state.stars}
          onChange={(e) => onChange({ ...state, stars: Number(e.target.value) })}
        >
          <option value={0}>{t("filter.freqAny")}</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {t("filter.freqAtLeast", { n })}
            </option>
          ))}
        </select>
        <label className="check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={state.certain}
            onChange={(e) => onChange({ ...state, certain: e.target.checked })}
          />
          {t("filter.hideUncertain")}
        </label>
      </fieldset>
    </div>
  );
}

/** Active filters as removable chips. */
export function FilterChips({ state, onChange }: { state: FilterState; onChange: (s: FilterState) => void }) {
  const { t, topicName } = useI18n();
  const chips: { label: string; remove: () => FilterState }[] = [];
  const posName = (p: string) => t(`pos.${p}`);
  const listChip = (k: ListKey, label: (v: string) => string, dim: string) => {
    for (const v of state[k]) {
      chips.push({ label: `${dim}: ${label(v)}`, remove: () => ({ ...state, [k]: state[k].filter((x) => x !== v) }) });
    }
  };
  listChip("level", (l) => (l === "beyond" ? t("level.beyond") : l), t("filter.level"));
  listChip("pos", posName, t("filter.pos"));
  listChip("gender", (v) => t(`gender.${v}`), t("filter.gender"));
  listChip("anim", (v) => t(`animacy.${v}`), t("filter.animacy"));
  listChip("aspect", (v) => t(`aspect.${v}`), t("filter.aspect"));
  listChip("trans", (v) => t(`transitivity.${v}`), t("filter.transitivity"));
  listChip("pc", (v) => posChangeLabel(v, posName), t("filter.posChange"));
  listChip("st", (v) => t(`semantic.${v}`), t("filter.semanticType"));
  listChip("topic", (v) => topicName(v), t("filter.topic"));
  for (const a of state.affix) {
    chips.push({ label: `${t("filter.affix")}: ${a}`, remove: () => ({ ...state, affix: state.affix.filter((x) => x !== a) }) });
  }
  if (!state.est) chips.push({ label: `− ${t("filter.includeEstimated")}`, remove: () => ({ ...state, est: true }) });
  if (!state.unleveled) chips.push({ label: `− ${t("filter.includeUnleveled")}`, remove: () => ({ ...state, unleveled: true }) });
  if (state.refl) chips.push({ label: t("filter.reflexive"), remove: () => ({ ...state, refl: false }) });
  if (state.motion) chips.push({ label: t("filter.motion"), remove: () => ({ ...state, motion: false }) });
  if (state.certain) chips.push({ label: t("filter.hideUncertain"), remove: () => ({ ...state, certain: false }) });
  if (state.stars) chips.push({ label: t("filter.freqAtLeast", { n: state.stars }), remove: () => ({ ...state, stars: 0 }) });
  if (!chips.length) return null;
  return (
    <div className="chips" aria-label={t("filter.title")}>
      {chips.map((c) => (
        <span key={c.label} className="chip">
          {c.label}
          <button aria-label={t("filter.remove", { name: c.label })} onClick={() => onChange(c.remove())}>
            ×
          </button>
        </span>
      ))}
      <button className="btn-ghost" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
        {t("filter.clear")}
      </button>
    </div>
  );
}
