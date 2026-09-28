import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Level } from "../data/types";
import type { LevelSource } from "./levels";
import { readStore, writeStore } from "./storage";

export type ColorBy = "level" | "pos";
export type Theme = "system" | "light" | "dark";

interface Settings {
  levelSource: LevelSource;
  myLevel: Level | null;
  colorBy: ColorBy;
  theme: Theme;
  setLevelSource: (v: LevelSource) => void;
  setMyLevel: (v: Level | null) => void;
  setColorBy: (v: ColorBy) => void;
  setTheme: (v: Theme) => void;
}

const MY_LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = readStore(key);
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const Ctx = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [levelSource, setLS] = useState<LevelSource>(() =>
    stored("rwf.levelSource", ["teaching", "frequency"] as const, "teaching"),
  );
  const [myLevel, setML] = useState<Level | null>(() => {
    const v = readStore("rwf.myLevel");
    return v && (MY_LEVELS as string[]).includes(v) ? (v as Level) : null;
  });
  const [colorBy, setCB] = useState<ColorBy>(() => stored("rwf.colorBy", ["level", "pos"] as const, "level"));
  const [theme, setTh] = useState<Theme>(() => stored("rwf.theme", ["system", "light", "dark"] as const, "system"));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  const value = useMemo<Settings>(
    () => ({
      levelSource,
      myLevel,
      colorBy,
      theme,
      setLevelSource: (v) => {
        setLS(v);
        writeStore("rwf.levelSource", v);
      },
      setMyLevel: (v) => {
        setML(v);
        writeStore("rwf.myLevel", v);
      },
      setColorBy: (v) => {
        setCB(v);
        writeStore("rwf.colorBy", v);
      },
      setTheme: (v) => {
        setTh(v);
        writeStore("rwf.theme", v);
      },
    }),
    [levelSource, myLevel, colorBy, theme],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings outside SettingsProvider");
  return v;
}

export { MY_LEVELS };
