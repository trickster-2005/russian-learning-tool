from __future__ import annotations

import pytest

from adapters.dictionary import clean_zh
from adapters.levels import Estimator, LevelTable, split_pair
from adapters.segmenter import postprocess
from adapters.stress import plus_to_acute
from common import Morpheme, Segmentation, norm_key, normalize_stressed, shard_of
from pipeline import Pipeline


class FakeFreq:
    def __init__(self, table):
        self.table = table

    def zipf(self, lemma):
        return self.table.get(lemma, 0.0)


def seg(spec: str, conf: float = 1.0) -> Segmentation:
    ms = [Morpheme(text=t.split(":")[0], type=t.split(":")[1]) for t in spec.split()]
    return Segmentation(ms, "test", conf)


@pytest.fixture
def pipe():
    p = Pipeline()
    p.wikt_en = None
    p.build_affix_tables()
    return p


def add_nodes(p, rows):
    """rows: (gid, lemma, pos, parent)"""
    for gid, lemma, pos, parent in rows:
        p.b.lemma[gid] = lemma
        p.b.pos[gid] = pos
        p.b.parent[gid] = parent
        p.b.valid.add(gid)


# -- path preservation -------------------------------------------------------------


def test_path_ancestors_are_kept(pipe):
    add_nodes(
        pipe,
        [
            ("1", "корень", "NOUN", None),
            ("2", "редкое", "NOUN", "1"),
            ("3", "частое", "NOUN", "2"),
            ("4", "другое", "NOUN", "1"),
        ],
    )
    pipe.freq = FakeFreq({"корень": 2.0, "редкое": 1.0, "частое": 4.0, "другое": 1.0})
    pipe.level_keys = set()
    pipe.filter_common()
    assert pipe.b.kept == {"1", "2", "3"}
    assert pipe.b.path_nodes == {"1", "2"}


def test_level_listed_word_is_kept_even_if_rare(pipe):
    add_nodes(pipe, [("1", "слово", "NOUN", None)])
    pipe.freq = FakeFreq({"слово": 1.0})
    pipe.level_keys = {"слово"}
    pipe.filter_common()
    assert pipe.b.kept == {"1"} and not pipe.b.path_nodes


# -- edge diff --------------------------------------------------------------------------


def test_prefix_and_suffix_added_together(pipe):
    add_nodes(pipe, [("p", "писать", "VERB", None), ("c", "записывать", "VERB", "p")])
    pipe.seg = {"p": seg("пис:ROOT а:SUFF ть:END"), "c": seg("за:PREF пис:ROOT ыва:SUFF ть:END")}
    e = pipe.diff_edge("p", "c")
    assert e.added_prefixes == ["за-"]
    assert e.added_suffixes == ["-ыва-"]
    assert e.semantic_type == "secondary_imperfective"
    assert not e.root_alternation
    assert e.pos_change == "VERB>VERB"


def test_root_alternation_and_action_noun(pipe):
    add_nodes(pipe, [("p", "читать", "VERB", None), ("c", "чтение", "NOUN", "p")])
    pipe.seg = {"p": seg("чит:ROOT а:SUFF ть:END"), "c": seg("чт:ROOT ени:SUFF е:END")}
    e = pipe.diff_edge("p", "c")
    assert e.root_alternation
    assert e.added_suffixes == ["-ние"]
    assert e.semantic_type == "action_noun"
    assert e.pos_change == "VERB>NOUN"


def test_no_segmentation_and_no_match_gives_no_affix(pipe):
    add_nodes(pipe, [("p", "идти", "VERB", None), ("c", "ходить", "VERB", "p")])
    pipe.seg = {}
    e = pipe.diff_edge("p", "c")
    assert e.added_prefixes == [] and e.added_suffixes == [] and e.affix_source == "none"


def test_string_rule_prefix_when_unsegmented(pipe):
    add_nodes(pipe, [("p", "писать", "VERB", None), ("c", "расписать", "VERB", "p")])
    pipe.seg = {}
    e = pipe.diff_edge("p", "c")
    assert e.added_prefixes == ["раз-"]
    assert e.affix_source == "string-rule"


def test_prefix_variant_maps_to_canonical(pipe):
    assert pipe.canon_prefix("рас") == "раз-"
    assert pipe.canon_prefix("со") == "с-"
    assert pipe.canon_prefix("обо") == "о-"
    assert pipe.canon_prefix("зz") == "зz-"


def test_suffix_semantics_depend_on_input_pos(pipe):
    _, entries = pipe.canon_suffix("к", "а")
    assert pipe.pick_semantic(entries, "VERB", "NOUN")["semantic_type"] == "action_noun"
    assert pipe.pick_semantic(entries, "NOUN", "NOUN")["semantic_type"] == "feminine"


