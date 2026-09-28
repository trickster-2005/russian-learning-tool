import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { getExamples, nodeKey } from "../data/api";
import type { Example } from "../data/types";
import { affixEntry, affixLookup, type FamilyModel } from "../data/useFamily";
import { levelOf, type LevelSource } from "../lib/levels";
import { MorphLegend, MorphWord } from "./Morph";
import LevelBadge, { levelText } from "./LevelBadge";
import Gloss from "./Gloss";

interface Props {
  model: FamilyModel;
  id: string;
  levelSource: LevelSource;
  onClose: () => void;
  onSelect: (id: string) => void;
}

/** External dictionaries for a lemma; the Chinese Wiktionary is listed first in 中文 mode. */
export function dictionaryLinks(lemma: string, lang: string) {
  const w = encodeURIComponent(lemma);
  const links = [
    { name: "Wiktionary", url: `https://en.wiktionary.org/wiki/${w}#Russian`, lang: "en", note: "" },
    { name: "維基詞典", url: `https://zh.wiktionary.org/wiki/${w}#俄語`, lang: "zh-Hant", note: "" },
    { name: "Викисловарь", url: `https://ru.wiktionary.org/wiki/${w}`, lang: "ru", note: "detail.dict.ruOnly" },
    { name: "OpenRussian", url: `https://en.openrussian.org/ru/${w}`, lang: "en", note: "detail.dict.forms" },
    { name: "Forvo", url: `https://forvo.com/word/${w}/#ru`, lang: "en", note: "detail.dict.audio" },
  ];
  if (lang === "zh-Hant") links.unshift(links.splice(1, 1)[0]);
  return links;
}

function highlight(sentence: string, form: string) {
  const plain = (s: string) => s.normalize("NFD").replace(/[́̀]/g, "").toLowerCase().replace(/ё/g, "е");
  if (!form) return sentence;
  const target = plain(form);
  // Map positions in the stress-free string back to the original.
  const chars = Array.from(sentence.normalize("NFD"));
  const map: number[] = [];
  let flat = "";
  chars.forEach((ch, i) => {
    if (/[́̀]/.test(ch)) return;
    map.push(i);
    flat += ch;
  });
  const idx = plain(flat).indexOf(target);
  if (idx < 0) return sentence;
  const start = map[idx];
  const endIdx = idx + target.length;
  let end = endIdx < map.length ? map[endIdx] : chars.length;
  while (end < chars.length && /[́̀]/.test(chars[end])) end++;
  return (
    <>
      {chars.slice(0, start).join("").normalize("NFC")}
      <strong>{chars.slice(start, end).join("").normalize("NFC")}</strong>
      {chars.slice(end).join("").normalize("NFC")}
    </>
  );
}

