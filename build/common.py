"""Shared types, constants and normalization helpers for the build."""

from __future__ import annotations

import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

import yaml

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
CURATED = ROOT / "curated"
REPORTS = ROOT / "reports"
OUT = ROOT.parent / "web" / "public" / "data"
DECISIONS = ROOT.parent / "DECISIONS.md"

ACUTE = "́"
GRAVE = "̀"
VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")

MorphType = Literal["PREF", "ROOT", "SUFF", "END", "POSTFIX", "LINK", "HYPH"]
POS_CODES = ["NOUN", "VERB", "ADJ", "ADV", "NUM", "PRON", "FUNC", "OTHER"]
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]


@dataclass
class Morpheme:
    text: str
    type: MorphType


@dataclass
class Segmentation:
    morphemes: list[Morpheme]
    source: str
    confidence: float

    def to_json(self, uncertain_below: float = 0.8) -> dict:
        return {
            "morphemes": [asdict(m) for m in self.morphemes],
            "source": self.source,
            "confidence": round(self.confidence, 3),
            "uncertain": self.confidence < uncertain_below,
        }


@dataclass
class Sourced:
    """A value with provenance, as every adapter output carries."""

    value: object
    source: str
    confidence: float = 1.0


@dataclass
class Node:
    """A DeriNet lexeme inside one family tree."""

    id: str
    lemma: str
    pos: str
    parent: str | None = None
    children: list[str] = field(default_factory=list)
    segmentation_raw: str = ""
    other_parents: list[str] = field(default_factory=list)


def load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_config() -> dict:
    return load_yaml(ROOT / "config.yaml")


def strip_stress(s: str) -> str:
    return unicodedata.normalize("NFC", s.replace(ACUTE, "").replace(GRAVE, ""))


def norm_key(s: str) -> str:
    """Matching key: lowercase, stress marks removed, ё -> е, trimmed."""
    s = strip_stress(unicodedata.normalize("NFD", s.strip().lower()))
    return unicodedata.normalize("NFC", s).replace("ё", "е")


def shard_of(word: str) -> str:
    """Shard name from the first two letters of the normalized word."""
    k = norm_key(word)
    k = "".join(ch for ch in k if ch.isalpha()) or "_"
    return (k[:2] if len(k) >= 2 else k + "_").lower()


def vowel_count(word: str) -> int:
    return sum(1 for ch in word if ch in VOWELS)


def has_stress(word: str) -> bool:
    return ACUTE in unicodedata.normalize("NFD", word)


def normalize_stressed(word: str) -> str:
    """Keep stress as vowel + U+0301; normalize everything else to NFC.

    NFC would never compose Cyrillic vowel + U+0301 (no precomposed forms
    exist except for a few Latin-looking letters), but we decompose first so
    precomposed forms such as 'ó' in mixed input also end up as vowel + U+0301.
    Grave accents (secondary stress in Wiktionary) are dropped.
    """
    d = unicodedata.normalize("NFD", word).replace(GRAVE, "")
    out = []
    for ch in d:
        # Recompose й and ё (base + combining), keep U+0301 separate.
        if ch == "̆" and out and out[-1] in "иИ":
            out[-1] = "й" if out[-1] == "и" else "Й"
        elif ch == "̈" and out and out[-1] in "еЕ":
            out[-1] = "ё" if out[-1] == "е" else "Ё"
        else:
            out.append(ch)
    return "".join(out)


def is_cyrillic_word(s: str) -> bool:
    return bool(s) and all(("а" <= ch.lower() <= "я") or ch.lower() == "ё" or ch in "-" for ch in s)


def truncate(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip(" ,;") + "…"


_decisions_logged: set[str] = set()


def log_decision(text: str) -> None:
    """Append a one-line decision to DECISIONS.md (deduplicated)."""
    line = f"- {text}"
    existing = DECISIONS.read_text(encoding="utf-8") if DECISIONS.exists() else "# Decisions\n\n"
    if line in existing or line in _decisions_logged:
        return
    _decisions_logged.add(line)
    DECISIONS.write_text(existing.rstrip("\n") + "\n" + line + "\n", encoding="utf-8")
