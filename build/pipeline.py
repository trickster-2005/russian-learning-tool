"""Build pipeline: DeriNet.RU + adapters -> in-memory model -> export.py writes JSON.

Run:  python pipeline.py
"""

from __future__ import annotations

import collections
import json
import time
from dataclasses import dataclass, field

from adapters import derinet as derinet_adapter
from adapters import levels as levels_adapter
from adapters import smartool as smartool_adapter
from adapters import wiktionary
from adapters.dictionary import Dictionary
from adapters.examples import ExampleProvider
from adapters.frequency import FrequencyProvider
from adapters.morph import MorphAnalyzer, derinet_pos
from adapters.segmenter import Segmenter
from adapters.stress import Stresser
from common import (
    CURATED,
    REPORTS,
    Segmentation,
    load_config,
    load_yaml,
    log_decision,
    norm_key,
)

ENDINGS = {
    "VERB": ("ться", "тись", "чься", "ть", "ти", "чь"),
    "ADJ": ("ый", "ий", "ой", "ин", "ов"),
    "NOUN": ("ие", "ье", "ия", "а", "я", "о", "е", "ь", "й", "ы", "и"),
    "ADV": ("о", "е", "и", "у"),
}


RARE_PARENT_GAP = 1.25
BASE_WORD_MIN_DERIVED = 10


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def stem(lemma: str, pos: str) -> str:
    w = lemma.lower()
    for end in ENDINGS.get(pos, ()):
        if w.endswith(end) and len(w) - len(end) >= 2:
            return w[: -len(end)]
    return w


def common_subsequence(a: str, b: str) -> int:
    """Length of the longest common subsequence (tolerates vowel alternations: чит/чт)."""
    prev = [0] * (len(b) + 1)
    for ca in a:
        cur = [0] * (len(b) + 1)
        for j, cb in enumerate(b, 1):
            cur[j] = prev[j - 1] + 1 if ca == cb else max(prev[j], cur[j - 1])
        prev = cur
    return prev[-1]


# ---------------------------------------------------------------------------
# Model


@dataclass
class Edge:
    parent: str
    child: str
    added_prefixes: list[str] = field(default_factory=list)
    added_suffixes: list[str] = field(default_factory=list)
    added_postfixes: list[str] = field(default_factory=list)
    root_alternation: bool = False
    pos_change: str = ""
    semantic_type: str | None = None
    affix_source: str = "none"


@dataclass
class Build:
    cfg: dict
    lemma: dict[str, str] = field(default_factory=dict)  # gid -> lemma
    pos: dict[str, str] = field(default_factory=dict)  # gid -> unified POS
    tree_of: dict[str, str] = field(default_factory=dict)  # gid -> original DeriNet tree id
    seg_raw: dict[str, str] = field(default_factory=dict)
    parent: dict[str, str | None] = field(default_factory=dict)
    valid: set[str] = field(default_factory=set)
    kept: set[str] = field(default_factory=set)
    path_nodes: set[str] = field(default_factory=set)
    zipf: dict[str, float] = field(default_factory=dict)
    cross_links: dict[str, list[str]] = field(default_factory=dict)  # gid -> [target gids]
    stats: collections.Counter = field(default_factory=collections.Counter)


