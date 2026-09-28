# Progress

Working notes so the build can be resumed after an interruption. Spec: the v2 vibe-coding prompt (sections referenced as §).

## Status

| Milestone | State |
|---|---|
| M1 Download & discovery | Done. DeriNet.RU 0.5 from UDer 1.1 (the ÚFAL zip link is 404); English Wiktionary from kaikki's Russian-only extract (90 MB). |
| M2 Adapters & pipeline | Done; iterating on tree-cleaning quality (spot checks in `build/reports/spot_checks.md`). |
| M3 Frontend skeleton | In progress: routing, i18n, settings, search, styles written. |
| M4 Tree & detail panel | To do |
| M5 Levels | Logic done (`web/src/lib/levels.ts`); UI to do |
| M6 Filters | Logic + tests done (`web/src/lib/filters.ts`); UI to do |
| M7 Browse | To do |
| M8 Polish & deploy | To do: About page, README (EN/中文), LICENSES, FINAL_REPORT, GitHub Actions, push |

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
