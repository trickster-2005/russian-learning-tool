"""Write the built model to web/public/data/ (license-layered) and build/reports/."""

from __future__ import annotations

import collections
import csv
import datetime
import json
import shutil
from pathlib import Path

from adapters import smartool as smartool_adapter
from common import LEVELS, OUT, REPORTS, load_yaml, CURATED, norm_key, shard_of

FEATURE_ORDER = ["gender", "animacy", "aspect", "reflexive", "transitivity", "motion_verb"]


def dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def write_all(p) -> None:
    b = p.b
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    node_local: dict[str, str] = {}

    # families/ — DeriNet structure + edge annotation (CC BY-NC-SA)
    fam_index = []
    affix_index: dict[str, list[dict]] = collections.defaultdict(list)
    for fid, members in p.families.items():
        local = {g: f"n{i}" for i, g in enumerate(members)}
        node_local.update(local)
        nodes = []
        for g in members:
            n = {"id": local[g], "lemma": b.lemma[g], "pos": b.pos[g], "is_path_node": g in b.path_nodes}
            if p.key_of[g] != b.lemma[g]:
                n["key"] = p.key_of[g]
            nodes.append(n)
        edges = []
        pos_changes = collections.Counter()
        affixes = collections.Counter()
        member_rows = []
        idx = {g: i for i, g in enumerate(members)}
        for g in members:
            e = p.edges.get(g)
            if e is None:
                member_rows.append([p.key_of[g], -1, "", "", ""])
                continue
            edges.append(
                {
                    "parent": local[e.parent],
                    "child": local[g],
                    "added_prefixes": e.added_prefixes,
                    "added_suffixes": e.added_suffixes,
                    "added_postfixes": e.added_postfixes,
                    "root_alternation": e.root_alternation,
                    "pos_change": e.pos_change,
                    "semantic_type": e.semantic_type,
                }
            )
            pos_changes[e.pos_change] += 1
            added = e.added_prefixes + e.added_suffixes + e.added_postfixes
            for a in added:
                affixes[a] += 1
                affix_index[a].append({"lemma": p.key_of[g], "family_id": fid})
            member_rows.append([p.key_of[g], idx[e.parent], e.pos_change, e.semantic_type or "", "|".join(added)])
        cross = []
        for g in members:
            for t in b.cross_links.get(g, []):
                if t in b.kept and p.family_of.get(t) and p.family_of[t] != fid:
                    cross.append({"from": local[g], "family_id": p.family_of[t], "lemma": b.lemma[t], "key": p.key_of[t]})
        cross = cross[:50]
        root = members[0]
        root_seg = p.seg.get(root)
        root_morph = None
        if root_seg:
            roots = [m.text for m in root_seg.morphemes if m.type == "ROOT"]
            root_morph = roots[0] if roots else None
        dump(
            OUT / "families" / f"{fid}.json",
            {
                "id": fid,
                "root_lemma": b.lemma[root],
                "nodes": nodes,
                "edges": edges,
                "cross_links": cross,
                "related_families": p.related_families.get(fid, []),
            },
        )
        fam_index.append(
            {
                "id": fid,
                "root_lemma": b.lemma[root],
                "root_key": p.key_of[root],
                "size": len(members),
                "pos_counts": dict(collections.Counter(b.pos[g] for g in members)),
                "pos_changes": dict(pos_changes),
                "affixes": dict(affixes),
                "root_morph": root_morph,
                "members": member_rows,
            }
        )
    dump(OUT / "families_index.json", fam_index)

    # lexicon/ — stress, segmentation, glosses, features, stars, forms (CC BY-SA)
    shards: dict[str, dict] = collections.defaultdict(dict)
    for key, entry in p.lexicon.items():
        shards[shard_of(entry["lemma"])][key] = entry
    for s, data in shards.items():
        dump(OUT / "lexicon" / f"{s}.json", data)

    forms: dict[str, dict[str, list[str]]] = collections.defaultdict(dict)
    for g in b.kept:
        key = p.key_of[g]
        for f in p.morph.all_forms(b.lemma[g], b.pos[g]):
            bucket = forms[shard_of(f)].setdefault(f, [])
            if key not in bucket:
                bucket.append(key)
    for s, data in forms.items():
        dump(OUT / "lexicon" / "forms" / f"{s}.json", data)

    roots: dict[str, list[str]] = collections.defaultdict(list)
    for g in b.kept:
        seg = p.seg.get(g)
        if not seg:
            continue
        for m in seg.morphemes:
            if m.type == "ROOT":
                r = norm_key(m.text)
                fid = p.family_of[g]
                if fid not in roots[r]:
                    roots[r].append(fid)
    dump(OUT / "lexicon" / "roots.json", roots)
    dump(OUT / "lexicon" / "affix_index.json", affix_index)

    summary = {}
    for key, e in p.lexicon.items():
        f = e["features"]
        seg = e["segmentation"]
        summary[key] = [
            e["pos"],
            e["freq_stars"],
            f.get("gender", ""),
            f.get("animacy", ""),
            f.get("aspect", ""),
            1 if f.get("reflexive") else 0,
            f.get("transitivity", ""),
            1 if f.get("motion_verb") else 0,
            1 if seg and seg["uncertain"] else 0,
        ]
    dump(OUT / "lexicon" / "summary.json", summary)

    # affixes.json — curated table
    affixes = load_yaml(CURATED / "affixes.yaml")
    dump(OUT / "affixes.json", affixes)

    # levels/ — one file per source (license layering)
    for src, data in p.levels.items():
        dump(OUT / "levels" / f"{src}.json", data)
    phrases = {}
    if p.kelly:
        phrases["kelly"] = p.kelly.phrases
    if p.smartool_levels:
        phrases["smartool"] = p.smartool_levels.phrases
    dump(OUT / "levels" / "phrases.json", phrases)

    # examples/ + topics.json — SMARTool (CC BY 4.0)
    ex_shards: dict[str, dict] = collections.defaultdict(dict)
    for key, ex in p.examples.items():
        ex_shards[shard_of(p.lexicon[key]["lemma"])][key] = ex
    for s, data in ex_shards.items():
        dump(OUT / "examples" / f"{s}.json", data)
    topic_names = smartool_adapter.load_topics()
    used = sorted({t for ts in p.topics.values() for t in ts})
    dump(
        OUT / "topics.json",
        {"lemmas": p.topics, "topics": {t: {"en": topic_names.get(t, t)} for t in used}},
    )

    meta = {
        "built": datetime.date.today().isoformat(),
        "stats": dict(b.stats),
        "lexicon_shards": sorted(shards),
        "forms_shards": sorted(forms),
        "example_shards": sorted(ex_shards),
        "estimate_medians": {k: round(v, 3) for k, v in p.estimator.medians.items()},
        "estimate_bounds": [[round(x, 3), lvl] for x, lvl in p.estimator.bounds],
        "estimate_beyond_below": round(p.estimator.beyond_below or 0, 3),
        "semantic_types": sorted({e.semantic_type for e in p.edges.values() if e.semantic_type}),
        "pos_changes": sorted({e.pos_change for e in p.edges.values()}),
    }
    dump(OUT / "meta.json", meta)
    write_reports(p, fam_index, meta, forms)