export default function DetailPanel({ model, id, levelSource, onClose, onSelect }: Props) {
  const { t, lang, topicName } = useI18n();
  const node = model.nodes.get(id)!;
  const key = nodeKey(node);
  const entry = model.entries[key];
  const level = levelOf(key, model.levels, levelSource);
  const [examples, setExamples] = useState<Example[]>([]);
  const lookup = useMemo(() => affixLookup(model.affixes), [model.affixes]);

  useEffect(() => {
    let alive = true;
    setExamples([]);
    getExamples(key)
      .then((ex) => alive && setExamples(ex))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key]);

  const edge = model.edgeOf.get(id);
  const parentId = model.parentOf.get(id) ?? null;
  const parent = parentId ? model.nodes.get(parentId) : null;
  const parentEntry = parent ? model.entries[nodeKey(parent)] : undefined;
  const f = entry?.features ?? {};
  const topics = model.topics.lemmas[key] ?? [];
  const cross = model.family.cross_links.filter((c) => c.from === id);
  const added = edge ? [...edge.added_prefixes, ...edge.added_suffixes, ...edge.added_postfixes] : [];

  const featureRows: [string, string][] = [];
  featureRows.push([t("filter.pos"), t(`pos.${node.pos}`)]);
  if (node.pos === "NOUN") {
    if (f.gender) featureRows.push([t("filter.gender"), t(`gender.${f.gender}`)]);
    if (f.animacy) featureRows.push([t("filter.animacy"), t(`animacy.${f.animacy}`)]);
  }
  if (node.pos === "VERB") {
    if (f.aspect) featureRows.push([t("filter.aspect"), t(`aspect.${f.aspect}`)]);
    if (f.transitivity) featureRows.push([t("filter.transitivity"), t(`transitivity.${f.transitivity}`)]);
  }

  return (
    <aside className="detail" aria-label={t("detail.title")}>
      <button className="icon-btn close" aria-label={t("detail.close")} onClick={onClose}>
        ×
      </button>
      <h2>
        <MorphWord entry={entry} fallback={node.lemma} />
      </h2>
      {entry?.segmentation && <MorphLegend />}
      {entry?.segmentation?.uncertain && <p className="warn">{t("detail.uncertain")}</p>}
      {node.is_path_node && <p className="note">{t("detail.pathNode")}</p>}

      <h3>{t("detail.grammar")}</h3>
      <dl>
        {featureRows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="tags" style={{ marginTop: 6 }}>
        {f.reflexive && <span className="tag">{t("feat.reflexive")}</span>}
        {f.motion_verb && <span className="tag">{t("feat.motion")}</span>}
        {entry?.lexicalized_participle && <span className="tag">{t("detail.lexicalizedParticiple")}</span>}
      </div>

      <h3>{t("detail.level")}</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <LevelBadge info={level} />
        <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          {level.source ? t(`level.source.${level.source}`) : ""}
          {level.estimated ? ` · ${t("detail.estimated")}` : ""}
        </span>
      </div>
      <details style={{ marginTop: 6 }}>
        <summary>{t("detail.levelSources")}</summary>
        <dl style={{ marginTop: 6 }}>
          {(["smartool", "kelly", "estimated"] as const).map((src) => (
            <div key={src} style={{ display: "contents" }}>
              <dt>{t(`level.source.${src}`)}</dt>
              <dd>{levelText(model.levels[src][key] ?? null, t)}</dd>
            </div>
          ))}
        </dl>
      </details>

      <h3>{t("detail.meaning")}</h3>
      <p className="gloss" style={{ margin: 0 }}>
        <Gloss entry={entry} showEmpty />
      </p>
      {entry && (lang === "zh-Hant" ? entry.gloss_zh : entry.gloss_en) && (
        <p className="note">
          {t("detail.source", { source: (lang === "zh-Hant" ? entry.gloss_zh : entry.gloss_en)!.source })}
        </p>
      )}

      <h3>{t("detail.dictionaries")}</h3>
      <ul className="dict-links">
        {dictionaryLinks(node.lemma, lang).map((d) => (
          <li key={d.url}>
            <a href={d.url} target="_blank" rel="noopener noreferrer" lang={d.lang}>
              {d.name}
              <span aria-hidden="true"> ↗</span>
              <span className="visually-hidden"> ({t("detail.opensNewTab")})</span>
            </a>
            {d.note && <span className="muted"> · {t(d.note)}</span>}
          </li>
        ))}
      </ul>

      {parent && edge && (
        <>
          <h3>{t("detail.formation")}</h3>
          <p style={{ margin: 0 }}>
            {(added.length ? t("detail.addedFrom", { parent: "\u0000" }) : t("detail.noAffix", { parent: "\u0000" }))
              .split("\u0000")
              .map((part, i) =>
                i === 0 ? (
                  <span key={i}>{part}</span>
                ) : (
                  <span key={i}>
                    <button
                      className="btn-ghost"
                      style={{ padding: "0 2px" }}
                      onClick={() => onSelect(parentId!)}
                    >
                      <MorphWord entry={parentEntry} fallback={parent.lemma} />
                    </button>
                    {part}
                  </span>
                ),
              )}
          </p>
          {added.map((a) => {
            const e = affixEntry(lookup, a, parent.pos);
            return (
              <div key={a} className="affix-note">
                <span className="ru" lang="ru">
                  {a}
                </span>
                {e && <> — {lang === "zh-Hant" ? e.meaning_zh : e.meaning_en}</>}
              </div>
            );
          })}
          <div className="tags" style={{ marginTop: 6 }}>
            <span className="tag">
              {t(`pos.${edge.pos_change.split(">")[0]}`)} → {t(`pos.${edge.pos_change.split(">")[1]}`)}
            </span>
            {edge.semantic_type && <span className="tag">{t(`semantic.${edge.semantic_type}`)}</span>}
            {edge.root_alternation && <span className="tag">{t("tree.rootAlternation")}</span>}
          </div>
        </>
      )}
      {cross.length > 0 && (
        <>
          <h3>{t("tree.crossLinks")}</h3>
          <div className="tags">
            {cross.map((c) => (
              <Link key={c.key} className="tag ru" to={`/family/${c.family_id}?focus=${encodeURIComponent(c.key)}`}>
                ↗ {c.lemma}
              </Link>
            ))}
          </div>
        </>
      )}

      {topics.length > 0 && (
        <>
          <h3>{t("detail.topics")}</h3>
          <div className="tags">
            {topics.map((tp) => (
              <span key={tp} className="tag">
                {topicName(tp, model.topics.topics[tp]?.en)}
              </span>
            ))}
          </div>
        </>
      )}

      {examples.length > 0 && (
        <>
          <h3>{t("detail.examples")}</h3>
          <ul className="examples">
            {examples.map((ex, i) => (
              <li key={i}>
                <span className="ru" lang="ru">
                  {highlight(ex.ru, ex.form)}
                </span>
                {ex.en && (
                  <span className="tr" lang="en">
                    {ex.en}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {node.pos === "VERB" && entry?.verb_forms && (entry.verb_forms.participles.length > 0 || entry.verb_forms.gerunds.length > 0) && (
        <>
          {entry.verb_forms.participles.length > 0 && (
            <>
              <h3>{t("detail.participles")}</h3>
              <p className="ru" lang="ru" style={{ margin: 0 }}>
                {entry.verb_forms.participles.join(", ")}
              </p>
            </>
          )}
          {entry.verb_forms.gerunds.length > 0 && (
            <>
              <h3>{t("detail.gerunds")}</h3>
              <p className="ru" lang="ru" style={{ margin: 0 }}>
                {entry.verb_forms.gerunds.join(", ")}
              </p>
            </>
          )}
        </>
      )}


      {entry && (
        <>
          <h3>{t("detail.frequency")}</h3>
          <span className="stars" role="img" aria-label={t("detail.starsLabel", { n: entry.freq_stars })}>
            {"★".repeat(entry.freq_stars)}
            <span style={{ opacity: 0.3 }}>{"★".repeat(5 - entry.freq_stars)}</span>
          </span>
        </>
      )}
    </aside>
  );
}
