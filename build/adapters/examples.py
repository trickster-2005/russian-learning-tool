"""ExampleProvider: SMARTool example sentences and topics."""

from __future__ import annotations

from common import norm_key


class ExampleProvider:
    source = "smartool"

    def __init__(self, smartool_idx, max_per_lemma: int = 3) -> None:
        self.idx = smartool_idx or {}
        self.max = max_per_lemma

    def _items(self, lemma: str, pos: str):
        items = self.idx.get(norm_key(lemma), [])
        return [i for i in items if i.pos == pos] or [i for i in items if i.pos is None]

    def examples(self, lemma: str, pos: str) -> list[dict]:
        out: list[dict] = []
        for it in self._items(lemma, pos):
            for ex in it.examples:
                if len(out) >= self.max:
                    return out
                out.append(ex)
        return out

    def topics(self, lemma: str, pos: str) -> list[str]:
        out: list[str] = []
        for it in self._items(lemma, pos):
            out.extend(t for t in it.topics if t not in out)
        return out
