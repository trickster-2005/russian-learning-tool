import { createContext } from "react";

export type Lang = "en" | "zh-Hant";

export interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  topicName: (topic: string, en?: string) => string;
}

// Kept in its own module (no JSON imports) so editing translation files during
// development never creates a second context instance.
export const I18nContext = createContext<I18nValue | null>(null);
