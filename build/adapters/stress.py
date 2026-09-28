"""Stresser: stressed lemma spelling (vowel + U+0301)."""

from __future__ import annotations

import os
import warnings

from common import ACUTE, VOWELS, Sourced, has_stress, norm_key, normalize_stressed, vowel_count

from .wiktionary import pick


def plus_to_acute(text: str) -> str:
    """RUAccent marks stress with '+' before the vowel: 'запис+ать' -> 'записа́ть'."""
    out = []
    pending = False
    for ch in text:
        if ch == "+":
            pending = True
            continue
        out.append(ch)
        if pending and ch in VOWELS:
            out.append(ACUTE)
            pending = False
    return "".join(out)


class ModelStresser:
    source = "ruaccent"
    confidence = 0.7

    def __init__(self) -> None:
        self.acc = None

    def _load(self) -> None:
        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        warnings.filterwarnings("ignore")
        from ruaccent import RUAccent

        self.acc = RUAccent()
        self.acc.load(omograph_model_size="turbo3.1", use_dictionary=True)

    def stress(self, word: str) -> str | None:
        if self.acc is None:
            self._load()
        res = plus_to_acute(self.acc.process_all(word))
        res = normalize_stressed(res)
        return res if has_stress(res) and norm_key(res) == norm_key(word) else None


class Stresser:
    def __init__(self, overrides: dict[str, str], wikt_en, wikt_ru) -> None:
        self.overrides = overrides or {}
        self.en = wikt_en or {}
        self.ru = wikt_ru or {}
        self.model = ModelStresser()

    def stress(self, lemma: str, pos: str) -> Sourced:
        if lemma in self.overrides:
            return Sourced(normalize_stressed(self.overrides[lemma]), "curated", 1.0)
        if vowel_count(lemma) <= 1:
            return Sourced(lemma, "monosyllable", 1.0)
        if "ё" in lemma.lower():
            return Sourced(lemma, "yo", 1.0)
        key = norm_key(lemma)
        e = pick(self.en.get(key), pos, "stressed")
        if e and e.stressed:
            return Sourced(_match_case(e.stressed, lemma), "wiktionary-en", 1.0)
        e = pick(self.ru.get(key), pos, "stressed")
        if e and e.stressed:
            return Sourced(_match_case(e.stressed, lemma), "wiktionary-ru", 1.0)
        try:
            s = self.model.stress(lemma)
        except Exception:  # noqa: BLE001 - model unavailable: fall through to no stress
            s = None
        if s:
            return Sourced(_match_case(s, lemma), self.model.source, self.model.confidence)
        return Sourced(lemma, "none", 0.0)


def _match_case(stressed: str, lemma: str) -> str:
    """Keep the lemma's own letters (ё, capitalization); only add the accent."""
    out = []
    letters = iter(lemma)
    for ch in stressed:
        if ch == ACUTE:
            out.append(ch)
            continue
        out.append(next(letters, ch))
    return "".join(out)
