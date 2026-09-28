# Decisions

Small decisions made while building, one line each: what was decided and why.

## Made by hand

- DeriNet.RU 0.5: the `derinet-ru-0.5.zip` link on the ÚFAL DeriNet page returns 404 (also absent from the Wayback Machine). The same resource ("DeriNet.RU 0.5", Kyjánek et al.) ships inside Universal Derivations 1.1 on LINDAT (hdl 11234/1-3247, direct public download), so `download.py` falls back to it. Its license there is CC BY-NC-SA 4.0 (spec lists 3.0 for the zip).
- DeriNet.RU in UDer has empty SEGMENTATION, FEATS and OTHERPARENTS columns and only NOUN/VERB/ADJ/ADV, so segmentation comes from the model and cross_links from Wiktionary etymologies.
- English Wiktionary: the 3 GB all-language dump was replaced by kaikki's Russian-only extract of the same wiktextract data (`dictionary/Russian/kaikki.org-dictionary-Russian.jsonl.gz`, 90 MB) because the build machine was low on disk space. Content, fields and license are the same.
- Russian Wiktionary (kaikki) has no field whose key contains `morpheme`/`морф`, so segmentation source 3 is skipped. Its headword is never stressed; the stressed spelling is taken from its `forms` entry equal to the headword (e.g. рабо́та, singular nominative).
- After filtering, the large intermediate `.jsonl` extracts are deleted and only compact pickled caches (`build/.cache/wikt_*.v4.pkl`) are kept; loaders read the cache first.
- Python environment: a project-local venv (`build/.venv`) with `uv` installed inside it, instead of a global `uv`, to avoid changing the machine. Python 3.13.
- `rumorpheme` pins `torch~=2.4.1` (no Python 3.13 wheels) and PyPI returned 503 for it, so it is installed from its GitHub source with `--no-deps` next to the current CPU `torch`.
- RUAccent is loaded with `omograph_model_size="turbo3.1"` and `use_dictionary=True`; its `+` stress marks are converted to vowel + U+0301.
- English glosses drop parenthetical explanations ("to write down (to set something down in writing)" → "to write down") to stay short.
- Chinese glosses from the zh Wiktionary often embed dictionary examples; the cleaner also cuts at `～`, `‖`, `#`, removes `見…` cross-references and leading Russian government words, and cuts at leftover Russian text.
- Homographs: the lexicon key is the lemma; later nodes with the same lemma get `lemma#POS` (then `#POS2`). Family nodes carry `key` when it differs from `lemma`.
- Extra data files beyond §11: `meta.json` (build stats, shard lists, estimate thresholds), `lexicon/summary.json` (compact per-word features for Browse filtering, CC BY-SA layer) and a `members` array in `families_index.json` (key, parent index, POS change, formation type, added affixes) so Browse can filter without loading every family file.
- Lexicon entries also store `lemma`, `pos`, `zipf` and `is_path_node` (children are sorted by Zipf in the tree).
- The formation type (`semantic_type`) comes only from the outermost added suffix, so правительство (-ств-) is not labeled an agent noun because of its inner -тель.
- Words from SMARTool with POS "A" that end in an infinitive ending are treated as verbs (the source tags some verbs "A"); disambiguation marks like `болеть(е)` are removed.
- Browse's "contains affix" filter uses the affixes added on each word's incoming edge (segmentation affixes are only available on the Family page).
- Light-theme ending color darkened from #6B7478 to #626B6F: the spec value gives 4.36:1 on --bg, below the 4.5:1 requirement.
- Topic names in Chinese were translated by hand into `web/src/i18n/topics.zh-Hant.json`.
- Curated `family` overrides fix what the rules can't: вод- "lead" (водить, завод, ввод, привод) is separated from вода "water"; работать is placed under работа.
- Layout: the app is a fixed-height shell (top bar + scrolling main area); the family page's panels scroll on their own instead of relying on a hard-coded top-bar height, so nothing is pushed off-screen.
- Filter panel: open by default above 900 px wide (choice remembered in `rwf.filtersOpen`); on phones it is a full-screen sheet, so it starts closed and closes when the screen crosses into phone width.
- On phones, arriving with `?focus=` highlights and centers the word but doesn't open the bottom sheet, so the tree stays visible.
- External dictionary links (Wiktionary en/zh/ru, OpenRussian, Forvo) sit right after the meaning in the detail panel; in 中文 mode the Chinese Wiktionary is listed first.
- The i18n React context lives in `web/src/i18n/context.ts` (no JSON imports) so editing translations during development can't create a second context.
- Tree defaults (user request, overrides §13.3's "2 levels" and "center the focus"): only the root is expanded (root + direct children visible), plus the path to a focused word; the initial view is actual size, anchored at the top-left of the canvas under the family title, shifting only as far as needed to keep a focused word visible. The ⤢ button still fits the whole tree.

## Recorded by the build (`log_decision` in `build/`)

- Priority rule (human-edited > machine-built): when a word's en-Wiktionary affix etymology ({{prefix}}, {{suffix}}, {{af}}, {{affix}}, {{confix}}) names a base that exists as a node, the word is re-attached under that base, even across DeriNet trees (cycles are skipped). Other named bases become cross_links.
- Segmentation model: rumorpheme license detected as MIT (from its LICENSE file) -> used, weights evilfreelancer/ruMorpheme-v0.2.
- rumorpheme predictions include the BEGIN position; labels are shifted by one ([1:]) before labels_to_morphemes, otherwise every boundary is off by one letter (за|пис|а|ть vs зап|иса|т|ь).
- DeriNet.RU 0.5 contains many non-words (e.g. пису, писить) as inner nodes. A node is kept only if pymorphy3 knows it as a dictionary lemma, or it has a Wiktionary (en/ru) sense, or it is in Kelly/SMARTool. Children of removed nodes attach to the nearest kept ancestor; nodes left without one become roots until a later step (Wiktionary etymology, then same-root matching) places them.
- DeriNet.RU edges not confirmed by Wiktionary are cut when parent and child roots (model segmentation, else stem) share a common subsequence shorter than 60% of the shorter root (keeps читать→чтение, cuts деться→он). The child's subtree then becomes its own family unless re-attached below.
- DeriNet.RU file UDer-1.1-ru-DeriNetRU.tsv.gz: 10 tab-separated columns detected, mapped as DeriNet 2.0 (ID, LEMID, LEMMA, POS, FEATS, SEGMENTATION, PARENTID, RELTYPE, OTHERPARENTS, MISC); POS values in first 200 lines: ['ADJ', 'NOUN'].
- A node whose POS neither pymorphy3 nor en-Wiktionary confirms is dropped when a node with the same lemma and a confirmed POS exists (DeriNet has e.g. ходить/приходить tagged NOUN besides VERB), and word forms stored as lemmas (говоря, a form of говорить) are dropped when their lemma is a node.
- Base-word rule: when a word's en-Wiktionary entry lists at least 10 derived terms (Wiktionary treats it as a base) and neither entry mentions its unconfirmed DeriNet parent/child pair, the edge is cut (пися→писать, бри→брать, выговор→говорить). Also applied when re-attaching orphans.
- Unconfirmed DeriNet edges are also cut when the child is at least 1.25 Zipf more frequent than a parent that is on no level list (пися→писать, бра→брать, новь→новый); the same test applies when re-attaching orphans.
- Direction rule: derivation adds affixes, so an unconfirmed DeriNet edge whose parent has more prefixes+suffixes+postfixes (or more prefixes) than the child is treated as inverted and cut (запись→писать, вход→ходить, водить→вода). Orphan re-attachment only picks parents that are not more complex than the orphan.
