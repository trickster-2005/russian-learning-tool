import type { Lang } from "../i18n";
import { useI18n } from "../i18n";
import type { LexEntry } from "../data/types";

/** zh mode shows gloss_zh, falling back to gloss_en with an "EN" mark. */
export function glossFor(e: LexEntry | undefined, lang: Lang): { text: string; fallback: boolean } {
  if (!e) return { text: "", fallback: false };
  if (lang === "zh-Hant") {
    if (e.gloss_zh) return { text: e.gloss_zh.text, fallback: false };
    if (e.gloss_en) return { text: e.gloss_en.text, fallback: true };
    return { text: "", fallback: false };
  }
  return { text: e.gloss_en?.text ?? "", fallback: false };
}

export default function Gloss({ entry, showEmpty = false }: { entry: LexEntry | undefined; showEmpty?: boolean }) {
  const { lang, t } = useI18n();
  const g = glossFor(entry, lang);
  if (!g.text) return showEmpty ? <span className="muted">{t("detail.noGloss")}</span> : null;
  return (
    <span lang={g.fallback || lang === "en" ? "en" : "zh-Hant"}>
      {g.text}
      {g.fallback && (
        <span className="en-mark" aria-label="English">
          EN
        </span>
      )}
    </span>
  );
}
