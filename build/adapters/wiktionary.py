"""Streaming readers for the filtered kaikki.org Wiktionary extracts.

Only compact per-word records are kept in memory, and each extract is parsed
once and cached as a pickle in .cache/ for later builds.
"""

from __future__ import annotations

import gzip
import json
import pickle
from dataclasses import dataclass, field
from pathlib import Path

from common import CACHE, has_stress, norm_key, normalize_stressed, strip_stress

EN_POS = {
    "noun": "NOUN",
    "name": "NOUN",
    "verb": "VERB",
    "adj": "ADJ",
    "adv": "ADV",
    "num": "NUM",
    "pron": "PRON",
    "prep": "FUNC",
    "conj": "FUNC",
    "particle": "FUNC",
    "intj": "FUNC",
    "det": "PRON",
    "participle": "ADJ",
}
SKIP_SENSE_TAGS = {"obsolete", "archaic", "rare", "dated"}
AFFIX_TEMPLATES = {"prefix", "pre", "suffix", "suf", "affix", "af", "confix", "con"}
CACHE_VERSION = 3


@dataclass
class WiktEntry:
    pos: str
    glosses: list[str] = field(default_factory=list)  # usable senses, in order
    stressed: str | None = None  # canonical form with U+0301
    etym: list[dict] = field(default_factory=list)  # affix templates (name + args)


def _sense_ok(sense: dict) -> bool:
    tags = set(sense.get("tags", []))
    if tags & SKIP_SENSE_TAGS:
        return False
    if "form-of" in tags or "alt-of" in tags or sense.get("form_of") or sense.get("alt_of"):
        return False
    return bool(sense.get("glosses"))


def _read(path: Path):
    if not path.exists() and Path(str(path) + ".gz").exists():
        path = Path(str(path) + ".gz")
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        for line in f:
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _pickle_path(name: str) -> Path:
    return CACHE / f"{name}.v{CACHE_VERSION}.pkl"


def _cached(name: str, builder):
    pkl = _pickle_path(name)
    if pkl.exists():
        with open(pkl, "rb") as f:
            return pickle.load(f)
    data = builder()
    with open(pkl, "wb") as f:
        pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)
    return data


def load_en() -> dict[str, list[WiktEntry]] | None:
    """English Wiktionary Russian entries keyed by normalized word."""
    path = CACHE / "wikt_en_ru.jsonl"
    if not path.exists() and not Path(str(path) + ".gz").exists() and not _pickle_path("wikt_en").exists():
        return None

    def build():
        out: dict[str, list[WiktEntry]] = {}
        for o in _read(path):
            word = o.get("word", "")
            if " " in word:
                continue
            senses = [s for s in o.get("senses", []) if _sense_ok(s)]
            glosses = [s["glosses"][-1] for s in senses]
            stressed = None
            for fm in o.get("forms", []):
                if "canonical" in fm.get("tags", []) and has_stress(fm.get("form", "")):
                    cand = normalize_stressed(fm["form"])
                    if norm_key(cand) == norm_key(word):
                        stressed = cand
                        break
            etym = [
                {"name": t.get("name"), "args": t.get("args", {})}
                for t in o.get("etymology_templates", []) or []
                if t.get("name") in AFFIX_TEMPLATES
            ]
            if not glosses and not stressed and not etym:
                continue
            out.setdefault(norm_key(word), []).append(
                WiktEntry(pos=EN_POS.get(o.get("pos", ""), "OTHER"), glosses=glosses, stressed=stressed, etym=etym)
            )
        return out

    return _cached("wikt_en", build)


def load_zh() -> dict[str, list[WiktEntry]] | None:
    path = CACHE / "wikt_zh_ru.jsonl"
    if not path.exists() and not _pickle_path("wikt_zh").exists():
        return None

    def build():
        out: dict[str, list[WiktEntry]] = {}
        for o in _read(path):
            word = o.get("word", "")
            if " " in word:
                continue
            glosses = [s["glosses"][-1] for s in o.get("senses", []) if _sense_ok(s)]
            if glosses:
                out.setdefault(norm_key(word), []).append(
                    WiktEntry(pos=EN_POS.get(o.get("pos", ""), "OTHER"), glosses=glosses)
                )
        return out

    return _cached("wikt_zh", build)


def load_ru() -> dict[str, list[WiktEntry]] | None:
    """Russian Wiktionary: only the stressed spelling of the headword is used."""
    path = CACHE / "wikt_ru_ru.jsonl"
    if not path.exists() and not _pickle_path("wikt_ru").exists():
        return None

    def build():
        out: dict[str, list[WiktEntry]] = {}
        for o in _read(path):
            word = o.get("word", "")
            if " " in word:
                continue
            key = norm_key(word)
            stressed = None
            cands = [word] + [fm.get("form", "") for fm in o.get("forms", [])]
            for cand in cands:
                if has_stress(cand) and norm_key(cand) == key:
                    stressed = normalize_stressed(cand)
                    break
            has_gloss = any(_sense_ok(s) for s in o.get("senses", []))
            if stressed or has_gloss:
                out.setdefault(key, []).append(
                    WiktEntry(pos=EN_POS.get(o.get("pos", ""), "OTHER"), glosses=["+"] if has_gloss else [], stressed=stressed)
                )
        return out

    return _cached("wikt_ru", build)


def pick(entries: list[WiktEntry] | None, pos: str, need: str) -> WiktEntry | None:
    """First entry with the wanted attribute, preferring a POS match."""
    if not entries:
        return None
    matching = [e for e in entries if e.pos == pos and getattr(e, need)]
    if matching:
        return matching[0]
    anyp = [e for e in entries if getattr(e, need)]
    return anyp[0] if anyp else None


def parse_affix_template(t: dict) -> tuple[list[str], str | None, list[str]]:
    """Return (prefixes, base, suffixes) from an etymology template.

    Handles {{prefix|ru|за|писать}}, {{suffix|ru|писать|тель}} and
    {{af|ru|за-|писать}} / {{affix|ru|писа́ть|-тель}}. Stress marks removed.
    """
    args = t.get("args", {})
    parts = [strip_stress(str(args[k])).strip() for k in sorted((k for k in args if k.isdigit()), key=int)]
    parts = [p for p in parts[1:] if p]  # drop the language code
    name = t.get("name")
    prefixes: list[str] = []
    suffixes: list[str] = []
    base = None
    if name in ("prefix", "pre") and len(parts) >= 2:
        prefixes = [p.strip("-") + "-" for p in parts[:-1]]
        base = parts[-1]
    elif name in ("suffix", "suf") and len(parts) >= 2:
        base = parts[0]
        suffixes = ["-" + p.strip("-") for p in parts[1:]]
    elif name in ("confix", "con") and len(parts) >= 3:
        prefixes = [parts[0].strip("-") + "-"]
        base = parts[1]
        suffixes = ["-" + parts[-1].strip("-")]
    else:
        for p in parts:
            if p.endswith("-") and not p.startswith("-"):
                prefixes.append(p)
            elif p.startswith("-") and len(p) > 1:
                suffixes.append(p if not p.endswith("-") else p)
            elif base is None:
                base = p
    return prefixes, base, suffixes