def write_reports(p, fam_index, meta, forms) -> None:
    b = p.b
    REPORTS.mkdir(exist_ok=True)
    with open(REPORTS / "pos_conflicts.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["lemma", "derinet_pos", "pymorphy_pos"])
        w.writerows(sorted(p.pos_conflicts))
    with open(REPORTS / "affix_unmatched.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["affix", "count"])
        w.writerows(p.unmatched_affixes.most_common())
    with open(REPORTS / "unmatched_levels.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["source", "lemma", "pos", "level"])
        for table in (p.kelly, p.smartool_levels):
            if table:
                for e in sorted(table.unmatched(), key=lambda e: (e.level, e.lemma)):
                    w.writerow([table.source, e.lemma, e.pos or "", e.level])

    sizes = collections.Counter()
    for fam in fam_index:
        s = fam["size"]
        bucket = "1" if s == 1 else "2–5" if s <= 5 else "6–20" if s <= 20 else "21–100" if s <= 100 else "100+"
        sizes[bucket] += 1
    total = len(p.lexicon)
    lines = [
        "# Build summary",
        "",
        f"Built {meta['built']}.",
        "",
        "## Counts",
        "",
        f"- Families: {len(fam_index):,}",
        f"- Nodes: {total:,}",
        f"- Path nodes (rare, kept to connect the tree): {len(b.path_nodes):,}",
        f"- Edges: {len(p.edges):,}",
        f"- Inflected-form index entries: {sum(len(v) for v in forms.values()):,}",
        "",
        "### Family size distribution",
        "",
        "| size | families |",
        "|---|---|",
    ]
    for bucket in ["1", "2–5", "6–20", "21–100", "100+"]:
        lines.append(f"| {bucket} | {sizes.get(bucket, 0):,} |")
    lines += ["", "### Pipeline statistics", ""]
    for k, v in sorted(b.stats.items()):
        lines.append(f"- {k}: {v:,}")
    lines += ["", "## Coverage by source", "", "| field | source | nodes | share |", "|---|---|---|---|"]
    for k, v in sorted(p.coverage.items()):
        field, src = k.split(":", 1)
        lines.append(f"| {field} | {src} | {v:,} | {100 * v / max(total, 1):.1f}% |")
    lines += ["", "## Edge affix sources", "", "| source | edges |", "|---|---|"]
    for k, v in p.edge_sources.most_common():
        lines.append(f"| {k} | {v:,} |")
    lines += [
        "",
        "## Frequency-estimated CEFR thresholds",
        "",
        "Kelly per-level Zipf medians:",
        "",
        "| level | median Zipf |",
        "|---|---|",
    ]
    for lvl in LEVELS:
        if lvl in meta["estimate_medians"]:
            lines.append(f"| {lvl} | {meta['estimate_medians'][lvl]} |")
    lines += ["", "Boundaries (a word with Zipf ≥ boundary gets that level or easier):", ""]
    for x, lvl in meta["estimate_bounds"]:
        lines.append(f"- ≥ {x} → {lvl}")
    lines.append(f"- < {meta['estimate_beyond_below']} → beyond (C2 median − 0.5)")
    (REPORTS / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    write_spot_checks(p)


def write_spot_checks(p) -> None:
    b = p.b
    lines = ["# Spot checks", ""]
    by_lemma = collections.defaultdict(list)
    for g in b.kept:
        by_lemma[b.lemma[g]].append(g)
    for lemma in p.cfg["spot_checks"]:
        gs = by_lemma.get(lemma)
        if not gs:
            lines += [f"## {lemma}", "", "_Not in the kept lexicon._", ""]
            continue
        g = gs[0]
        fid = p.family_of[g]
        members = p.families[fid]
        lines += [f"## {lemma} → family {fid} (root: {b.lemma[members[0]]}, {len(members)} nodes)", "", "```"]
        depth = {}
        shown = 0
        for m in members:
            par = b.parent[m]
            depth[m] = 0 if par is None else depth[par] + 1
            if shown >= 80:
                lines.append(f"... {len(members) - shown} more")
                break
            shown += 1
            e = p.lexicon[p.key_of[m]]
            seg = e["segmentation"]
            seg_s = "|".join(f"{x['text']}:{x['type'][0]}" for x in seg["morphemes"]) if seg else "—"
            if seg and seg["uncertain"]:
                seg_s += "?"
            lvl = p.levels["smartool"].get(p.key_of[m]) or p.levels["kelly"].get(p.key_of[m]) or ("~" + p.levels["estimated"][p.key_of[m]])
            gl = (e["gloss_en"] or {}).get("text", "—")
            gz = (e["gloss_zh"] or {}).get("text", "—")
            edge = p.edges.get(m)
            ann = ""
            if edge:
                added = edge.added_prefixes + edge.added_suffixes + edge.added_postfixes
                ann = f" [{' '.join(added) or '∅'} {edge.pos_change}{' ' + edge.semantic_type if edge.semantic_type else ''}{' ALT' if edge.root_alternation else ''}]"
            path = " (path)" if m in b.path_nodes else ""
            lines.append(f"{'  ' * depth[m]}{e['stressed']} {e['pos']} {lvl}{path}{ann}  {seg_s}  | {gl} | {gz}")
        lines += ["```", ""]
    (REPORTS / "spot_checks.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
