"""MorphAnalyzer: pymorphy3 wrapper producing unified POS codes and features."""

from __future__ import annotations

from functools import lru_cache

import pymorphy3

from common import norm_key

# pymorphy3 POS -> unified code (spec section 7)
PYMORPHY_POS = {
    "NOUN": "NOUN",
    "VERB": "VERB",
    "INFN": "VERB",
    "ADJF": "ADJ",
    "ADJS": "ADJ",
    "COMP": "ADJ",
    "PRTF": "ADJ",
    "PRTS": "ADJ",
    "ADVB": "ADV",
    "NUMR": "NUM",
    "NPRO": "PRON",
    "PREP": "FUNC",
    "CONJ": "FUNC",
    "PRCL": "FUNC",
    "INTJ": "FUNC",
    "PRED": "FUNC",
    "GRND": "VERB",
}
DERINET_POS = {"NOUN": "NOUN", "VERB": "VERB", "ADJ": "ADJ", "ADV": "ADV", "NUM": "NUM", "PRON": "PRON"}


class MorphAnalyzer:
    source = "pymorphy3"

    def __init__(self) -> None:
        self.m = pymorphy3.MorphAnalyzer()

    @lru_cache(maxsize=None)  # noqa: B019 - one analyzer per build
    def parses(self, word: str):
        return tuple(self.m.parse(word))

    def lemma_parses(self, lemma: str, pos: str | None = None) -> list:
        """Dictionary parses whose normal form is this lemma (optionally matching POS)."""
        key = norm_key(lemma)
        out = []
        for p in self.parses(lemma.lower()):
            if type(p.methods_stack[0][0]).__name__ != "DictionaryAnalyzer":
                continue
            if norm_key(p.normal_form) != key:
                continue
            if pos and unified_pos(p) != pos:
                continue
            out.append(p)
        return out

    def is_dictionary_lemma(self, lemma: str) -> bool:
        """Known to the dictionary as a lemma (participle adjectives count: their
        pymorphy normal form is the infinitive, so check the masc/sing/nomn form)."""
        if self.lemma_parses(lemma):
            return True
        key = norm_key(lemma)
        return any(
            type(p.methods_stack[0][0]).__name__ == "DictionaryAnalyzer"
            and p.tag.POS == "PRTF"
            and {"masc", "sing", "nomn"} <= p.tag.grammemes
            and norm_key(p.word) == key
            for p in self.parses(lemma.lower())
        )

    def best(self, lemma: str, pos: str) -> tuple[object | None, bool]:
        """Highest-scoring parse matching POS; returns (parse, pos_matched)."""
        ps = self.lemma_parses(lemma, pos)
        if ps:
            return max(ps, key=lambda p: p.score), True
        ps = self.lemma_parses(lemma)
        if ps:
            return max(ps, key=lambda p: p.score), False
        return None, False

    def features(self, lemma: str, pos: str, motion_verbs: set[str]) -> tuple[dict, bool, str | None]:
        """Features for the node, whether POS agreed, and pymorphy's own POS when it did not."""
        p, matched = self.best(lemma, pos)
        if pos == "ADJ" and not matched and self.is_participle_adj(lemma):
            return {}, True, None
        feats: dict = {}
        if pos == "NOUN":
            feats["gender"] = "unknown"
            feats["animacy"] = "unknown"
        if pos == "VERB":
            feats.update(
                aspect="unknown",
                reflexive=lemma.endswith(("ся", "сь")),
                transitivity="unknown",
                motion_verb=lemma in motion_verbs,
            )
        if p is None:
            return feats, False, None
        g = p.tag.grammemes
        if pos == "NOUN":
            if "Pltm" in g:
                feats["gender"] = "plural_only"
            elif "ms-f" in g:
                feats["gender"] = "common"
            else:
                for gen in ("masc", "femn", "neut"):
                    if gen in g:
                        feats["gender"] = gen
            if "anim" in g:
                feats["animacy"] = "anim"
            elif "inan" in g:
                feats["animacy"] = "inan"
        if pos == "VERB":
            feats["aspect"] = self.aspect(lemma)
            if "tran" in g:
                feats["transitivity"] = "tran"
            elif "intr" in g:
                feats["transitivity"] = "intr"
        return feats, matched, None if matched else unified_pos(p)

    def aspect(self, lemma: str) -> str:
        """perf / impf / biasp (both aspects with score >= 30% of the best) / unknown."""
        ps = [p for p in self.lemma_parses(lemma, "VERB") if p.tag.POS == "INFN"]
        if not ps:
            return "unknown"
        top = max(p.score for p in ps)
        perf = any("perf" in p.tag.grammemes and p.score >= 0.3 * top for p in ps)
        impf = any("impf" in p.tag.grammemes and p.score >= 0.3 * top for p in ps)
        if perf and impf:
            return "biasp"
        if perf:
            return "perf"
        if impf:
            return "impf"
        return "unknown"

    def is_participle_adj(self, lemma: str) -> bool:
        return any(p.tag.POS == "PRTF" for p in self.parses(lemma.lower()) if norm_key(p.word) == norm_key(lemma))

    def verb_forms(self, lemma: str, max_participles: int = 4) -> dict:
        ps = [p for p in self.lemma_parses(lemma, "VERB") if p.tag.POS == "INFN"]
        if not ps:
            return {"participles": [], "gerunds": []}
        lex = max(ps, key=lambda p: p.score).lexeme
        parts, gers = [], []
        for x in lex:
            g = x.tag.grammemes
            if x.tag.POS == "PRTF" and {"masc", "sing", "nomn"} <= g and x.word not in parts:
                parts.append(x.word)
            elif x.tag.POS == "GRND" and x.word not in gers:
                gers.append(x.word)
        return {"participles": parts[:max_participles], "gerunds": gers}

    def all_forms(self, lemma: str, pos: str) -> set[str]:
        """Every inflected form of the lemma (normalized keys), including the lemma itself."""
        forms = {norm_key(lemma)}
        ps = self.lemma_parses(lemma, pos) or self.lemma_parses(lemma)
        seen_lexemes = set()
        for p in ps:
            sig = (p.normal_form, p.tag.POS, p.tag.aspect)
            if sig in seen_lexemes:
                continue
            seen_lexemes.add(sig)
            for x in p.lexeme:
                forms.add(norm_key(x.word))
        return forms


def unified_pos(parse) -> str:
    return PYMORPHY_POS.get(parse.tag.POS or "", "OTHER")


def derinet_pos(pos: str) -> str:
    return DERINET_POS.get(pos, "OTHER")
