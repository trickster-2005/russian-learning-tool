# Russian Word Families · 俄文詞族

**Live site / 網站：<https://trickster-2005.github.io/russian-learning-tool/>**

[English](#english) · [中文](#中文)

---

## English

Russian Word Families is a word-family explorer for learners of Russian whose first language
is English or Chinese. Type any Russian word, in any inflected form, and see the whole family
it belongs to:

- **Nodes are words**, with stress marks, color-coded morphemes (prefix / root / suffix /
  ending / postfix), part of speech and grammar, CEFR level, glosses and example sentences.
- **Lines are formation steps**: which affix was added, what it means, and how the part of
  speech changed (for example verb → action noun).
- **Filters** by CEFR level, part of speech, gender, aspect, word formation, affix, topic and
  frequency, shown as dimmed, hidden, or as a list.

Example: search `записал` → dictionary form `записать` → the `писать` family opens with
`записать` in focus, and the line from `писать` is labeled `за-`.

The interface is in English by default and can be switched to Traditional Chinese
(the EN / 中文 button, or `?lang=zh-Hant` in the URL). Russian content is never translated.

### Pages

- **Family** (`#/family/<id>`): tree view (desktop) or outline view (mobile), detail panel,
  filters. Every filter is kept in the URL, so views can be shared.
- **Browse** (`#/browse`): all families with filters and sorting, words by affix, and
  word-formation patterns (parent → child pairs).
- **About** (`#/about`): how to read the tree, data sources and licenses.

### How it works

It is a static site. All data is built offline by a Python pipeline and committed as JSON;
the browser only loads JSON files.

```
build/  (Python, run locally)          web/  (Vite + React + TypeScript)
  download.py   → build/.cache/          src/          UI, D3 tree, filters, i18n
  pipeline.py   → web/public/data/       public/data/  generated JSON (committed)
  adapters/     one per data source
  curated/      affixes, verbs of motion, overrides
  reports/      build summary, spot checks
```

Data sources: DeriNet.RU 0.5 (family trees), Wiktionary via kaikki.org (glosses, stress,
etymology), pymorphy3 (grammar, inflected forms), ruMorpheme (morpheme splits), RUAccent
(stress fallback), wordfreq (frequency), SMARTool and Kelly (CEFR levels, examples).
See [LICENSES.md](LICENSES.md).

### Rebuilding the data

Needs Python 3.11+ and about 2 GB of free disk space.

```bash
cd build
python -m venv .venv
.venv/Scripts/python -m pip install uv          # on macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uv pip install --python .venv/Scripts/python.exe -r pyproject.toml pytest
PYTHONUTF8=1 .venv/Scripts/python download.py   # resumable; cached files are skipped
PYTHONUTF8=1 .venv/Scripts/python pipeline.py   # about 10 minutes
PYTHONUTF8=1 .venv/Scripts/python -m pytest -q
```

`rumorpheme` pins an old `torch`; install it with `--no-deps` next to a current CPU `torch`
if needed (see [DECISIONS.md](DECISIONS.md)).

### Running the site

```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`
(repository Settings → Pages → Source: **GitHub Actions**).

### Project documents

- [SPEC.md](SPEC.md): the full specification
- [DECISIONS.md](DECISIONS.md): decisions made during the build
- [FINAL_REPORT.md](FINAL_REPORT.md): what was built, data statistics, fallbacks used, known issues
- [LICENSES.md](LICENSES.md): data sources and licenses

### License

Code: MIT. Data: per source (see [LICENSES.md](LICENSES.md)). This project is non-commercial.
The license layering is a conservative engineering choice, not legal advice.

---

## 中文

俄文詞族是一個以**詞族**為核心的俄文單字探索工具，給英文或中文母語的俄文學習者使用。
輸入任何俄文單字（任何變化形都可以），就能看到它所屬的整個詞族：

- **每個節點是一個詞**：重音、詞素上色（前綴／詞根／後綴／詞尾／後置詞綴）、詞性與文法特徵、
  CEFR 等級、釋義與例句。
- **每條連線是一次構詞**：加上了哪個詞綴、詞綴的意思，以及詞性如何轉換（例如動詞 → 動作名詞）。
- **篩選**：可依 CEFR 等級、詞性、性別、動詞體、構詞方式、詞綴、主題、常用程度篩選，
  不符合的詞可以淡化、隱藏，或改用清單顯示。

範例：搜尋 `записал` → 原形 `записать` → 開啟 `писать` 詞族並聚焦 `записать`，
從 `писать` 連過來的線標示 `за-`。

介面預設為英文，可切換為繁體中文（右上角 EN / 中文，或在網址加上 `?lang=zh-Hant`）。
俄文內容一律不翻譯。

### 頁面

- **詞族**（`#/family/<id>`）：樹狀圖（桌面）或大綱（手機）、詳細面板、篩選。
  所有篩選條件都保存在網址中，可以直接分享。
- **瀏覽**（`#/browse`）：所有詞族的清單與篩選排序、依詞綴查詢、依構詞規律查詢（父詞 → 子詞）。
- **關於**（`#/about`）：如何閱讀詞族樹、資料來源與授權。

### 運作方式

純靜態網站。所有資料由 Python 建置腳本在本機離線產生並提交成 JSON，瀏覽器只讀取 JSON。

資料來源：DeriNet.RU 0.5（詞族樹）、維基詞典（透過 kaikki.org，提供釋義、重音、詞源）、
pymorphy3（文法特徵、變化形）、ruMorpheme（詞素切分）、RUAccent（重音後備）、
wordfreq（詞頻）、SMARTool 與 Kelly（CEFR 等級、例句）。詳見 [LICENSES.md](LICENSES.md)。

### 重新建置資料

需要 Python 3.11 以上，以及約 2 GB 可用空間。指令見上方英文段落的「Rebuilding the data」。
下載支援續傳，中斷後重新執行即可。

### 本機執行網站

```bash
cd web
npm install
npm run dev      # http://localhost:5173
```

推送到 `main` 分支後，GitHub Actions 會自動部署到 GitHub Pages
（需在 repo 的 Settings → Pages → Source 選擇 **GitHub Actions**）。

### 授權

程式碼採 MIT 授權；資料依各來源授權（見 [LICENSES.md](LICENSES.md)）。
本專案為非商業用途；授權分層是工程上的保守做法，不構成法律意見。
