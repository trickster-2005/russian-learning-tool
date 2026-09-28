import { useEffect, useRef, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { useI18n } from "../i18n";
import { MY_LEVELS, useSettings, type ColorBy, type Theme } from "../lib/settings";
import type { Level } from "../data/types";
import SearchBox from "./SearchBox";
import { readStore } from "../lib/storage";

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function SettingsMenu() {
  const { t } = useI18n();
  const s = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="settings" ref={ref}>
      <button
        className="icon-btn"
        aria-label={t("settings.open")}
        aria-expanded={open}
        title={t("settings.title")}
        onClick={() => setOpen((o) => !o)}
      >
        <GearIcon />
      </button>
      {open && (
        <div className="settings-panel" role="dialog" aria-label={t("settings.title")}>
          <label>
            {t("settings.levelSource")}
            <select value={s.levelSource} onChange={(e) => s.setLevelSource(e.target.value as "teaching" | "frequency")}>
              <option value="teaching">{t("settings.levelSource.teaching")}</option>
              <option value="frequency">{t("settings.levelSource.frequency")}</option>
            </select>
          </label>
          <label>
            {t("settings.myLevel")}
            <select value={s.myLevel ?? ""} onChange={(e) => s.setMyLevel((e.target.value || null) as Level | null)}>
              <option value="">{t("settings.myLevel.none")}</option>
              {MY_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("settings.colorBy")}
            <select value={s.colorBy} onChange={(e) => s.setColorBy(e.target.value as ColorBy)}>
              <option value="level">{t("settings.colorBy.level")}</option>
              <option value="pos">{t("settings.colorBy.pos")}</option>
            </select>
          </label>
          <label>
            {t("settings.theme")}
            <select value={s.theme} onChange={(e) => s.setTheme(e.target.value as Theme)}>
              <option value="system">{t("settings.theme.system")}</option>
              <option value="light">{t("settings.theme.light")}</option>
              <option value="dark">{t("settings.theme.dark")}</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  const { t, lang, setLang } = useI18n();
  const loc = useLocation();
  const isHome = loc.pathname === "/";
  const lastFamily = loc.pathname.startsWith("/family/") ? loc.pathname.split("/")[2] : readStore("rwf.lastFamily");
  return (
    <header className="topbar">
      <a className="skip-link" href="#main" onClick={(e) => {
        e.preventDefault();
        document.getElementById("main")?.focus();
      }}>
        {t("app.skip")}
      </a>
      <Link to="/" className="brand">
        {t("app.title")}
      </Link>
      {!isHome && <SearchBox />}
      <nav className="topnav" aria-label={t("nav.main")}>
        {lastFamily && <NavLink to={`/family/${lastFamily}`}>{t("nav.family")}</NavLink>}
        <NavLink to="/browse">{t("nav.browse")}</NavLink>
        <NavLink to="/about">{t("nav.about")}</NavLink>
        <div className="lang-toggle" role="group" aria-label={t("lang.label")}>
          <button aria-pressed={lang === "en"} lang="en" onClick={() => setLang("en")}>
            EN
          </button>
          <button aria-pressed={lang === "zh-Hant"} lang="zh-Hant" onClick={() => setLang("zh-Hant")}>
            中文
          </button>
        </div>
        <SettingsMenu />
      </nav>
    </header>
  );
}
