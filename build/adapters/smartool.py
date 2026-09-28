"""Shared SMARTool CSV reader (levels, glosses, examples, topics)."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field

from common import CACHE, norm_key

LEVEL_FILES = ["A1", "A2", "B1", "B2"]
_PAREN = re.compile(r"\s*\([^)]*\)\s*$")


@dataclass
class SmartoolLemma:
    lemma: str
    pos: str | None  # unified POS or None if unmappable
    level: str
    gloss: str = ""
    topics: list[str] = field(default_factory=list)
    examples: list[dict] = field(default_factory=list)


def map_pos(code: str, lemma: str) -> str | None:
    if code.startswith("N"):
        return "NOUN"
    if code == "V":
        return "VERB"
    if code == "A":
        # Some verbs are tagged "A" in the source; trust the infinitive ending instead.
        if lemma.endswith(("ть", "ться", "ти", "тись", "чь", "чься")):
            return "VERB"
        return "ADJ"
    return None


def clean_lemma(lemma: str) -> str:
    """Drop disambiguation marks such as 'болеть(е)'."""
    return _PAREN.sub("", lemma).strip()


def load() -> dict[tuple[str, str | None], SmartoolLemma] | None:
    d = CACHE / "smartool"
    if not (d / "SMARTool_data_A1.csv").exists():
        return None
    out: dict[tuple[str, str | None], SmartoolLemma] = {}
    for lvl in LEVEL_FILES:
        path = d / f"SMARTool_data_{lvl}.csv"
        if not path.exists():
            continue
        with open(path, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                raw = (row.get("Target language lemma") or "").strip()
                level = (row.get("Level") or "").strip().upper()
                if not raw or "deleted" in raw or level not in LEVEL_FILES:
                    continue
                for lemma in (clean_lemma(x) for x in raw.split("/")):
                    if not lemma:
                        continue
                    pos = map_pos((row.get("POS") or "").strip(), lemma)
                    key = (lemma, pos)
                    item = out.get(key)
                    if item is None:
                        item = out[key] = SmartoolLemma(lemma=lemma, pos=pos, level=level)
                    gloss = (row.get("User language gloss") or row.get("English gloss") or "").strip()
                    if gloss and not item.gloss:
                        item.gloss = gloss
                    for t in (row.get("Topic(s)") or "").split(","):
                        t = t.strip()
                        if t and t != "_" and t not in item.topics:
                            item.topics.append(t)
                    ru = (row.get("Target language example sentence") or "").strip()
                    en = (row.get("User language translation") or row.get("English translation") or "").strip()
                    form = (row.get("Form") or "").strip()
                    if ru and ru not in (e["ru"] for e in item.examples):
                        item.examples.append({"ru": ru, "en": en, "form": form})
    return out


def load_topics() -> dict[str, str]:
    path = CACHE / "smartool" / "SMARTool_data_Topics.csv"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        return {r["Topic"].strip(): r["User language translation"].strip() for r in csv.DictReader(f)}


def index_by_key(items: dict[tuple[str, str | None], SmartoolLemma]) -> dict[str, list[SmartoolLemma]]:
    idx: dict[str, list[SmartoolLemma]] = {}
    for it in items.values():
        idx.setdefault(norm_key(it.lemma), []).append(it)
    return idx
