"""Dictionary: English and Chinese (Traditional) glosses."""

from __future__ import annotations

import re

from common import Sourced, norm_key, truncate

from .wiktionary import pick

_BRACKETS = re.compile(r"〔[^〕]*〕|\{[^}]*\}|〈[^〉]*〉|【[^】]*】|\[[^\]]*\]")
_CYR = "А-Яа-яЁё́̀"
_LEAD_CYR = re.compile(rf"^[\s{_CYR}\-,;/.]+(?=[㐀-鿿…(（])")
_SEE = re.compile(rf"見\s*[{_CYR}\-]+")
_FIRST_CYR = re.compile(rf"[{_CYR}]")
_CJK = re.compile(r"[㐀-鿿]")


class ChineseConverter:
    def __init__(self) -> None:
        import opencc

        try:
            self.cc = opencc.OpenCC("s2twp")
        except Exception:  # noqa: BLE001 - some builds want the .json name
            self.cc = opencc.OpenCC("s2twp.json")

    def convert(self, text: str) -> str:
        return self.cc.convert(text)


def clean_zh(text: str, cc: ChineseConverter | None) -> str:
    """OpenCC s2twp, then drop grammar markers, example material and stray Russian."""
    t = cc.convert(text) if cc else text
    t = _BRACKETS.sub("", t)
    t = re.split(r"[～~‖#]", t)[0]  # dictionary examples / notes start after these marks
    t = _SEE.sub("", t)  # "見писать" (see ...) cross-references
    t = _LEAD_CYR.sub("", t)
    m = _FIRST_CYR.search(t)
    if m:  # leftover Russian (example phrases, inflection notes): cut there
        t = t[: m.start()]
    t = _balance_parens(t)
    t = re.sub(r"\s+", " ", t).strip(" .;；，,。:：?？*/")
    return t if _CJK.search(t) else ""


def _balance_parens(t: str) -> str:
    for o, c in (("(", ")"), ("（", "）")):
        if t.count(c) > t.count(o) and t.lstrip().find(c) < (t.find(o) if o in t else len(t)):
            t = t.replace(c, "", 1)
        if t.count(o) > t.count(c):
            idx = t.rfind(o)
            t = t[:idx]
    return t


class Dictionary:
    def __init__(self, lang: str, overrides: dict[str, str], wikt, smartool_idx=None, max_chars=80, max_senses=2):
        self.lang = lang
        self.overrides = overrides or {}
        self.wikt = wikt or {}
        self.smartool = smartool_idx or {}
        self.max_chars = max_chars
        self.max_senses = max_senses
        self.cc = ChineseConverter() if lang == "zh" else None

    def gloss(self, lemma: str, pos: str) -> Sourced | None:
        if lemma in self.overrides:
            return Sourced(truncate(self.overrides[lemma], self.max_chars), "curated", 1.0)
        key = norm_key(lemma)
        if self.lang == "en":
            items = self.smartool.get(key, [])
            items = [i for i in items if i.pos == pos] or [i for i in items if i.pos is None]
            if items and items[0].gloss:
                return Sourced(truncate(items[0].gloss, self.max_chars), "smartool", 1.0)
        e = pick(self.wikt.get(key), pos, "glosses")
        if not e:
            return None
        senses = e.glosses
        if self.lang == "en":
            # "to write down (to set something down in writing)" -> "to write down"
            senses = [re.sub(r"\s*\([^()]*\)", "", g).strip() or g for g in senses]
        if self.lang == "zh":
            senses = [clean_zh(g, self.cc) for g in senses]
            senses = [g for g in senses if g]
        senses = list(dict.fromkeys(senses))[: self.max_senses]
        if not senses:
            return None
        sep = "；" if self.lang == "zh" else "; "
        return Sourced(truncate(sep.join(senses), self.max_chars), f"wiktionary-{self.lang}", 1.0)
