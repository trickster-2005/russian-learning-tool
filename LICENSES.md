# Licenses

This is a non-commercial project. The source licenses below can't all be combined into one
file, so each source's data is written to separate files and merged in the browser at runtime.
This layering is a conservative engineering choice, not legal advice.

## Code

All code in this repository (`build/`, `web/src/`, workflows) is released under the **MIT License**.

## Data (`web/public/data/`)

| Files | Content | Source | License |
|---|---|---|---|
| `families/`, `families_index.json` | Word-family trees, edge annotations (added affixes, POS change) | DeriNet.RU 0.5 by Lukáš Kyjánek, Olga Lyashevskaya, Anna Nedoluzhko, Daniil Vodolazsky, Zdeněk Žabokrtský — released in Universal Derivations 1.1, <http://hdl.handle.net/11234/1-3247>. Tree corrections use Wiktionary etymologies. | CC BY-NC-SA 4.0 (the spec lists 3.0 for the ÚFAL zip; the UDer copy used here is 4.0) |
| `lexicon/` | Stress, morpheme segmentation, glosses, grammatical features, frequency stars, inflected-form index | Wiktionary (English, Chinese, Russian) via [kaikki.org](https://kaikki.org/) / wiktextract (Tatu Ylonen); pymorphy3 with the OpenCorpora dictionary; wordfreq (Robyn Speer); ruMorpheme (Pavel Rykov, MIT); RUAccent (Denis Petrov, MIT) | CC BY-SA 4.0 |
| `levels/kelly.json` | Frequency-based CEFR levels | Kelly project Russian list, Serge Sharoff et al., <https://ssharoff.github.io/kelly/> | CC BY-NC-SA 2.0 |
| `levels/smartool.json`, `examples/`, `topics.json` | Teaching-oriented CEFR levels, example sentences, topics | SMARTool, UiT The Arctic University of Norway, <https://github.com/smartool/data-rus-eng> | CC BY 4.0 |
| `levels/estimated.json` | Levels estimated from word frequency | Computed from wordfreq, calibrated on Kelly | CC BY-SA 4.0 (derived from wordfreq) |
| `levels/phrases.json` | Multi-word entries from Kelly and SMARTool | Kelly, SMARTool | per source, as above |
| `affixes.json` | Affix meanings (curated for this project) | This project | MIT |

## Fonts

PT Serif (ParaType), IBM Plex Sans (IBM) and Noto Sans TC (Google) are self-hosted via
Fontsource under the SIL Open Font License 1.1.

## Sources not used

Per the project spec, the ros-edu.ru lexical minimum, the official ТРКИ lexical minimum
publications and the Routledge frequency dictionary are not used.