class Pipeline:
    def __init__(self) -> None:
        self.cfg = load_config()
        self.b = Build(cfg=self.cfg)
        self.overrides = load_yaml(CURATED / "overrides.yaml")
        self.affixes = load_yaml(CURATED / "affixes.yaml")
        self.motion = {w for pair in load_yaml(CURATED / "motion_verbs.yaml")["pairs"] for w in pair}
        self.related_groups = load_yaml(CURATED / "related_families.yaml").get("groups", [])
        self.status = {}
        status_file = REPORTS / "download_status.json"
        if status_file.exists():
            self.status = json.loads(status_file.read_text(encoding="utf-8"))

    # -- step 0: sources ----------------------------------------------------
    def load_sources(self) -> None:
        log("loading sources")
        self.morph = MorphAnalyzer()
        self.freq = FrequencyProvider(self.cfg["stars"])
        self.smartool_items = smartool_adapter.load()
        self.smartool_idx = smartool_adapter.index_by_key(self.smartool_items) if self.smartool_items else {}
        self.kelly = levels_adapter.load_kelly()
        self.smartool_levels = levels_adapter.load_smartool(self.smartool_items)
        log("loading Wiktionary extracts (cached after the first run)")
        self.wikt_en = wiktionary.load_en()
        self.wikt_zh = wiktionary.load_zh()
        self.wikt_ru = wiktionary.load_ru()
        for name, data in (("en", self.wikt_en), ("zh", self.wikt_zh), ("ru", self.wikt_ru)):
            self.b.stats[f"wikt_{name}_words"] = len(data) if data else 0
            if data is None:
                log(f"  Wiktionary {name} missing: continuing without it")
        self.level_keys = set()
        for t in (self.kelly, self.smartool_levels):
            if t:
                self.level_keys |= t.keys()

    # -- step 1: family skeleton ---------------------------------------------
    def load_families(self) -> None:
        log("step 1: DeriNet.RU trees")
        trees = derinet_adapter.load_trees()
        b = self.b
        for tree in trees.values():
            for nid, node in tree.nodes.items():
                b.lemma[nid] = node.lemma
                b.pos[nid] = derinet_pos(node.pos)
                b.tree_of[nid] = tree.id
                b.seg_raw[nid] = node.segmentation_raw
                b.parent[nid] = node.parent
                if node.other_parents:
                    b.cross_links[nid] = list(node.other_parents)
        b.stats["derinet_trees"] = len(trees)
        b.stats["derinet_nodes"] = len(b.lemma)
        self.trees = trees

    def is_real_word(self, gid: str) -> bool:
        lemma = self.b.lemma[gid]
        key = norm_key(lemma)
        if self.morph.is_dictionary_lemma(lemma):
            return True
        if key in self.level_keys:
            return True
        for src in (self.wikt_en, self.wikt_ru):
            if src and any(e.glosses for e in src.get(key, [])):
                return True
        return False

    def pos_confirmed(self, g: str) -> bool:
        lemma, pos = self.b.lemma[g], self.b.pos[g]
        if self.morph.lemma_parses(lemma, pos):
            return True
        if pos == "ADJ" and self.morph.is_participle_adj(lemma):
            return True
        if self.wikt_en and any(e.pos == pos for e in self.wikt_en.get(norm_key(lemma), [])):
            return True
        return False

    def is_inflected_form(self, g: str) -> bool:
        """A word form stored as a lemma (говоря of говорить) when its lemma is also a node."""
        lemma = self.b.lemma[g]
        if self.morph.is_dictionary_lemma(lemma):
            return False
        key = norm_key(lemma)
        for p in self.morph.parses(lemma.lower()):
            if type(p.methods_stack[0][0]).__name__ != "DictionaryAnalyzer" or norm_key(p.word) != key:
                continue
            nf = norm_key(p.normal_form)
            if nf != key and nf in self.lemma_keys:
                return True
        return False

    def clean_trees(self) -> None:
        """Remove non-words; children attach to the nearest real-word ancestor."""
        log("step 1b: removing non-words")
        b = self.b
        b.valid = {gid for gid in b.lemma if self.is_real_word(gid)}
        b.stats["nonword_nodes_removed"] = len(b.lemma) - len(b.valid)
        # Duplicates with an unconfirmed POS (ходить NOUN next to ходить VERB) and inflected forms.
        self.lemma_keys = {norm_key(b.lemma[g]) for g in b.valid}
        confirmed = {g for g in b.valid if self.pos_confirmed(g)}
        confirmed_lemmas = {b.lemma[g] for g in confirmed}
        dup = {g for g in b.valid if g not in confirmed and b.lemma[g] in confirmed_lemmas}
        forms = {g for g in b.valid - dup if g not in confirmed and self.is_inflected_form(g)}
        b.valid -= dup | forms
        b.stats["wrong_pos_duplicates_removed"] = len(dup)
        b.stats["inflected_forms_removed"] = len(forms)
        log_decision(
            "A node whose POS neither pymorphy3 nor en-Wiktionary confirms is dropped when a node with the same "
            "lemma and a confirmed POS exists (DeriNet has e.g. ходить/приходить tagged NOUN besides VERB), and "
            "word forms stored as lemmas (говоря, a form of говорить) are dropped when their lemma is a node."
        )
        new_parent: dict[str, str | None] = {}
        for g in b.valid:
            p = b.parent[g]
            while p is not None and p not in b.valid:
                p = b.parent[p]
            new_parent[g] = p
        for g in b.lemma:
            b.parent[g] = new_parent.get(g) if g in b.valid else None
        log_decision(
            "DeriNet.RU 0.5 contains many non-words (e.g. пису, писить) as inner nodes. A node is kept only if "
            "pymorphy3 knows it as a dictionary lemma, or it has a Wiktionary (en/ru) sense, or it is in Kelly/SMARTool. "
            "Children of removed nodes attach to the nearest kept ancestor; nodes left without one become roots "
            "until a later step (Wiktionary etymology, then same-root matching) places them."
        )

    def segment_valid(self) -> None:
        """Model segmentation for every real word (needed to judge edges); cached on disk."""
        log(f"step 1d: segmenting {len(self.b.valid):,} real words (cached)")
        import pickle

        from common import CACHE

        self.segmenter = Segmenter(self.overrides.get("segmentation") or {})
        cache_file = CACHE / f"seg_{self.segmenter.model.source}.pkl"
        cached: dict = {}
        if cache_file.exists():
            with open(cache_file, "rb") as f:
                cached = pickle.load(f)
        words = sorted({self.b.lemma[g] for g in self.b.valid})
        todo = [w for w in words if w not in cached]
        if todo:
            cached.update(self.segmenter.model.segment_many(todo))
            with open(cache_file, "wb") as f:
                pickle.dump(cached, f, protocol=pickle.HIGHEST_PROTOCOL)
        self.segmenter._model_cache = cached

    def root_of(self, g: str) -> str:
        seg = self.segmenter.segment(self.b.lemma[g], self.b.seg_raw.get(g, ""))
        if seg:
            roots = [m.text for m in seg.morphemes if m.type == "ROOT"]
            if roots:
                return norm_key(max(roots, key=len))
        return stem(norm_key(self.b.lemma[g]), self.b.pos[g])

    def plausible(self, p: str, c: str) -> bool:
        rp, rc = self.root_of(p), self.root_of(c)
        short = min(len(rp), len(rc))
        if short == 0:
            return False
        need = max(1, -(-6 * short // 10))  # ceil(0.6 * short)
        return common_subsequence(rp, rc) >= need

    def complexity(self, g: str) -> int | None:
        """Number of prefixes, suffixes and postfixes (None when unsegmented)."""
        seg = self.segmenter.segment(self.b.lemma[g], self.b.seg_raw.get(g, ""))
        if not seg:
            return None
        return sum(1 for m in seg.morphemes if m.type in ("PREF", "SUFF", "POSTFIX"))

    def prefixes(self, g: str) -> int:
        seg = self.segmenter.segment(self.b.lemma[g], self.b.seg_raw.get(g, ""))
        return sum(1 for m in seg.morphemes if m.type == "PREF") if seg else 0

    def inverted(self, p: str, c: str) -> bool:
        """Derivation adds affixes and never removes a prefix (выговор→говорить is inverted)."""
        cp, cc = self.complexity(p), self.complexity(c)
        if cp is None or cc is None:
            return False
        return cp > cc or self.prefixes(p) > self.prefixes(c)

    def base_word_mismatch(self, p: str, c: str) -> bool:
        """c is a base word in Wiktionary (many derived terms) whose entry never mentions p (пися→писать)."""
        if not self.wikt_en:
            return False
        entries = [e for e in self.wikt_en.get(norm_key(self.b.lemma[c]), []) if e.pos == self.b.pos[c]]
        if not entries or entries[0].derived < BASE_WORD_MIN_DERIVED:
            return False
        pk = norm_key(self.b.lemma[p])
        if any(pk in e.related for e in entries):
            return False
        # The parent's own entry may list the child as derived (дело → делать).
        return not any(norm_key(self.b.lemma[c]) in e.related for e in self.wikt_en.get(pk, []))

    def rare_parent(self, p: str, c: str) -> bool:
        """A basic word hanging under a far rarer, unlisted word (пися→писать, бра→брать)."""
        if norm_key(self.b.lemma[p]) in self.level_keys:
            return False
        return self.zipf(c) - self.zipf(p) >= RARE_PARENT_GAP

    def cut_implausible(self) -> None:
        """Cut machine-built edges whose roots differ (деться -> он) or whose direction is inverted (запись -> писать)."""
        log("step 1e: cutting implausible DeriNet edges")
        b = self.b
        cut_roots = cut_inverted = cut_rare = cut_base = 0
        for g in sorted(b.valid):
            p = b.parent[g]
            if p is None or g in self.wikt_confirmed:
                continue
            if not self.plausible(p, g):
                b.parent[g] = None
                cut_roots += 1
            elif self.inverted(p, g):
                b.parent[g] = None
                cut_inverted += 1
            elif self.rare_parent(p, g):
                b.parent[g] = None
                cut_rare += 1
            elif self.base_word_mismatch(p, g):
                b.parent[g] = None
                cut_base += 1
        b.stats["edges_cut_root_mismatch"] = cut_roots
        b.stats["edges_cut_inverted"] = cut_inverted
        b.stats["edges_cut_rare_parent"] = cut_rare
        b.stats["edges_cut_base_word"] = cut_base
        log_decision(
            f"Base-word rule: when a word's en-Wiktionary entry lists at least {BASE_WORD_MIN_DERIVED} derived terms "
            "(Wiktionary treats it as a base) and neither entry mentions its unconfirmed DeriNet parent/child pair, "
            "the edge is cut (пися→писать, бри→брать, выговор→говорить). Also applied when re-attaching orphans."
        )
        log_decision(
            f"Unconfirmed DeriNet edges are also cut when the child is at least {RARE_PARENT_GAP} Zipf more frequent "
            "than a parent that is on no level list (пися→писать, бра→брать, новь→новый); the same test applies "
            "when re-attaching orphans."
        )
        log_decision(
            "DeriNet.RU edges not confirmed by Wiktionary are cut when parent and child roots (model segmentation, "
            "else stem) share a common subsequence shorter than 60% of the shorter root (keeps читать→чтение, "
            "cuts деться→он). The child's subtree then becomes its own family unless re-attached below."
        )
        log_decision(
            "Direction rule: derivation adds affixes, so an unconfirmed DeriNet edge whose parent has more "
            "prefixes+suffixes+postfixes (or more prefixes) than the child is treated as inverted and cut (запись→писать, вход→ходить, "
            "водить→вода). Orphan re-attachment only picks parents that are not more complex than the orphan."
        )

    def attach_orphans(self) -> None:
        """Roots that came from the same DeriNet tree re-join a node with the same root morph."""
        log("step 1f: re-attaching orphans by shared root")
        b = self.b
        by_tree: dict[str, list[str]] = collections.defaultdict(list)
        for g in b.valid:
            by_tree[b.tree_of[g]].append(g)
        attached = 0
        for g in sorted(b.valid):
            if b.parent[g] is not None:
                continue
            rg = self.root_of(g)
            if len(rg) < 3:
                continue
            best, best_score = None, None
            for c in by_tree[b.tree_of[g]]:
                if c == g or self._subtree_contains(b.parent, g, c):
                    continue
                if self.root_of(c) != rg or self.inverted(c, g) or self.rare_parent(c, g) or self.base_word_mismatch(c, g):
                    continue
                score = (len(b.lemma[c]) < len(b.lemma[g]), self.zipf(c))
                if best_score is None or score > best_score:
                    best, best_score = c, score
            if best is not None:
                b.parent[g] = best
                attached += 1
        b.stats["orphans_reattached_by_root"] = attached

    def _bfs(self, tree) -> list[str]:
        order, queue = [], [tree.root] + [g for g, n in tree.nodes.items() if n.parent is None and g != tree.root]
        seen = set()
        while queue:
            g = queue.pop(0)
            if g in seen:
                continue
            seen.add(g)
            order.append(g)
            queue.extend(tree.nodes[g].children)
        return order

    def _subtree_contains(self, parent_map, top: str, node: str) -> bool:
        """True if `node` is `top` or a descendant of it (walks up from node)."""
        cur: str | None = node
        steps = 0
        while cur is not None and steps < 10_000:
            if cur == top:
                return True
            cur = parent_map.get(cur)
            steps += 1
        return False

    def etym_bases(self, g: str) -> list[str]:
        """Bases named by the etymology of the first en-Wiktionary entry with this POS
        (later entries are often rare homographs, e.g. вода 'водить + -а')."""
        if not self.wikt_en:
            return []
        entries = self.wikt_en.get(norm_key(self.b.lemma[g]), [])
        same_pos = [e for e in entries if e.pos == self.b.pos[g]]
        entries = same_pos[:1] or entries[:1]
        out = []
        for e in entries:
            for t in e.etym:
                _, base, _ = wiktionary.parse_affix_template(t)
                if base and " " not in base:
                    k = norm_key(base)
                    if k != norm_key(self.b.lemma[g]) and k not in out:
                        out.append(k)
        return out

    def wiktionary_reparent(self) -> None:
        """Human-edited etymologies (en Wiktionary) outrank DeriNet's machine-built edges."""
        log("step 1c: Wiktionary etymology corrections")
        b = self.b
        by_key: dict[str, list[str]] = collections.defaultdict(list)
        for g in b.valid:
            by_key[norm_key(b.lemma[g])].append(g)
        moved = moved_across = 0
        self.wikt_confirmed: set[str] = set()
        for g in sorted(b.valid):
            bases = self.etym_bases(g)
            if not bases:
                continue
            cur_parent = b.parent[g]
            if cur_parent and norm_key(b.lemma[cur_parent]) in bases:
                self.wikt_confirmed.add(g)
                continue
            chosen = None
            for base in bases:
                cands = [c for c in by_key.get(base, []) if c != g]
                if not cands:
                    continue
                same_tree = [c for c in cands if b.tree_of[c] == b.tree_of[g]]
                c = max(same_tree or cands, key=lambda c: (b.pos[c] == b.pos[g], self.zipf(c)))
                if not self._subtree_contains(b.parent, g, c):
                    chosen = c
                    break
            if chosen:
                if b.tree_of[chosen] != b.tree_of[g]:
                    moved_across += 1
                moved += 1
                b.parent[g] = chosen
                self.wikt_confirmed.add(g)
            # Remaining bases elsewhere become cross links (e.g. compounds).
            for base in bases:
                for c in by_key.get(base, []):
                    if c != g and c != b.parent[g]:
                        b.cross_links.setdefault(g, [])
                        if c not in b.cross_links[g]:
                            b.cross_links[g].append(c)
        b.stats["wiktionary_reparented"] = moved
        b.stats["wiktionary_reparented_across_trees"] = moved_across
        log_decision(
            "Priority rule (human-edited > machine-built): when a word's en-Wiktionary affix etymology "
            "({{prefix}}, {{suffix}}, {{af}}, {{affix}}, {{confix}}) names a base that exists as a node, the word is "
            "re-attached under that base, even across DeriNet trees (cycles are skipped). Other named bases become cross_links."
        )

    def apply_family_overrides(self) -> None:
        b = self.b
        fam = self.overrides.get("family") or {}
        if not fam:
            return
        by_lemma: dict[str, list[str]] = collections.defaultdict(list)
        for g in b.valid:
            by_lemma[b.lemma[g]].append(g)
        for child, parent in fam.items():
            for g in by_lemma.get(child, []):
                if parent is None:
                    b.parent[g] = None
                    continue
                cands = [c for c in by_lemma.get(parent, []) if not self._subtree_contains(b.parent, g, c)]
                if cands:
                    b.parent[g] = max(cands, key=self.zipf)

    def zipf(self, g: str) -> float:
        z = self.b.zipf.get(g)
        if z is None:
            z = self.b.zipf[g] = self.freq.zipf(self.b.lemma[g])
        return z

    # -- step 2: frequency filter -----------------------------------------------
    def filter_common(self) -> None:
        log("step 2: frequency filter with path preservation")
        b = self.b
        min_zipf = float(self.cfg["filter"]["min_zipf"])
        wanted = {
            g for g in b.valid if self.zipf(g) >= min_zipf or norm_key(b.lemma[g]) in self.level_keys
        }
        kept = set(wanted)
        for g in wanted:
            p = b.parent[g]
            while p is not None and p not in kept:
                kept.add(p)
                b.path_nodes.add(p)
                p = b.parent[p]
        b.kept = kept
        b.stats["kept_nodes"] = len(kept)
        b.stats["path_nodes"] = len(b.path_nodes)

    # -- families -----------------------------------------------------------------
    def build_families(self) -> None:
        b = self.b
        children: dict[str, list[str]] = collections.defaultdict(list)
        roots = []
        for g in b.kept:
            p = b.parent[g]
            if p is None or p not in b.kept:
                b.parent[g] = None
                roots.append(g)
            else:
                children[p].append(g)
        self.children = children
        fams = []
        for r in roots:
            members, queue = [], [r]
            while queue:
                g = queue.pop(0)
                members.append(g)
                queue.extend(sorted(children.get(g, []), key=lambda c: (-self.zipf(c), b.lemma[c])))
            fams.append(members)
        fams.sort(key=lambda m: (-len(m), norm_key(b.lemma[m[0]])))
        self.families = {}
        self.family_of: dict[str, str] = {}
        for i, members in enumerate(fams, 1):
            fid = f"f{i:05d}"
            self.families[fid] = members
            for g in members:
                self.family_of[g] = fid
        b.stats["families"] = len(self.families)

    def assign_keys(self) -> None:
        """Lexicon key = lemma; homographs get 'lemma#POS' (then '#POS2'...)."""
        b = self.b
        self.key_of: dict[str, str] = {}
        taken: set[str] = set()
        order = sorted(b.kept, key=lambda g: (-len(self.families[self.family_of[g]]), -self.zipf(g), g))
        for g in order:
            k = b.lemma[g]
            if k in taken:
                k = f"{b.lemma[g]}#{b.pos[g]}"
                n = 2
                while k in taken:
                    k = f"{b.lemma[g]}#{b.pos[g]}{n}"
                    n += 1
            taken.add(k)
            self.key_of[g] = k
        b.stats["homograph_keys"] = sum(1 for g, k in self.key_of.items() if "#" in k)

    # -- steps 3-9: node annotation --------------------------------------------------
    def annotate(self) -> None:
        b = self.b
        cfg = self.cfg
        kept = sorted(b.kept, key=lambda g: self.key_of[g])
        log(f"step 3-9: segmentation, stress, glosses, features, levels, examples for {len(kept):,} lemmas")
        log("step 4-9: stress, glosses, features, levels, examples")
        self.stresser = Stresser(self.overrides.get("stress") or {}, self.wikt_en, self.wikt_ru)
        dict_en = Dictionary("en", self.overrides.get("gloss_en") or {}, self.wikt_en, self.smartool_idx,
                             cfg["gloss"]["max_chars"], cfg["gloss"]["max_senses"])
        dict_zh = Dictionary("zh", self.overrides.get("gloss_zh") or {}, self.wikt_zh, None,
                             cfg["gloss"]["max_chars"], cfg["gloss"]["max_senses"])
        examples = ExampleProvider(self.smartool_idx, cfg["examples"]["max_per_lemma"])
        self.estimator = levels_adapter.Estimator(self.kelly, self.freq.zipf)
        uncertain_below = cfg["segmentation"]["uncertain_below"]

        self.lexicon: dict[str, dict] = {}
        self.seg: dict[str, Segmentation | None] = {}
        self.levels = {"kelly": {}, "smartool": {}, "estimated": {}}
        self.examples: dict[str, list] = {}
        self.topics: dict[str, list] = {}
        self.pos_conflicts: list[tuple] = []
        cov = collections.Counter()
        for i, g in enumerate(kept):
            if i and i % 5000 == 0:
                log(f"  annotated {i:,}/{len(kept):,}")
            lemma, pos, key = b.lemma[g], b.pos[g], self.key_of[g]
            seg = self.segmenter.segment(lemma, b.seg_raw.get(g, ""))
            self.seg[g] = seg
            stress = self.stresser.stress(lemma, pos)
            gen = dict_en.gloss(lemma, pos)
            gzh = dict_zh.gloss(lemma, pos)
            feats, matched, other_pos = self.morph.features(lemma, pos, self.motion)
            if not matched:
                self.pos_conflicts.append((lemma, pos, other_pos or "unknown"))
            parent = b.parent[g]
            lexicalized = bool(
                pos == "ADJ" and parent and b.pos[parent] == "VERB" and self.morph.is_participle_adj(lemma)
            )
            z = self.zipf(g)
            entry = {
                "lemma": lemma,
                "pos": pos,
                "stressed": stress.value,
                "stress_source": stress.source,
                "segmentation": seg.to_json(uncertain_below) if seg else None,
                "features": feats,
                "gloss_en": {"text": gen.value, "source": gen.source} if gen else None,
                "gloss_zh": {"text": gzh.value, "source": gzh.source} if gzh else None,
                "freq_stars": self.freq.stars(z),
                "zipf": round(z, 2),
                "lexicalized_participle": lexicalized,
                "family_id": self.family_of[g],
            }
            if pos == "VERB":
                entry["verb_forms"] = self.morph.verb_forms(lemma, cfg["verb_forms"]["max_participles"])
            if g in b.path_nodes:
                entry["is_path_node"] = True
            self.lexicon[key] = entry
            cov[f"stress:{stress.source}"] += 1
            cov[f"segmentation:{seg.source if seg else 'none'}"] += 1
            cov[f"gloss_en:{gen.source if gen else 'none'}"] += 1
            cov[f"gloss_zh:{gzh.source if gzh else 'none'}"] += 1
            # levels
            lk = self.kelly.lookup(lemma, pos) if self.kelly else None
            ls = self.smartool_levels.lookup(lemma, pos) if self.smartool_levels else None
            if lk:
                self.levels["kelly"][key] = lk
            if ls:
                self.levels["smartool"][key] = ls
            self.levels["estimated"][key] = self.estimator.level(z)
            cov[f"level_kelly:{'yes' if lk else 'no'}"] += 1
            cov[f"level_smartool:{'yes' if ls else 'no'}"] += 1
            ex = examples.examples(lemma, pos)
            if ex:
                self.examples[key] = ex
            tp = examples.topics(lemma, pos)
            if tp:
                self.topics[key] = tp
            cov[f"examples:{'yes' if ex else 'no'}"] += 1
        self.coverage = cov

    # -- step 7: edges -------------------------------------------------------------------
    def build_affix_tables(self) -> None:
        self.prefix_canon: dict[str, str] = {}
        self.suffix_canon: dict[str, str] = {}
        self.suffix_entries: dict[str, list[dict]] = collections.defaultdict(list)
        for p in self.affixes.get("prefixes", []):
            for v in p.get("variants", [p["affix"]]):
                self.prefix_canon[v.strip("-")] = p["affix"]
        for group in ("suffixes", "postfixes"):
            for s in self.affixes.get(group, []):
                for v in s.get("variants", [s["affix"]]):
                    self.suffix_canon.setdefault(v.strip("-"), s["affix"])
                self.suffix_entries[s["affix"]].append(s)
        # All suffix variants sharing a string (e.g. -чик) are candidates.
        self.suffix_variant_entries: dict[str, list[dict]] = collections.defaultdict(list)
        for group in ("suffixes", "postfixes"):
            for s in self.affixes.get(group, []):
                for v in s.get("variants", [s["affix"]]):
                    self.suffix_variant_entries[v.strip("-")].append(s)

    def canon_prefix(self, text: str) -> str:
        t = norm_key(text).strip("-")
        return self.prefix_canon.get(t, t + "-")

    def canon_suffix(self, text: str, following: str = "") -> tuple[str, list[dict]]:
        t = norm_key(text).strip("-")
        for cand in (t, t + norm_key(following)):
            if cand in self.suffix_variant_entries:
                return self.suffix_variant_entries[cand][0]["affix"], self.suffix_variant_entries[cand]
        return f"-{t}-" if following else f"-{t}", []

    def pick_semantic(self, entries: list[dict], parent_pos: str, child_pos: str) -> dict | None:
        def score(e):
            ip = e.get("input_pos")
            s = 0
            if ip == parent_pos:
                s += 3
            elif isinstance(ip, list) and parent_pos in ip:
                s += 2
            if e.get("output_pos") == child_pos:
                s += 1
            return s

        if not entries:
            return None
        best = max(entries, key=score)
        return best if score(best) >= 2 else (entries[0] if len(entries) == 1 else None)

    def annotate_edges(self) -> None:
        log("step 7: edge annotation")
        self.build_affix_tables()
        b = self.b
        self.edges: dict[str, Edge] = {}
        self.unmatched_affixes = collections.Counter()
        src = collections.Counter()
        for g in b.kept:
            p = b.parent[g]
            if p is None:
                continue
            e = self.diff_edge(p, g)
            src[e.affix_source] += 1
            self.edges[g] = e
        self.edge_sources = src
        b.stats["edges"] = len(self.edges)

    def diff_edge(self, p: str, c: str) -> Edge:
        b = self.b
        ppos, cpos = b.pos[p], b.pos[c]
        e = Edge(parent=p, child=c, pos_change=f"{ppos}>{cpos}")
        ps, cs = self.seg.get(p), self.seg.get(c)
        added_pref: list[str] = []
        added_suff: list[tuple[str, list[dict]]] = []
        added_post: list[str] = []
        if ps and cs:
            e.affix_source = "segmentation"
            pp, pr, psf, ppo = split_parts(ps)
            cp, cr, csf, cpo = split_parts(cs)
            e.root_alternation = bool(pr and cr and norm_key(pr) != norm_key(cr))
            for x in multiset_diff([norm_key(m) for m in cp], [norm_key(m) for m in pp]):
                added_pref.append(self.canon_prefix(x))
            cms = [m for m in cs.morphemes]
            for x in multiset_diff([norm_key(m) for m in csf], [norm_key(m) for m in psf]):
                following = _following_end(cms, x)
                added_suff.append(self.canon_suffix(x, following))
            for x in multiset_diff([norm_key(m) for m in cpo], [norm_key(m) for m in ppo]):
                added_post.append(self.canon_suffix(x)[0])
            if not (added_pref or added_suff or added_post) and ppos == "ADJ" and cpos == "ADV":
                last = cs.morphemes[-1].text if cs.morphemes else ""
                if last in ("о", "е"):
                    added_suff.append(self.canon_suffix("о"))
        else:
            got = self.affixes_from_etymology(c)
            if got:
                e.affix_source = "wiktionary-etymology"
                prefs, suffs = got
                added_pref = [self.canon_prefix(x) for x in prefs]
                for s in suffs:
                    t = s.strip("-")
                    if t in ("ся", "сь"):
                        added_post.append("-ся")
                    else:
                        added_suff.append(self.canon_suffix(t))
            else:
                pref = self.prefix_by_string(b.lemma[p], ppos, b.lemma[c])
                if pref:
                    e.affix_source = "string-rule"
                    added_pref = [pref]
        e.added_prefixes = list(dict.fromkeys(added_pref))
        e.added_suffixes = list(dict.fromkeys(s for s, _ in added_suff))
        e.added_postfixes = list(dict.fromkeys(added_post))
        # semantic type: the outermost suffix only (правительство is -ств-, not an agent noun), else postfix
        if added_suff:
            ent = self.pick_semantic(added_suff[-1][1], ppos, cpos)
            if ent:
                e.semantic_type = ent.get("semantic_type")
        if e.semantic_type is None and e.added_postfixes:
            e.semantic_type = "reflexive"
        for a in e.added_prefixes:
            if a.strip("-") not in self.prefix_canon:
                self.unmatched_affixes[a] += 1
        for s, entries in added_suff:
            if not entries:
                self.unmatched_affixes[s] += 1
        return e

    def affixes_from_etymology(self, c: str):
        if not self.wikt_en:
            return None
        for ent in self.wikt_en.get(norm_key(self.b.lemma[c]), []):
            for t in ent.etym:
                prefs, base, suffs = wiktionary.parse_affix_template(t)
                if prefs or suffs:
                    return [x.strip("-") for x in prefs], suffs
        return None

    def prefix_by_string(self, parent: str, ppos: str, child: str) -> str | None:
        pstem = stem(parent, ppos)
        c = norm_key(child)
        for variant in sorted(self.prefix_canon, key=len, reverse=True):
            if c.startswith(variant + norm_key(pstem)):
                return self.prefix_canon[variant]
        return None

    # -- related families, indices ----------------------------------------------------------
    def related(self) -> None:
        b = self.b
        by_lemma = collections.defaultdict(list)
        for g in b.kept:
            by_lemma[b.lemma[g]].append(g)
        self.related_families: dict[str, list[dict]] = collections.defaultdict(list)
        for grp in self.related_groups:
            fids = []
            for lem in grp["lemmas"]:
                for g in by_lemma.get(lem, []):
                    fid = self.family_of[g]
                    if fid not in fids:
                        fids.append(fid)
            for fid in fids:
                for other in fids:
                    if other != fid:
                        self.related_families[fid].append(
                            {"id": other, "root_lemma": b.lemma[self.families[other][0]], "label": grp["label"]}
                        )

    def run(self) -> None:
        t0 = time.time()
        self.load_sources()
        self.load_families()
        self.clean_trees()
        self.segment_valid()
        self.wiktionary_reparent()
        self.cut_implausible()
        self.attach_orphans()
        self.apply_family_overrides()
        self.filter_common()
        self.build_families()
        self.assign_keys()
        self.annotate()
        self.annotate_edges()
        self.related()
        import export

        export.write_all(self)
        log(f"done in {time.time() - t0:.0f}s")


def split_parts(seg: Segmentation):
    """(prefixes, first root, suffixes, postfixes) ignoring END/LINK/HYPH."""
    prefs, sufs, posts = [], [], []
    root = None
    for m in seg.morphemes:
        if m.type == "ROOT":
            if root is None:
                root = m.text
            continue
        if m.type == "PREF" and root is None:
            prefs.append(m.text)
        elif m.type == "SUFF" and root is not None:
            sufs.append(m.text)
        elif m.type == "POSTFIX":
            posts.append(m.text)
    return prefs, root, sufs, posts


def multiset_diff(child: list[str], parent: list[str]) -> list[str]:
    rest = list(parent)
    out = []
    for x in child:
        if x in rest:
            rest.remove(x)
        else:
            out.append(x)
    return out


def _following_end(morphs, suffix_text: str) -> str:
    for i, m in enumerate(morphs):
        if norm_key(m.text) == suffix_text and m.type == "SUFF":
            nxt = morphs[i + 1] if i + 1 < len(morphs) else None
            return nxt.text if nxt is not None and nxt.type == "END" else ""
    return ""


if __name__ == "__main__":
    Pipeline().run()
