import { useI18n } from "../i18n";
import type { LevelInfo } from "../lib/levels";

export function levelColor(level: string | null): string {
  return level ? `var(--lv-${level})` : "var(--lv-none)";
}

export function posColor(pos: string): string {
  return ["NOUN", "VERB", "ADJ", "ADV"].includes(pos) ? `var(--pos-${pos})` : "var(--pos-other)";
}

export function levelText(level: string | null, t: (k: string) => string): string {
  if (!level) return t("level.none");
  return level === "beyond" ? t("level.beyond") : level;
}

export default function LevelBadge({ info }: { info: LevelInfo }) {
  const { t } = useI18n();
  if (!info.level) return <span className="badge" style={{ background: "var(--lv-none)", borderColor: "var(--line)" }}>{t("level.none")}</span>;
  return (
    <span
      className={`badge${info.estimated ? " estimated" : ""}`}
      style={{ background: levelColor(info.level) }}
      title={info.estimated ? t("detail.estimated") : undefined}
    >
      {info.level === "beyond" ? "C2+" : info.level}
      {info.estimated && <span className="visually-hidden"> ({t("detail.estimated")})</span>}
    </span>
  );
}
