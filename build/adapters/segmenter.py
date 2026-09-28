"""Segmenter: morpheme segmentation from curated data, DeriNet, Wiktionary, or a model."""

from __future__ import annotations

import os
import re
import warnings
from importlib import metadata
from pathlib import Path

from common import CACHE, Morpheme, Segmentation, log_decision

from .derinet import parse_segmentation

VALID_TYPES = {"PREF", "ROOT", "SUFF", "END", "POSTFIX", "LINK", "HYPH"}
PERMISSIVE = ("MIT", "APACHE", "BSD")
INFINITIVE_ENDINGS = {"ть", "ти", "чь"}


def parse_override(spec: str) -> list[Morpheme]:
    """'за:PREF пис:ROOT а:SUFF ть:END' -> morphemes."""
    out = []
    for tok in spec.split():
        text, typ = tok.split(":", 1)
        out.append(Morpheme(text=text, type=typ.upper()))  # type: ignore[arg-type]
    return out


def postprocess(morphemes: list[Morpheme], word: str) -> list[Morpheme] | None:
    """Fix infinitive endings, drop unknown types; reject if it doesn't spell the word."""
    fixed: list[Morpheme] = []
    for m in morphemes:
        typ = m.type if m.type in VALID_TYPES else "SUFF"
        if typ == "SUFF" and m.text in INFINITIVE_ENDINGS:
            typ = "END"
        fixed.append(Morpheme(text=m.text, type=typ))
    # The infinitive ending must be the last non-postfix morpheme.
    if "".join(m.text for m in fixed) != word.lower():
        return None
    return fixed


def license_of(dist: str, vendor_dir: Path | None = None) -> str | None:
    """Read a package's license from its LICENSE file or metadata."""
    texts = []
    if vendor_dir and (vendor_dir / "LICENSE").exists():
        texts.append((vendor_dir / "LICENSE").read_text(encoding="utf-8", errors="replace")[:400])
    try:
        md = metadata.metadata(dist)
        texts.append(md.get("License") or "")
        texts.extend(v for k, v in md.items() if k == "Classifier" and "License" in v)
    except metadata.PackageNotFoundError:
        return None
    blob = " ".join(texts).upper()
    for name in PERMISSIVE:
        if name in blob:
            return name
    return blob[:60] or None


class ModelSegmenter:
    """rumorpheme (MIT) CNN segmenter; confidence = min morpheme probability."""

    def __init__(self) -> None:
        self.model = None
        self.source = "none"
        lic = license_of("rumorpheme", CACHE / "vendor" / "ruMorpheme")
        if lic in PERMISSIVE:
            os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
            warnings.filterwarnings("ignore")
            from rumorpheme.model import RuMorphemeModel
            from rumorpheme.utils import labels_to_morphemes

            self.model = RuMorphemeModel.from_pretrained("evilfreelancer/ruMorpheme-v0.2")
            self.model.eval()
            self.labels_to_morphemes = labels_to_morphemes
            self.source = "rumorpheme"
            log_decision(f"Segmentation model: rumorpheme license detected as {lic} (from its LICENSE file) -> used, weights evilfreelancer/ruMorpheme-v0.2.")
            log_decision(
                "rumorpheme predictions include the BEGIN position; labels are shifted by one ([1:]) before "
                "labels_to_morphemes, otherwise every boundary is off by one letter (за|пис|а|ть vs зап|иса|т|ь)."
            )
        else:
            log_decision(f"Segmentation model: rumorpheme license '{lic}' not permissive; slovorez not installed -> model source skipped.")

    def segment_many(self, words: list[str], batch: int = 512) -> dict[str, Segmentation]:
        out: dict[str, Segmentation] = {}
        if self.model is None:
            return out
        words = [w for w in words if 0 < len(w) < 60 and re.fullmatch(r"[а-яё-]+", w.lower())]
        for i in range(0, len(words), batch):
            chunk = [w.lower() for w in words[i : i + batch]]
            preds, logps = self.model.predict(chunk)
            for j, w in enumerate(chunk):
                morphs, types, probs = self.labels_to_morphemes(w, preds[j][1:], logps[j][1:])
                ms = postprocess([Morpheme(text=m, type=t) for m, t in zip(morphs, types)], w)
                if ms and probs:
                    out[words[i + j]] = Segmentation(ms, self.source, float(min(probs)) / 100.0)
        return out


class Segmenter:
    def __init__(self, overrides: dict[str, str]) -> None:
        self.overrides = overrides or {}
        self.model = ModelSegmenter()
        self._model_cache: dict[str, Segmentation] = {}

    def prefetch(self, words: list[str]) -> None:
        todo = [w for w in words if w not in self.overrides]
        self._model_cache.update(self.model.segment_many(todo))

    def segment(self, lemma: str, derinet_raw: str = "") -> Segmentation | None:
        if lemma in self.overrides:
            ms = postprocess(parse_override(self.overrides[lemma]), lemma)
            if ms:
                return Segmentation(ms, "curated", 1.0)
        parsed = parse_segmentation(derinet_raw)
        if parsed:
            ms = postprocess([Morpheme(text=t, type=ty) for t, ty in parsed], lemma)  # type: ignore[arg-type]
            if ms:
                return Segmentation(ms, "derinet", 1.0)
        # Russian Wiktionary: no morpheme field exists in the kaikki extract (see DECISIONS.md).
        return self._model_cache.get(lemma)
