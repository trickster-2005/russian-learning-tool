import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nContext, type I18nValue, type Lang } from "./context";
import en from "./en.json";
import zh from "./zh-Hant.json";
import topicsZh from "./topics.zh-Hant.json";
import { readStore, writeStore } from "../lib/storage";

export type { Lang } from "./context";
type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict> = { en, "zh-Hant": zh };
const STORE_KEY = "rwf.lang";
const warned = new Set<string>();

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = DICTS[lang][key];
  if (s === undefined) {
    if (!warned.has(`${lang}:${key}`)) {
      warned.add(`${lang}:${key}`);
      console.warn(`[i18n] missing "${key}" for ${lang}`);
    }
    s = DICTS.en[key] ?? key;
  }
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

function langFromUrl(): Lang | null {
  const params = [window.location.search, window.location.hash.split("?")[1] ?? ""];
  for (const p of params) {
    const v = new URLSearchParams(p).get("lang");
    if (v === "en" || v === "zh-Hant") return v;
  }
  return null;
}

function initialLang(): Lang {
  const fromUrl = langFromUrl();
  if (fromUrl) return fromUrl;
  const stored = readStore(STORE_KEY);
  return stored === "zh-Hant" ? "zh-Hant" : "en";
}


export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = translate(lang, "app.title");
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writeStore(STORE_KEY, l);
    // Keep an explicit ?lang= in the URL consistent with the choice.
    const [path, query = ""] = window.location.hash.split("?");
    const params = new URLSearchParams(query);
    if (params.has("lang")) {
      params.set("lang", l);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${path}?${params}`);
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      topicName: (topic, enName) =>
        lang === "zh-Hant" ? (topicsZh as Dict)[topic] ?? enName ?? topic : enName ?? topic,
    }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}
