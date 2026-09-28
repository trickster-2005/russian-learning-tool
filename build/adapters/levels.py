"""LevelProvider: CEFR levels from SMARTool, Kelly, and a frequency estimate."""

from __future__ import annotations

import statistics
from dataclasses import dataclass

import xlrd

from common import CACHE, LEVELS, norm_key

from . import smartool

KELLY_POS = {
    "n": "NOUN",
    "n prop": "NOUN",
    "v": "VERB",
    "v mod": "VERB",
    "adj": "ADJ",
    "adv": "ADV",
    "num": "NUM",
    "pron": "PRON",
    "det": "PRON",
    "adpos": "FUNC",
    "prep": "FUNC",
    "particle": "FUNC",
    "con": "FUNC",
    "excl": "FUNC",
    "int": "FUNC",
}
LEVEL_RANK = {lvl: i for i, lvl in enumerate(LEVELS + ["beyond"])}


@dataclass
class LevelEntry:
    lemma: str
    pos: str | None
    level: str
    source: str


class LevelTable:
    """Matches (lemma, POS) against one source; entries with POS None match any POS."""

    def __init__(self, source: str) -> None:
        self.source = source
        self.by_key: dict[tuple[str, str | None], LevelEntry] = {}
        self.phrases: dict[str, str] = {}
        self.matched: set[tuple[str, str | None]] = set()

    def add(self, lemma: str, pos: str | None, level: str) -> None:
        if " " in lemma.strip():
            prev = self.phrases.get(lemma)
            if prev is None or LEVEL_RANK[level] < LEVEL_RANK[prev]:
                self.phrases[lemma.strip()] = level
            return
        key = (norm_key(lemma), pos)
        prev = self.by_key.get(key)
        if prev is None or LEVEL_RANK[level] < LEVEL_RANK[prev.level]:
            self.by_key[key] = LevelEntry(lemma, pos, level, self.source)

    def lookup(self, lemma: str, pos: str) -> str | None:
        k = norm_key(lemma)
        for key in ((k, pos), (k, None)):
            e = self.by_key.get(key)
            if e:
                self.matched.add(key)
                return e.level
        return None

    def unmatched(self) -> list[LevelEntry]:
        return [e for key, e in self.by_key.items() if key not in self.matched]

    def keys(self) -> set[str]:
        return {k for k, _ in self.by_key}


def split_pair(lemma: str) -> list[str]:
    """Aspect pairs such as 'делать/сделать' become two lemmas with the same level."""
    return [x.strip() for x in lemma.split("/") if x.strip()]


def load_kelly() -> LevelTable | None:
    path = CACHE / "kelly" / "ru_m3.xls"
    if not path.exists():
        return None
    table = LevelTable("kelly")
    book = xlrd.open_workbook(str(path), encoding_override="cp1251")
    sheet = book.sheet_by_index(0)
    header = [str(h).strip().lower() for h in sheet.row_values(0)]
    ci = {name: header.index(name) for name in ("lemma", "cefr", "pos")}
    for r in range(1, sheet.nrows):
        row = sheet.row_values(r)
        lemma = str(row[ci["lemma"]]).strip()
        level = str(row[ci["cefr"]]).strip().upper()
        pos = KELLY_POS.get(str(row[ci["pos"]]).strip().lower())
        if not lemma or level not in LEVELS:
            continue
        for part in split_pair(lemma):
            table.add(smartool.clean_lemma(part), pos, level)
    return table


def load_smartool(items) -> LevelTable | None:
    if items is None:
        return None
    table = LevelTable("smartool")
    for it in items.values():
        table.add(it.lemma, it.pos, it.level)
    return table


class Estimator:
    """Frequency-based estimate calibrated on Kelly's per-level Zipf medians."""

    def __init__(self, kelly: LevelTable | None, zipf) -> None:
        self.medians: dict[str, float] = {}
        self.bounds: list[tuple[float, str]] = []
        self.beyond_below: float | None = None
        if kelly is None:
            # Fallback thresholds if Kelly is missing: evenly spaced Zipf bands.
            self.medians = {lvl: 6.0 - 0.5 * i for i, lvl in enumerate(LEVELS)}
        else:
            per: dict[str, list[float]] = {lvl: [] for lvl in LEVELS}
            for e in kelly.by_key.values():
                z = zipf(e.lemma)
                if z > 0:
                    per[e.level].append(z)
            self.medians = {lvl: statistics.median(v) for lvl, v in per.items() if v}
        self.compute_bounds()

    def compute_bounds(self) -> None:
        med = self.medians
        self.bounds = []
        for a, b in zip(LEVELS, LEVELS[1:]):
            if a in med and b in med:
                self.bounds.append(((med[a] + med[b]) / 2, a))
        self.beyond_below = med.get("C2", 0) - 0.5

    def level(self, z: float) -> str:
        for bound, lvl in self.bounds:
            if z >= bound:
                return lvl
        if self.beyond_below is not None and z < self.beyond_below:
            return "beyond"
        return "C2"
