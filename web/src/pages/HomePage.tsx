import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { getEntries } from "../data/api";
import type { LexEntry } from "../data/types";
import SearchBox from "../components/SearchBox";
import { MorphLegend } from "../components/Morph";

const DEMO = ["писать", "читать", "ходить", "работа", "новый"];

export default function HomePage() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<Record<string, LexEntry>>({});

  useEffect(() => {
    getEntries(DEMO).then(setEntries).catch(() => undefined);
  }, []);

  return (
    <div className="home">
      <h1>{t("app.title")}</h1>
      <p className="lede">{t("home.lede")}</p>
      <SearchBox big autoFocus />
      <div className="demo-links">
        <span className="muted">{t("home.tryThese")}</span>
        {DEMO.map((w) => {
          const e = entries[w];
          return e ? (
            <Link key={w} to={`/family/${e.family_id}?focus=${encodeURIComponent(w)}`} lang="ru">
              {e.stressed}
            </Link>
          ) : (
            <span key={w} className="ru muted" lang="ru">
              {w}
            </span>
          );
        })}
      </div>
      <div className="legend-row">
        <MorphLegend />
      </div>
    </div>
  );
}
