import type { LexEntry, Morpheme } from "../data/types";
import { useI18n } from "../i18n";

export interface Piece {
  text: string;
  type: Morpheme["type"] | null;
}

/** Split the stressed spelling into morpheme-typed pieces (combining accents stay with their vowel). */
export function morphPieces(entry: LexEntry | undefined, fallback: string): Piece[] {
  const word = entry?.stressed ?? fallback;
  const seg = entry?.segmentation;
  if (!seg) return [{ text: word, type: null }];
  const chars = Array.from(word);
  const pieces: Piece[] = [];
  let i = 0;
  for (const m of seg.morphemes) {
    let n = Array.from(m.text).length;
    let text = "";
    while (n > 0 && i < chars.length) {
      text += chars[i++];
      while (i < chars.length && /\p{M}/u.test(chars[i])) text += chars[i++];
      n--;
    }
    pieces.push({ text, type: m.type });
  }
  if (i < chars.length) pieces.push({ text: chars.slice(i).join(""), type: null });
  return pieces;
}

export function MorphWord({ entry, fallback, className = "" }: { entry: LexEntry | undefined; fallback: string; className?: string }) {
  const { t } = useI18n();
  const pieces = morphPieces(entry, fallback);
  const label = entry?.segmentation
    ? pieces.map((p) => `${p.text} (${p.type ? t(`morph.${p.type}`) : ""})`).join(", ")
    : undefined;
  return (
    <span className={`ru ${className}`} lang="ru" title={label}>
      {pieces.map((p, i) => (
        <span key={i} className={p.type ? `m-${p.type}` : undefined}>
          {p.text}
        </span>
      ))}
    </span>
  );
}

export function MorphLegend() {
  const { t } = useI18n();
  return (
    <div className="morph-legend" aria-hidden="true">
      {(["PREF", "ROOT", "SUFF", "END", "POSTFIX"] as const).map((m) => (
        <span key={m} className={`m-${m}`}>
          {t(`morph.${m}`)}
        </span>
      ))}
    </div>
  );
}
