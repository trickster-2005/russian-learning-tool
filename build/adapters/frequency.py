"""FrequencyProvider: wordfreq Zipf frequencies and frequency stars."""

from __future__ import annotations

from functools import lru_cache

from wordfreq import zipf_frequency


class FrequencyProvider:
    source = "wordfreq"

    def __init__(self, star_thresholds: list[list[float]]) -> None:
        self.thresholds = [(float(z), int(s)) for z, s in star_thresholds]

    @lru_cache(maxsize=None)  # noqa: B019
    def zipf(self, lemma: str) -> float:
        return zipf_frequency(lemma.lower(), "ru")

    def stars(self, zipf: float) -> int:
        for threshold, stars in self.thresholds:
            if zipf >= threshold:
                return stars
        return 1
