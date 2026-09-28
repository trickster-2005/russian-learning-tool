# Progress

Working notes so the build can be resumed after an interruption. Spec: [SPEC.md](SPEC.md).

## Status

All milestones M1–M8 are done; see [FINAL_REPORT.md](FINAL_REPORT.md). Tests: 25 pytest, 13 vitest.

Remaining outside the code: enable GitHub Pages once (repository Settings → Pages → Source: GitHub Actions).

## How to rebuild

```bash
cd build
PYTHONUTF8=1 .venv/Scripts/python download.py      # resumable, skips cached files
PYTHONUTF8=1 .venv/Scripts/python pipeline.py      # ~5–8 min; writes web/public/data + build/reports
PYTHONUTF8=1 .venv/Scripts/python -m pytest -q
cd ../web && npm test && npm run build
```

## Disk notes

- `build/.cache/` holds downloads and pickled caches (`wikt_*.v4.pkl`, `seg_rumorpheme.pkl`); it is git-ignored.
- The Russian and Chinese Wiktionary `.jsonl` extracts were deleted after caching; `.cache/raw/wikt_ru_raw.jsonl.gz` is kept so they can be regenerated.
