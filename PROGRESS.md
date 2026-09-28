# Progress

Working notes so the build can be resumed after an interruption. Spec: the v2 vibe-coding prompt (sections referenced as §).

## Status

| Milestone | State |
|---|---|
| M1 Download & discovery | Done. DeriNet.RU 0.5 from UDer 1.1 (the ÚFAL zip link is 404); English Wiktionary from kaikki's Russian-only extract (90 MB). |
| M2 Adapters & pipeline | Done; iterating on tree-cleaning quality (spot checks in `build/reports/spot_checks.md`). |
| M3 Frontend skeleton | Written, typechecks (`tsc` passes) |
| M4 Tree & detail panel | Written (TreeView, OutlineView, DetailPanel); not yet tested in a browser |
| M5 Levels | Written |
| M6 Filters | Written; logic tests pass |
| M7 Browse | Written; not yet tested in a browser |
| M8 Polish & deploy | README, LICENSES, About page, deploy workflow written. Still to do: see below |

## Next steps (in order)

1. Tree quality: some families still hang under odd roots from DeriNet (писать under пися, брать under бра,
   новый under новьё, вода under водить, говорить under говоря; ходить's prefixed verbs are marked NOUN in
   one small family). Ideas: prefer the higher-frequency word as parent when an unconfirmed edge links two
   words of equal complexity; add `family` overrides in `build/curated/overrides.yaml` for spot-check words.
2. Run the site (`.claude/launch.json` → "web"), check: search записал → писать family focused on записать;
   EN/中文 switch persists after reload; `?level=A1,A2&pos=VERB&mode=prune`; 375px mobile; accessibility.
3. Write DECISIONS.md cleanly (manual decisions: UDer copy of DeriNet.RU, Russian-only kaikki extract,
   venv + `--no-deps` rumorpheme, homograph keys `lemma#POS`, extra files summary.json / families_index members / meta.json).
4. FINAL_REPORT.md, commit data (`web/public/data`), push to https://github.com/trickster-2005/russian-learning-tool.git,
   enable Pages (Settings → Pages → Source: GitHub Actions).

## How to resume

```bash
cd build
PYTHONUTF8=1 .venv/Scripts/python download.py      # resumable, skips cached files
PYTHONUTF8=1 .venv/Scripts/python pipeline.py      # ~10 min; writes web/public/data + build/reports
PYTHONUTF8=1 .venv/Scripts/python -m pytest -q
cd ../web && npm test && npm run build
```

## Disk notes

- `build/.cache/` holds downloads and pickled caches (`wikt_*.pkl`, `seg_rumorpheme.pkl`); it is git-ignored.
- The 3 GB all-language English Wiktionary dump is not used (see DECISIONS.md).