def test_reflexive_postfix(pipe):
    add_nodes(pipe, [("p", "мыть", "VERB", None), ("c", "мыться", "VERB", "p")])
    pipe.seg = {"p": seg("мы:ROOT ть:END"), "c": seg("мы:ROOT ть:END ся:POSTFIX")}
    e = pipe.diff_edge("p", "c")
    assert e.added_postfixes == ["-ся"] and e.semantic_type == "reflexive"


# -- segmentation post-processing ----------------------------------------------------------


@pytest.mark.parametrize("ending", ["ть", "ти", "чь"])
def test_infinitive_ending_forced_to_end(ending):
    word = "пи" + ending
    ms = postprocess([Morpheme("пи", "ROOT"), Morpheme(ending, "SUFF")], word)
    assert ms[-1].type == "END"


def test_postprocess_rejects_mismatched_segmentation():
    assert postprocess([Morpheme("пис", "ROOT")], "писать") is None


# -- normalization -------------------------------------------------------------------------------


def test_yo_and_stress_normalization():
    assert norm_key("  Ёлка ") == "елка"
    assert norm_key("записа́ть") == "записать"
    assert shard_of("Ёж") == "еж"
    assert shard_of("я") == "я_"


def test_stress_is_vowel_plus_combining_acute():
    s = normalize_stressed("записа́ть")
    assert "́" in s and s.replace("́", "") == "записать"
    assert plus_to_acute("запис+ать") == "записа́ть"
    # й and ё survive decomposition
    assert normalize_stressed("мо́й") == "мо́й"
    assert normalize_stressed("ёж") == "ёж"


def test_aspect_pairs_are_split():
    assert split_pair("делать/сделать") == ["делать", "сделать"]
    t = LevelTable("kelly")
    for lemma in split_pair("делать/сделать"):
        t.add(lemma, "VERB", "A1")
    assert t.lookup("сделать", "VERB") == "A1"
    assert t.lookup("делать", "VERB") == "A1"


def test_level_lookup_matches_yo_and_pos():
    t = LevelTable("kelly")
    t.add("ещё", None, "A1")
    t.add("мир", "NOUN", "A2")
    assert t.lookup("еще", "ADV") == "A1"  # POS-less entries match any POS
    assert t.lookup("мир", "VERB") is None
    t.add("еще раз", None, "A2")
    assert "еще раз" in t.phrases


# -- pymorphy mapping ------------------------------------------------------------------------------


def test_pymorphy_features_and_pos():
    from adapters.morph import MorphAnalyzer

    m = MorphAnalyzer()
    f, ok, _ = m.features("книга", "NOUN", set())
    assert ok and f["gender"] == "femn" and f["animacy"] == "inan"
    f, ok, _ = m.features("очки", "NOUN", set())
    assert f["gender"] == "plural_only"
    f, ok, _ = m.features("сирота", "NOUN", set())
    assert f["gender"] == "common"
    f, ok, _ = m.features("записать", "VERB", {"идти"})
    assert f["aspect"] == "perf" and f["transitivity"] == "tran" and not f["motion_verb"] and not f["reflexive"]
    f, ok, _ = m.features("идти", "VERB", {"идти"})
    assert f["motion_verb"]
    f, ok, _ = m.features("учиться", "VERB", set())
    assert f["reflexive"]


def test_biaspectual_detection():
    from adapters.morph import MorphAnalyzer

    m = MorphAnalyzer()
    assert m.aspect("использовать") == "biasp"
    assert m.aspect("читать") == "impf"


# -- Chinese gloss cleaning ---------------------------------------------------------------------------


def test_chinese_gloss_cleaning():
    from adapters.dictionary import ChineseConverter

    cc = ChineseConverter()
    assert clean_zh("〔阳〕工作{宣传}", cc) == "工作"
    assert clean_zh("что把…记下来，记录下来. ～ свои́ мы́сли把自己的想法记下来.", cc) == "把…記下來，記錄下來"
    assert clean_zh("软件", cc) == "軟體"
    assert clean_zh("что-то", cc) == ""


# -- frequency estimate thresholds ----------------------------------------------------------------------


def test_estimate_thresholds_from_kelly_medians():
    t = LevelTable("kelly")
    zipfs = {}
    for i, lvl in enumerate(["A1", "A2", "B1", "B2", "C1", "C2"]):
        for j in range(3):
            w = f"слово{lvl}{j}"
            t.add(w, None, lvl)
            zipfs[w] = 6.0 - i * 0.5 + (j - 1) * 0.1  # median = 6.0 - 0.5 i
    est = Estimator(t, lambda w: zipfs.get(w, 0))
    assert est.medians["A1"] == pytest.approx(6.0)
    assert est.medians["C2"] == pytest.approx(3.5)
    assert est.bounds[0] == (pytest.approx(5.75), "A1")
    assert est.level(5.9) == "A1"
    assert est.level(5.6) == "A2"
    assert est.level(3.6) == "C2"
    assert est.beyond_below == pytest.approx(3.0)
    assert est.level(2.9) == "beyond"
