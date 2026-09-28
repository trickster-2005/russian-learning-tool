# Final report

Russian Word Families: a static word-family explorer for Russian, built from the spec in
[SPEC.md](SPEC.md). Live site: <https://trickster-2005.github.io/russian-learning-tool/>.

## What was built

| Milestone | Result |
|---|---|
| M1 Download & discovery | `build/download.py`: resumable, cached, 3 retries, status in `reports/download_status.json`. DeriNet columns, Wiktionary fields and model licenses are recorded in DECISIONS.md. |
| M2 Adapters & pipeline | One adapter per source (`build/adapters/`), curated files (`build/curated/`), `pipeline.py` + `export.py` write license-layered JSON and the reports in `build/reports/`. |
| M3 Frontend skeleton | Vite + React + TypeScript, HashRouter, hand-written i18n (EN default, 中文 switch stored in `rwf.lang`, `?lang=` wins), light/dark theme, self-hosted fonts, search by any inflected form with autocomplete and a Latin-input hint. |
| M4 Tree & detail | D3 left-to-right tree with zoom/pan, collapse, "show N more" (8 children), focus + centering, edge labels (affixes · formation type, root alternation), keyboard navigation (arrows, Enter, Space), outline view for narrow screens, detail panel (desktop side panel, mobile bottom drawer) in the spec's order, with links to external dictionaries (Wiktionary en/zh/ru, OpenRussian, Forvo). |
| M5 Levels | Teaching/frequency level source, estimated levels with dashed badges, "My level" (next level outlined and marked Next, higher levels faded), color nodes by level or POS. |
| M6 Filters | All §13.5 dimensions with "Other" options, AND across / OR within, edge filters match the child, dim / prune / list modes, URL sync, removable chips. |
| M7 Browse | Family table (entry level, size, per-level mini bar, sorting, 50 per page, "at least N matching words"), words with an affix, word-formation patterns (parent → child pairs). |
| M8 Polish & deploy | Root search, related families, About page with the license table, LICENSES.md, README (EN/中文), GitHub Actions deployment to Pages. |

## Data statistics (from `build/reports/summary.md`)

- DeriNet.RU input: 337,632 lexemes in 172,907 trees.
- Output: **11,375 families, 21,701 words** (1,938 of them rare path nodes), 10,326 edges, 342,858 inflected forms in the search index.
- Family sizes: 1 → 7,775 · 2–5 → 3,095 · 6–20 → 447 · 21–100 → 58 · 100+ → 0.
- Coverage: stress 99% (en-Wiktionary 76%, monosyllables 9%, ru-Wiktionary 7%, RUAccent 7%); English gloss 78% (Wiktionary 63%, SMARTool 16%); Chinese gloss 69%; segmentation 100% (model); SMARTool level 16%, Kelly level 37%, every word has an estimated level; examples 16%.
- Estimated-level thresholds (Kelly Zipf medians A1 4.26 … C2 3.36) are listed in the summary.

## Fallbacks used

- **DeriNet.RU 0.5 zip is 404** on the ÚFAL page → the identical resource from Universal Derivations 1.1 (LINDAT).
- **English Wiktionary** → kaikki's Russian-only extract (90 MB) instead of the 3 GB all-language dump, because of limited disk space. Same data.
- **Morpheme segmentation**: DeriNet.RU has no segmentation and the Russian Wiktionary extract has no morpheme field, so every split comes from the `rumorpheme` model (MIT). Splits below 0.8 confidence are marked uncertain.
- **Stress**: RUAccent only where Wiktionary has no stressed form (7% of words).
- `rumorpheme` installed from GitHub with `--no-deps` (PyPI 503 and an old `torch` pin).

## Tree quality work

DeriNet.RU 0.5 is machine-built and noisy: many inner nodes are non-words (пису, писить), and some edges
link unrelated words (деться → он) or point the wrong way (запись → писать). The pipeline therefore:

1. removes non-words, wrong-POS duplicates and inflected forms stored as lemmas;
2. re-attaches 16,079 words under the base named by their English Wiktionary affix etymology (human-edited data outranks the machine-built edges; 13,724 of them move across DeriNet trees);
3. cuts unconfirmed edges whose roots differ, whose direction is inverted, whose parent is far rarer, or which a Wiktionary base-word entry contradicts;
4. re-attaches orphans to a word with the same root from the same DeriNet tree;
5. applies curated `family` overrides.

Every rule and threshold is in DECISIONS.md and covered by `build/tests/`.

### Spot checks (`build/reports/spot_checks.md`)

| Word | Family root | Size | Assessment |
|---|---|---|---|
| писать | писать | 41 | Good: за-/на-/пере-/под-писать, писатель, -ыва- imperfectives |
| читать | читать | 19 | Good; считать also here (related by origin) |
| делать | дело | 25 | Good: делать from дело, then с-/пере-/про-делать |
| ходить | ходить | 47 | Good: all prefixed motion verbs |
| идти | идти | 20 | Good after mapping Wiktionary's bound stem `-йти` to идти |
| работа | работа | 35 | Good after one override (работать) |
| новый | новый | 14 | Good: новость, снова, заново, обновить |
| говорить | говорить | 30 | Good |
| брать | брать | 31 | Good: вы-/со-/за-/у-брать, выбирать |
| вода | вода | 17 | Good after separating the вод- "lead" words |
| водить | водить | 44 | Good: про-/пере-/при-/вы-водить, водитель |

## Tests and acceptance

- `build/`: 25 pytest tests pass (path preservation, affix diff with prefix + suffix, root alternation, failed match, variant mapping, forced END, ё/е, aspect pairs, pymorphy mapping and biaspectual verbs, Chinese gloss cleaning, estimate thresholds, tree-cleaning rules).
- `web/`: 13 vitest tests pass (AND/OR filters, prune ancestors, edge filters on the child, My level grouping, i18n key parity, normalization).
- Checked in the browser:
  - `записал` → autocomplete "form of записать" → opens the писать family focused on записать.
  - Switching to 中文 changes all UI text, keeps Russian unchanged, and survives a reload.
  - `?level=A1,A2&pos=VERB&mode=prune` reproduces the filtered view ("4 of 41 words match" style counter, chips).
  - At 375 px the outline view and bottom drawer work with no horizontal scroll.
  - Keyboard navigation works in the tree.
  - The Browse tabs work.
- Accessibility: automated checks found no unnamed buttons/links, no unlabeled inputs, and no text below 4.5:1 in either theme (after the ending-color fix). A full Lighthouse run was not available in this environment.

## Known issues

- DeriNet.RU noise remains in less common families: some words still hang under a loosely related parent, and some families are larger or smaller than a linguist would draw them. `build/curated/overrides.yaml` is the place to fix individual cases.
- The segmentation model sometimes splits compounds or loanwords oddly (e.g. Новосибирск); such splits carry the model's confidence and the "uncertain" flag only when it is below 0.8.
- 22% of words have no English gloss and 31% no Chinese gloss (mostly rare or derived words).
- `build/reports/affix_unmatched.csv` lists 252 affix strings that have no meaning in `affixes.yaml`; the UI shows them without a description.
- The tree view is tuned for desktop; on phones the outline view is the default.
- GitHub Pages must be enabled once in the repository settings (Source: GitHub Actions).
