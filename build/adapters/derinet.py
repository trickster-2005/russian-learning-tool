"""FamilyProvider: DeriNet.RU trees (DeriNet 2.0 TSV format)."""

from __future__ import annotations

import gzip
import re
from dataclasses import dataclass, field
from pathlib import Path

from common import CACHE, Node, log_decision

EXPECTED = ["ID", "LEMID", "LEMMA", "POS", "FEATS", "SEGMENTATION", "PARENTID", "RELTYPE", "OTHERPARENTS", "MISC"]
_ID_RE = re.compile(r"^\d+\.\d+$")


@dataclass
class Tree:
    id: str
    nodes: dict[str, Node] = field(default_factory=dict)
    root: str = ""

    def descendants(self, nid: str) -> list[str]:
        out, stack = [], [nid]
        while stack:
            cur = stack.pop()
            out.append(cur)
            stack.extend(self.nodes[cur].children)
        return out


def find_file() -> Path | None:
    d = CACHE / "derinet"
    if not d.exists():
        return None
    for pat in ("*.tsv", "*.tsv.gz"):
        files = sorted(d.rglob(pat))
        if files:
            return files[0]
    return None


def _open(path: Path):
    return gzip.open(path, "rt", encoding="utf-8") if path.suffix == ".gz" else open(path, encoding="utf-8")


def detect_columns(path: Path) -> dict[str, int]:
    """Read the first 200 lines and map column names to indices."""
    widths: dict[int, int] = {}
    samples: list[list[str]] = []
    with _open(path) as f:
        for i, line in enumerate(f):
            if i >= 200:
                break
            parts = line.rstrip("\n").split("\t")
            if len(parts) > 1:
                widths[len(parts)] = widths.get(len(parts), 0) + 1
                samples.append(parts)
    width = max(widths, key=widths.get)
    cols = {name: i for i, name in enumerate(EXPECTED[:width])}
    # Sanity-check the layout against the samples.
    assert all(_ID_RE.match(s[cols["ID"]]) for s in samples), "ID column not in N.M format"
    assert all("#" in s[cols["LEMID"]] for s in samples), "LEMID column lacks '#'"
    pos_seen = sorted({s[cols["POS"]] for s in samples})
    log_decision(
        f"DeriNet.RU file {path.name}: {width} tab-separated columns detected, mapped as DeriNet 2.0 "
        f"({', '.join(EXPECTED[:width])}); POS values in first 200 lines: {pos_seen}."
    )
    return cols


def load_trees() -> dict[str, Tree]:
    path = find_file()
    if path is None:
        raise FileNotFoundError("DeriNet.RU data not found in .cache/derinet")
    cols = detect_columns(path)
    trees: dict[str, Tree] = {}
    with _open(path) as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 4:
                continue
            nid = parts[cols["ID"]]
            tid = nid.split(".")[0]
            tree = trees.setdefault(tid, Tree(id=tid))
            parent = parts[cols["PARENTID"]] if "PARENTID" in cols else ""
            others = parts[cols["OTHERPARENTS"]] if "OTHERPARENTS" in cols else ""
            node = Node(
                id=nid,
                lemma=parts[cols["LEMMA"]],
                pos=parts[cols["POS"]],
                parent=parent or None,
                segmentation_raw=parts[cols["SEGMENTATION"]] if "SEGMENTATION" in cols else "",
                other_parents=[p for p in re.split(r"[,&| ]", others) if _ID_RE.match(p)],
            )
            tree.nodes[nid] = node
    for tree in trees.values():
        for node in tree.nodes.values():
            if node.parent and node.parent in tree.nodes:
                tree.nodes[node.parent].children.append(node.id)
            else:
                node.parent = None
                tree.root = tree.root or node.id
    return trees


def parse_segmentation(raw: str) -> list[tuple[str, str]] | None:
    """DeriNet 2.0 segmentation is not present in DeriNet.RU 0.5; kept for future versions.

    Accepts 'за:PREF|пис:ROOT|а:SUFF|ть:END'-like strings.
    """
    if not raw:
        return None
    out = []
    for piece in re.split(r"[|&]", raw):
        if ":" in piece:
            text, typ = piece.split(":", 1)
            out.append((text, typ.upper()))
    return out or None
