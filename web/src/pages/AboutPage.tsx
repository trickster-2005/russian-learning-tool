import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { getMeta } from "../data/api";
import type { Meta } from "../data/types";
import { MorphLegend } from "../components/Morph";

const REPO = "https://github.com/trickster-2005/russian-learning-tool";

interface Source {
  data: { en: string; zh: string };
  source: string;
  url: string;
  authors: string;
  license: string;
  licenseUrl: string;
  files: string;
}

const SOURCES: Source[] = [
  {
    data: { en: "Word-family trees", zh: "詞族樹" },
    source: "DeriNet.RU 0.5 (in Universal Derivations 1.1)",
    url: "http://hdl.handle.net/11234/1-3247",
    authors: "Kyjánek, Lyashevskaya, Nedoluzhko, Vodolazsky, Žabokrtský",
    license: "CC BY-NC-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    files: "families/, families_index.json",
  },
  {
    data: { en: "Definitions, stress, etymology", zh: "釋義、重音、詞源" },
    source: "Wiktionary (English, Chinese, Russian) via kaikki.org / wiktextract",
    url: "https://kaikki.org/",
    authors: "Wiktionary contributors; Tatu Ylonen (wiktextract)",
    license: "CC BY-SA 4.0 / GFDL",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    files: "lexicon/",
  },
  {
    data: { en: "Grammar features, inflected forms", zh: "文法特徵、變化形" },
    source: "pymorphy3 + OpenCorpora dictionary",
    url: "https://github.com/no-plagiarism/pymorphy3",
    authors: "Mikhail Korobov et al.; OpenCorpora",
    license: "MIT (code), CC BY-SA 3.0 (dictionary)",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    files: "lexicon/",
  },
  {
    data: { en: "Word frequency, estimated levels", zh: "詞頻、估計等級" },
    source: "wordfreq",
    url: "https://github.com/rspeer/wordfreq",
    authors: "Robyn Speer",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    files: "lexicon/, levels/estimated.json",
  },
  {
    data: { en: "Teaching levels, examples, topics", zh: "教學等級、例句、主題" },
    source: "SMARTool (UiT The Arctic University of Norway)",
    url: "https://github.com/smartool/data-rus-eng",
    authors: "Laura A. Janda, Francis M. Tyers et al.",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    files: "levels/smartool.json, examples/, topics.json",
  },
  {
    data: { en: "Frequency-based levels", zh: "頻率等級" },
    source: "Kelly word list (Russian)",
    url: "https://ssharoff.github.io/kelly/",
    authors: "Serge Sharoff, Elena Umanskaya, James Wilson (Kelly project)",
    license: "CC BY-NC-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/2.0/",
    files: "levels/kelly.json",
  },
  {
    data: { en: "Morpheme splits (model)", zh: "詞素切分（模型）" },
    source: "ruMorpheme",
    url: "https://github.com/EvilFreelancer/ruMorpheme",
    authors: "Pavel Rykov",
    license: "MIT",
    licenseUrl: "https://opensource.org/licenses/MIT",
    files: "lexicon/",
  },
  {
    data: { en: "Stress (model fallback)", zh: "重音（模型後備）" },
    source: "RUAccent",
    url: "https://github.com/Den4ikAI/ruaccent",
    authors: "Denis Petrov",
    license: "MIT",
    licenseUrl: "https://opensource.org/licenses/MIT",
    files: "lexicon/",
  },
];

export default function AboutPage() {
  const { t, lang } = useI18n();
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    getMeta().then(setMeta).catch(() => undefined);
  }, []);
  return (
    <div className="page prose">
      <h1>{t("about.title")}</h1>
      <p>{t("about.intro")}</p>
      <h2>{t("about.howTitle")}</h2>
      <MorphLegend />
      <ul>
        <li>{t("about.how1")}</li>
        <li>{t("about.how2")}</li>
        <li>{t("about.how3")}</li>
        <li>{t("about.how4")}</li>
      </ul>
      <h2 id="licenses">{t("about.licenses")}</h2>
      <p>{t("about.licenseNote")}</p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>{t("about.col.data")}</th>
              <th>{t("about.col.source")}</th>
              <th>{t("about.col.license")}</th>
              <th>{t("about.col.files")}</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.source}>
                <td>{lang === "zh-Hant" ? s.data.zh : s.data.en}</td>
                <td>
                  <a href={s.url} rel="noopener noreferrer" target="_blank">
                    {s.source}
                  </a>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    {s.authors}
                  </div>
                </td>
                <td>
                  <a href={s.licenseUrl} rel="noopener noreferrer" target="_blank">
                    {s.license}
                  </a>
                </td>
                <td>
                  <code>{s.files}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{t("about.code")}</p>
      {meta && (
        <p className="muted">
          {t("about.buildStats", {
            families: (meta.stats.families ?? 0).toLocaleString(),
            nodes: (meta.stats.kept_nodes ?? 0).toLocaleString(),
          })}{" "}
          ({meta.built})
        </p>
      )}
      <p>
        <a href={REPO} rel="noopener noreferrer" target="_blank">
          {t("about.repo")}
        </a>
      </p>
    </div>
  );
}
