# Vibe Coding Prompt：Russian Word Family Explorer（v2，全部決策已預先確認）

> 使用方式：把整份文件貼給 AI coding agent（Claude Code、Cursor 等），或放進專案根目錄作為 `SPEC.md`。
> 本規格的所有技術決策、資料來源、授權、設計都已確認。**請從頭到尾一次完成，不要中途停下來詢問。**

---

## 0. 給 Agent 的工作守則

1. **一次做完所有里程碑（第 16 節），中途不要停下來等確認。** 遇到問題時，依照本文件寫好的「後備方案」處理並繼續。
2. 所有你自己做的小決定（本文件沒寫到的細節）記錄在 `DECISIONS.md`，每條一行：決定內容與理由。
3. 全部完成後，輸出 `FINAL_REPORT.md`：完成項目、資料統計、使用了哪些後備方案、已知問題。
4. **不要訓練任何模型。** 只使用現成套件與已訓練好的模型做推論。
5. **不要捏造資料。** 查不到的釋義、等級、切分、重音就留空，來源標為 `none`。
6. **不要使用第 9.3 節列為「排除」的資料來源。**
7. 程式碼、註解、變數用英文。**UI 預設英文，可切換為繁體中文**（第 12 節）。
8. 所有外部工具都包在 adapter 中（第 5 節），方便日後替換。

---

## 1. 產品概要

一個以**詞族（word family）**為核心的俄文單字探索工具，目標使用者是英文或中文母語的俄文學習者。

使用者輸入任何俄文單字（任意變化形皆可），看到它所屬的整個詞族樹：
- **節點**是一個詞：重音、詞素上色（前綴／詞根／後綴／詞尾）、詞性與文法特徵、CEFR 等級、釋義、例句。
- **連線**是一次構詞：新增了什麼詞綴、詞綴的意思、詞性如何轉換（例如 verb → action noun）。
- 可依 **CEFR 等級、詞性、文法子分類、詞性轉換、詞綴、主題、常用程度** 篩選。

範例：搜尋 `записал` → 原形 `записать` → 顯示以 `писать` 為根的詞族樹，高亮 `писать → записать`，連線標示「за-: writing down / 記錄下來」。

**本專案只做兩個主頁面：詞族檢視（Family）與詞族瀏覽（Browse），外加關於頁（About）。**

---

## 2. 核心架構

**純靜態網站 + 離線建置腳本。**

```
[建置階段] Python，在開發者電腦上執行
  下載外部資料 → adapters 整合 → 輸出 JSON 到 web/public/data/

[使用階段] 純前端，部署到 GitHub Pages
  瀏覽器載入 JSON → 搜尋、畫樹、篩選
```

- 前端不執行 Python、不呼叫任何後端 API。
- 使用者設定只存在 localStorage（一律包 try/catch，失敗就用預設值）與 URL。
- 建置產物 `web/public/data/` **提交到 git**；下載快取 `build/.cache/` 加入 `.gitignore`。

---

## 3. 技術棧（已確定）

**建置（`build/`）**
- Python 3.11+，用 `uv` 管理
- `pymorphy3`、`pymorphy3-dicts-ru`
- `wordfreq`
- `ruaccent`（重音後備）
- `rumorpheme`（詞素切分後備；授權處理見 6.3）
- `opencc`（簡體轉繁體，設定 `s2twp`）
- `xlrd`（讀 Kelly 的 `.xls`）、`polars`
- `pytest`

**前端（`web/`）**
- Vite + React + TypeScript
- `react-router-dom`，**使用 HashRouter**（GitHub Pages 相容）
- `d3-hierarchy`、`d3-zoom`、`d3-selection`
- 字體用 `@fontsource/pt-serif`、`@fontsource/ibm-plex-sans`、`@fontsource/noto-sans-tc`（自行託管，不走外部 CDN）
- 不使用 UI 元件庫
- i18n 自己實作（第 12 節），不引入 i18n 套件
- `vitest`

**部署**：GitHub Actions 只負責建置前端並部署到 GitHub Pages；資料建置在本機執行。

---

## 4. 專案結構

```
russian-word-family/
├── build/
│   ├── adapters/
│   │   ├── derinet.py
│   │   ├── morph.py
│   │   ├── segmenter.py
│   │   ├── stress.py
│   │   ├── dictionary.py
│   │   ├── frequency.py
│   │   ├── levels.py
│   │   └── examples.py
│   ├── curated/
│   │   ├── affixes.yaml
│   │   ├── motion_verbs.yaml
│   │   ├── related_families.yaml
│   │   └── overrides.yaml
│   ├── config.yaml
│   ├── download.py
│   ├── pipeline.py
│   ├── export.py
│   ├── reports/
│   └── tests/
├── web/
│   ├── public/data/
│   └── src/
│       ├── i18n/en.json
│       ├── i18n/zh-Hant.json
│       └── ...
├── .github/workflows/deploy.yml
├── DECISIONS.md
├── FINAL_REPORT.md
├── LICENSES.md
└── README.md
```

---

## 5. Adapter 介面

每個 adapter 的輸出都帶 `source`（字串）與 `confidence`（0–1；人工資料 1.0）。

```python
@dataclass
class Morpheme:
    text: str
    type: Literal["PREF", "ROOT", "SUFF", "END", "POSTFIX", "LINK", "HYPH"]

@dataclass
class Segmentation:
    morphemes: list[Morpheme]
    source: str
    confidence: float
```

介面：`FamilyProvider`、`MorphAnalyzer`、`Segmenter`、`Stresser`、`Dictionary`（分 en/zh）、`FrequencyProvider`、`LevelProvider`、`ExampleProvider`。

**統一優先順序原則：人工 > 人工編輯的資料 > 規則 > 模型。**

---

## 6. 資料來源與建置流程

### 6.1 下載清單（`build/download.py`，下載到 `build/.cache/`）

| 資料 | 位置 | 授權 |
|---|---|---|
| DeriNet.RU 0.5 | ÚFAL DeriNet 頁面 `https://ufal.mff.cuni.cz/derinet` 上的 `derinet-ru-0.5.zip` 連結（程式先抓頁面、找出該 zip 連結再下載） | CC BY-NC-SA 3.0 |
| Kelly 俄文詞表 | `https://ssharoff.github.io/kelly/ru_m3.xls` | CC BY-NC-SA 2.0 |
| SMARTool | `https://github.com/smartool/data-rus-eng`（`SMARTool_data_A1.csv`、`A2`、`B1`、`B2`、`Topics.csv`） | CC BY 4.0 |
| 英文維基詞典 | `https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz` | CC BY-SA / GFDL |
| 中文維基詞典 | `https://kaikki.org/zhwiktionary/raw-wiktextract-data.jsonl.gz` | CC BY-SA / GFDL |
| 俄文維基詞典 | `https://kaikki.org/ruwiktionary/raw-wiktextract-data.jsonl.gz` | CC BY-SA / GFDL |

- 維基詞典檔案很大（英文版壓縮後約數 GB）：**以串流方式逐行讀取 gzip**，只保留 `lang_code == "ru"` 的條目，存成 `build/.cache/wikt_{en,zh,ru}_ru.jsonl` 供後續使用。
- 下載支援續傳與快取；已存在就跳過。
- 若某個下載失敗：重試 3 次；仍失敗則在報告中記錄，並以沒有該來源的狀態繼續建置（例如沒有中文維基詞典就全部用英文釋義）。

### 6.2 步驟 1：詞族骨架（DeriNet.RU）

- DeriNet 格式：每行一個詞，Tab 分隔，樹與樹之間空行。預期欄位依 DeriNet 2.0 格式：`ID`、`LEMID`、`LEMMA`、`POS`、`FEATS`、`SEGMENTATION`、`PARENTID`、`RELTYPE`、`OTHERPARENTS`（名稱與順序以檔案實際內容為準；解析程式先讀前 200 行自動偵測欄位並記錄到 `DECISIONS.md`）。
- 每棵樹 = 一個詞族；樹根 = `root_lemma`。
- 複合詞的其他父詞存入 `cross_links`。
- 若 `SEGMENTATION` 欄有內容，作為詞素切分來源之一（見 6.4）。

### 6.3 步驟 2：常用詞篩選

- 用 `wordfreq.zipf_frequency(lemma, "ru")`。
- 保留條件（`config.yaml` 可調）：`zipf >= 3.0`，**或**出現在 Kelly 或 SMARTool 中。
- **保留所有被保留詞通往樹根路徑上的所有祖先**，這些祖先若本身不符合條件，標記 `is_path_node: true`。
- 篩選後節點數為 0 的詞族不輸出。
- 常用程度星等：`zipf >= 5.0` → 5；`>= 4.5` → 4；`>= 4.0` → 3；`>= 3.5` → 2；其餘 → 1。

### 6.4 步驟 3：詞素切分（依序嘗試，取第一個成功的）

1. `curated/overrides.yaml`
2. DeriNet.RU 的 `SEGMENTATION` 欄（若非空）
3. 俄文維基詞典：在條目 JSON 中搜尋鍵名含 `morpheme` 或 `морф` 的欄位；找得到就解析，找不到就跳過此來源（在 `DECISIONS.md` 記錄是否存在）
4. 詞素切分模型：
   - 建置時先讀取 `rumorpheme` 套件或其 GitHub 儲存庫的 LICENSE。若為 MIT／Apache-2.0／BSD，使用它；否則改用 `slovorez`（同樣先檢查授權）；兩者都不符合則跳過此來源。
   - 保留模型給的機率作為 confidence（取所有詞素機率的最小值）。
5. 都失敗：`segmentation: null`，來源 `none`

- `confidence < 0.8` 標記 `uncertain: true`。
- 切分結果中的 `-ть`、`-ти`、`-чь` 若被模型標成 SUFF，一律改標為 END（不定式詞尾不視為構詞後綴）。

### 6.5 步驟 4：重音

1. `overrides.yaml`
2. 英文維基詞典：條目 `forms` 中帶 `canonical` tag、且含重音符號（U+0301）的形式
3. 俄文維基詞典的詞條標題形式（若含重音）
4. RUAccent 對單字推論（confidence 0.7）
5. 都沒有：只顯示不帶重音的原形

- 單音節詞不需要標重音；含 `ё` 的詞視為已知重音。
- 重音一律以「母音 + U+0301」表示，輸出前做 NFC 以外的處理時要確保組合字元不被拆掉。

### 6.6 步驟 5：釋義

**英文釋義（`gloss_en`）**
1. `overrides.yaml`
2. SMARTool 的英文 gloss（較精簡、適合學習者）
3. 英文維基詞典：取前 2 個 sense，跳過帶 `obsolete`、`archaic`、`rare`、`dated` tag 的 sense
4. 無

**中文釋義（`gloss_zh`）**
1. `overrides.yaml`
2. 中文維基詞典：取前 2 個 sense，先用 OpenCC `s2twp` 轉成繁體，再移除方括號文法標記（例如 `〔阳〕`、`{宣传}` 這類 `〔…〕`、`{…}` 片段），去除多餘空白與換行
3. 無（前端會自動退回英文釋義並加上「EN」標記）

- 每種語言釋義總長度上限 80 字元，超過截斷並加「…」。

### 6.7 步驟 6：詞性與文法特徵（pymorphy3）

- 主要詞性以 DeriNet 為準，細部特徵用 pymorphy3 的原形分析（取與 DeriNet 詞性相符、分數最高的分析）。
- 兩者詞性無法相符時，以 DeriNet 為準，並記錄到 `reports/pos_conflicts.csv`。
- 取得特徵（第 7 節）：性別、有生性、只有複數、通性、動詞體、反身、及物性。
- 運動動詞：比對 `curated/motion_verbs.yaml`。
- 詞彙化形動詞：DeriNet 中父詞為 VERB、本身為 ADJ，且 pymorphy3 能把它分析為 `PRTF` → `lexicalized_participle: true`。
- 動詞節點額外產生：形動詞（PRTF 的陽性單數主格形式，最多 4 個）與副動詞（GRND），只存不帶重音的形式，僅供詳細面板顯示。

### 6.8 步驟 7：連線註記（詞綴與詞性轉換）

對每條「父詞 → 子詞」：
1. 若兩者都有切分：比較兩者的詞素序列（**忽略 END**），找出子詞新增的 PREF、SUFF、POSTFIX（可能同時多個，例如 `писать → записывать` 新增 `за-` 與 `-ыва-`）。
2. 若兩者都有 ROOT 且字串不同 → `root_alternation: true`。
3. 若任一方無切分：嘗試用英文維基詞典子詞的 `etymology_templates` 中 `prefix`、`suffix`、`affix`、`af` 模板取得詞綴；再不行就用純字串規則（子詞以「已知前綴 + 父詞詞幹」開頭則判定為該前綴）。仍失敗則不標詞綴。
4. `pos_change = "{父詞性}>{子詞性}"`。
5. 用「詞綴（對應到標準形式）+ pos_change」查 `affixes.yaml`，取得 `meaning`（en/zh）與 `semantic_type`。後綴若有多筆語意類型，依 `input_pos` 選擇。
6. 詞綴變體一律對應到標準形式（例如 `рас-` → `раз-`、`со-` → `с-`）。
7. 找得到但說明表沒有的詞綴，寫入 `reports/affix_unmatched.csv`（依出現次數排序），前端只顯示詞綴字串不顯示說明。

### 6.9 步驟 8：CEFR 分級（見第 9 節）

### 6.10 步驟 9：例句（SMARTool）

- SMARTool 每個原形最多 3 個例句與英文翻譯，存入 `examples/{shard}.json`。
- 詳細面板顯示例句；例句中的該詞形加粗。
- 同時取出 SMARTool 的主題（Topic），以 `Topics.csv` 對應英文名稱，中文名稱由 agent 翻譯後寫入 `web/src/i18n/topics.zh-Hant.json`。

### 6.11 建置報告（`build/reports/`）

- `summary.md`：詞族數、節點數、路徑節點數、詞族大小分布（1、2–5、6–20、21–100、100+）、各欄位各來源的覆蓋率
- `pos_conflicts.csv`、`affix_unmatched.csv`、`unmatched_levels.csv`
- `spot_checks.md`：第 14 節抽查詞族的可讀摘要（樹狀文字圖 + 每個節點的切分、重音、等級、釋義）

---

## 7. 統一詞性與特徵

| 代碼 | en | zh-Hant | 來源對應 |
|---|---|---|---|
| NOUN | Noun | 名詞 | DeriNet NOUN / NOUN |
| VERB | Verb | 動詞 | VERB, INFN |
| ADJ | Adjective | 形容詞 | ADJ / ADJF, ADJS, COMP |
| ADV | Adverb | 副詞 | ADV / ADVB |
| NUM | Numeral | 數詞 | NUM / NUMR |
| PRON | Pronoun | 代詞 | PRON / NPRO |
| FUNC | Function word | 功能詞 | 介詞、連詞、語氣詞、感嘆詞、PRED |
| OTHER | Other | 其他 | 其餘 |

**子分類**

| 欄位 | 值 | en | zh-Hant |
|---|---|---|---|
| gender | masc / femn / neut / common / plural_only / unknown | Masculine / Feminine / Neuter / Common / Plural only / Other | 陽性／陰性／中性／通性／只有複數／其他 |
| animacy | anim / inan / unknown | Animate / Inanimate / Other | 有生／無生／其他 |
| aspect | perf / impf / biasp / unknown | Perfective / Imperfective / Biaspectual / Other | 完成體／未完成體／雙體／其他 |
| reflexive | true / false | Reflexive (-ся) | 反身動詞（-ся） |
| transitivity | tran / intr / unknown | Transitive / Intransitive / Other | 及物／不及物／其他 |
| motion_verb | true / false | Verb of motion | 運動動詞 |

**雙體判定**：pymorphy3 對同一原形同時給出 perf 與 impf 的分析，且兩者分數都不低於最高分的 30%，判為 `biasp`。

**每個篩選維度都有「Other／其他」選項**，避免資料缺漏的詞在篩選時無聲消失。

---

## 8. 人工資料（`build/curated/`）— 以下內容直接建立

### 8.1 `affixes.yaml`

```yaml
prefixes:
  - {affix: в-, variants: [в-, во-], meaning_en: "into, inward", meaning_zh: "進入、向內", examples: [войти, вписать]}
  - {affix: вы-, variants: [вы-], meaning_en: "out, outward", meaning_zh: "向外、取出", examples: [выйти, выписать]}
  - {affix: за-, variants: [за-], meaning_en: "start; drop in; write down", meaning_zh: "開始；順路進入；記下", examples: [заговорить, зайти, записать]}
  - {affix: на-, variants: [на-], meaning_en: "onto a surface; often forms perfectives", meaning_zh: "在表面上；常用於構成完成體", examples: [написать]}
  - {affix: о-, variants: [о-, об-, обо-], meaning_en: "around, all over", meaning_zh: "環繞、全面", examples: [обойти, описать]}
  - {affix: от-, variants: [от-, ото-], meaning_en: "away, off", meaning_zh: "離開、分離", examples: [отойти, отрезать]}
  - {affix: пере-, variants: [пере-], meaning_en: "across; re-", meaning_zh: "越過；重新", examples: [перейти, переписать]}
  - {affix: под-, variants: [под-, подо-], meaning_en: "up to, approach; under", meaning_zh: "靠近；在下方", examples: [подойти, подписать]}
  - {affix: при-, variants: [при-], meaning_en: "arrival; attachment", meaning_zh: "到達；附加", examples: [прийти, приписать]}
  - {affix: про-, variants: [про-], meaning_en: "through, past; for a while", meaning_zh: "經過、穿過；持續一段時間", examples: [пройти, прочитать]}
  - {affix: раз-, variants: [раз-, рас-, разо-], meaning_en: "apart, in all directions", meaning_zh: "分散、向四方", examples: [разойтись, разрезать]}
  - {affix: с-, variants: [с-, со-], meaning_en: "down; together", meaning_zh: "向下；聚合", examples: [сойти, собрать]}
  - {affix: у-, variants: [у-], meaning_en: "away, removal", meaning_zh: "離開、移除", examples: [уйти, убрать]}
  - {affix: до-, variants: [до-], meaning_en: "up to a point; finish", meaning_zh: "到達某一點；做完", examples: [дойти, дописать]}
  - {affix: без-, variants: [без-, бес-], meaning_en: "without, -less", meaning_zh: "無、沒有", examples: [безопасный]}
  - {affix: не-, variants: [не-], meaning_en: "not, un-", meaning_zh: "不、非", examples: [неправда]}
  - {affix: пред-, variants: [пред-, предо-], meaning_en: "before, pre-", meaning_zh: "在前、預先", examples: [предсказать]}

suffixes:
  - {affix: -тель, input_pos: VERB, output_pos: NOUN, semantic_type: agent_noun, meaning_en: "person who does it", meaning_zh: "做這件事的人", examples: [писатель, учитель]}
  - {affix: -ние, variants: [-ние, -ание, -ение], input_pos: VERB, output_pos: NOUN, semantic_type: action_noun, meaning_en: "the action itself", meaning_zh: "動作本身", examples: [чтение, решение]}
  - {affix: -щик, variants: [-щик, -чик], input_pos: [VERB, NOUN], output_pos: NOUN, semantic_type: agent_noun, meaning_en: "person doing a job", meaning_zh: "從事某事的人", examples: [переводчик]}
  - {affix: -ник, input_pos: NOUN, output_pos: NOUN, semantic_type: person_noun, meaning_en: "person related to it", meaning_zh: "與某事物相關的人", examples: [работник]}
  - {affix: -ость, input_pos: ADJ, output_pos: NOUN, semantic_type: quality_noun, meaning_en: "quality, state", meaning_zh: "性質、狀態", examples: [новость, сложность]}
  - {affix: -ота, input_pos: ADJ, output_pos: NOUN, semantic_type: quality_noun, meaning_en: "quality", meaning_zh: "性質", examples: [красота, быстрота]}
  - {affix: -изн-, input_pos: ADJ, output_pos: NOUN, semantic_type: quality_noun, meaning_en: "quality", meaning_zh: "性質", examples: [белизна]}
  - {affix: -ск-, input_pos: NOUN, output_pos: ADJ, semantic_type: relational_adj, meaning_en: "of, relating to", meaning_zh: "屬於……的", examples: [городской]}
  - {affix: -н-, input_pos: NOUN, output_pos: ADJ, semantic_type: relational_adj, meaning_en: "of, relating to", meaning_zh: "……的", examples: [водный, книжный]}
  - {affix: -ов-, variants: [-ов-, -ев-], input_pos: NOUN, output_pos: ADJ, semantic_type: relational_adj, meaning_en: "made of, relating to", meaning_zh: "由……構成的、……的", examples: [берёзовый]}
  - {affix: -о, input_pos: ADJ, output_pos: ADV, semantic_type: manner_adverb, meaning_en: "adjective to adverb", meaning_zh: "形容詞轉副詞", examples: [быстро]}
  - {affix: -ыва-, variants: [-ыва-, -ива-, -ва-], input_pos: VERB, output_pos: VERB, semantic_type: secondary_imperfective, meaning_en: "makes a prefixed perfective imperfective again", meaning_zh: "把帶前綴的完成體動詞變回未完成體", examples: [записывать, переписывать]}
  - {affix: -ну-, input_pos: VERB, output_pos: VERB, semantic_type: semelfactive, meaning_en: "a single, one-time action", meaning_zh: "一次性的動作", examples: [прыгнуть]}
  - {affix: -ик, variants: [-ик, -чик], input_pos: NOUN, output_pos: NOUN, semantic_type: diminutive, meaning_en: "small (diminutive)", meaning_zh: "小的……（指小）", examples: [домик]}
  - {affix: -ниц-, input_pos: NOUN, output_pos: NOUN, semantic_type: feminine, meaning_en: "female counterpart", meaning_zh: "女性的……", examples: [учительница]}
  - {affix: -к-, input_pos: NOUN, output_pos: NOUN, semantic_type: feminine, meaning_en: "female counterpart", meaning_zh: "女性的……", examples: [студентка]}
  - {affix: -к-, input_pos: VERB, output_pos: NOUN, semantic_type: action_noun, meaning_en: "action or its result", meaning_zh: "動作或其結果", examples: [подписка]}
  - {affix: -а-, variants: [-а-, -я-], input_pos: NOUN, output_pos: VERB, semantic_type: verbalizer, meaning_en: "noun to verb", meaning_zh: "名詞轉動詞", examples: [работать]}
  - {affix: -и-, input_pos: [ADJ, NOUN], output_pos: VERB, semantic_type: verbalizer, meaning_en: "make / do (verbalizer)", meaning_zh: "使成為、做（轉動詞）", examples: [белить]}

postfixes:
  - {affix: -ся, variants: [-ся, -сь], input_pos: VERB, output_pos: VERB, semantic_type: reflexive, meaning_en: "reflexive, reciprocal or passive", meaning_zh: "反身、相互或被動", examples: [мыться]}
```

**語意類型標籤（`semantic_type`）**

| 代碼 | en | zh-Hant |
|---|---|---|
| agent_noun | Agent noun | 施事者名詞 |
| person_noun | Person noun | 人物名詞 |
| action_noun | Action noun | 動作名詞 |
| quality_noun | Quality noun | 性質名詞 |
| relational_adj | Relational adjective | 關係形容詞 |
| manner_adverb | Manner adverb | 方式副詞 |
| secondary_imperfective | Secondary imperfective | 次未完成體 |
| semelfactive | Semelfactive | 一次體 |
| diminutive | Diminutive | 指小詞 |
| feminine | Feminine counterpart | 陰性對應詞 |
| verbalizer | Verb-forming | 轉動詞 |
| reflexive | Reflexive | 反身 |

### 8.2 `motion_verbs.yaml`（14 對，未定向／定向）

```yaml
pairs:
  - [идти, ходить]
  - [ехать, ездить]
  - [бежать, бегать]
  - [лететь, летать]
  - [плыть, плавать]
  - [нести, носить]
  - [вести, водить]
  - [везти, возить]
  - [катиться, кататься]
  - [лезть, лазить]
  - [ползти, ползать]
  - [брести, бродить]
  - [гнать, гонять]
  - [тащить, таскать]
```
第一個為定向（unidirectional），第二個為不定向（multidirectional）。只有這 28 個詞本身標記 `motion_verb: true`，其帶前綴的派生詞不標。

### 8.3 `related_families.yaml`

```yaml
groups:
  - {label: "-бир- / -бер- / -бр-", lemmas: [брать, собирать, собрать, выбирать, выбрать]}
  - {label: "-лаг- / -лож-", lemmas: [предлагать, предложить, излагать, изложить]}
  - {label: "-ним- / -ня- / -им-", lemmas: [понимать, понять, принимать, принять, снимать, снять]}
```
建置時找出這些詞所屬的詞族，彼此加上「See related families」連結。**不合併樹。**

### 8.4 `overrides.yaml`

建立空結構：`segmentation: {}`、`stress: {}`、`gloss_en: {}`、`gloss_zh: {}`、`family: {}`。

---

## 9. CEFR 分級

### 9.1 使用的來源

| 來源 | 範圍 | 授權 | 用途 |
|---|---|---|---|
| SMARTool | A1–B2，約 3000 原形 | CC BY 4.0 | 教學導向等級；主題；例句；英文 gloss |
| Kelly 俄文 | A1–C2，約 9000 詞 | CC BY-NC-SA 2.0 | 頻率導向等級；校準估計門檻 |
| 頻率估計 | A1–C2 + beyond | 自行計算 | 後備，前端標示「Estimated／估計」 |

### 9.2 規則

- 每個詞儲存所有來源各自的等級。
- 顯示等級依使用者選擇的「Level source／分級依據」：
  - **Teaching（預設）**：SMARTool → Kelly → Estimated
  - **Frequency**：Kelly → SMARTool → Estimated
- **頻率估計門檻**：計算 Kelly 各等級詞的 Zipf 中位數；相鄰等級的分界 = 兩個中位數的平均；低於「C2 中位數 − 0.5」→ `beyond`。門檻寫入 `reports/summary.md`。
- **對應規則**：
  - 比對前統一小寫、`ё` → `е` 做比對鍵（保留原形）
  - Kelly／SMARTool 的動詞體成對條目（含 `/`）拆開，各自給相同等級
  - 同形異義詞：同時比對詞性（SMARTool 的 POS 代碼對應到第 7 節；無法對應者視為任意詞性）
  - 含空格的多詞條目：存入 `levels/phrases.json`，不顯示在樹上
  - 無法對應者寫入 `unmatched_levels.csv`

### 9.3 排除的來源（不要使用）

- ros-edu.ru 詞彙最低標準（授權不明）
- ТРКИ 官方詞彙最低標準出版品、Routledge 頻率詞典（有版權）

---

## 10. 授權分層（重要）

各來源授權條款互不相容，**資料依來源分檔輸出，由前端在執行時合併**，不可混在同一檔案：

| 資料夾 | 內容 | 授權 |
|---|---|---|
| `data/families/` | DeriNet 樹狀結構、連線註記 | CC BY-NC-SA 3.0 |
| `data/lexicon/` | 重音、切分、釋義、詞性特徵、星等、變化形索引 | CC BY-SA 4.0 |
| `data/levels/kelly.json` | Kelly 等級 | CC BY-NC-SA 2.0 |
| `data/levels/smartool.json`、`data/examples/`、`data/topics.json` | SMARTool 等級、例句、主題 | CC BY 4.0 |
| `data/levels/estimated.json` | 頻率估計等級 | CC BY-SA 4.0（源自 wordfreq） |
| 程式碼 | 全部 | MIT |

- `LICENSES.md` 與 About 頁列出所有來源、作者、授權、連結。
- README 註明：本專案為非商業用途；授權分層是工程上的保守做法，不構成法律意見。

---

## 11. 輸出資料格式（`web/public/data/`）

### 11.1 `families/{family_id}.json`

```json
{
  "id": "f00123",
  "root_lemma": "писать",
  "nodes": [
    {"id": "n0", "lemma": "писать", "pos": "VERB", "is_path_node": false},
    {"id": "n1", "lemma": "записать", "pos": "VERB", "is_path_node": false}
  ],
  "edges": [
    {
      "parent": "n0", "child": "n1",
      "added_prefixes": ["за-"], "added_suffixes": [], "added_postfixes": [],
      "root_alternation": false,
      "pos_change": "VERB>VERB",
      "semantic_type": null
    }
  ],
  "cross_links": [],
  "related_families": []
}
```

### 11.2 `lexicon/{shard}.json`（依正規化原形前兩個字母分片）

```json
{
  "записать": {
    "stressed": "записа́ть",
    "stress_source": "wiktionary-en",
    "segmentation": {
      "morphemes": [
        {"text": "за", "type": "PREF"},
        {"text": "пис", "type": "ROOT"},
        {"text": "а", "type": "SUFF"},
        {"text": "ть", "type": "END"}
      ],
      "source": "rumorpheme", "confidence": 0.93, "uncertain": false
    },
    "features": {"aspect": "perf", "reflexive": false, "transitivity": "tran", "motion_verb": false},
    "gloss_en": {"text": "to write down, to record", "source": "wiktionary-en"},
    "gloss_zh": {"text": "記下、錄下", "source": "wiktionary-zh"},
    "freq_stars": 4,
    "lexicalized_participle": false,
    "verb_forms": {"participles": [], "gerunds": []},
    "family_id": "f00123"
  }
}
```

### 11.3 索引

- `lexicon/forms/{shard}.json`：變化形（小寫、`ё`→`е`）→ `[原形]`。用 pymorphy3 產生所有保留原形的全部變化形。
- `lexicon/roots.json`：ROOT 字串 → `[family_id]`
- `lexicon/affix_index.json`：標準詞綴 → `[{lemma, family_id}]`
- `families_index.json`：每個詞族一筆 `{id, root_lemma, size, pos_counts, pos_changes, affixes, root_morph}`
- `affixes.json`：由 `affixes.yaml` 轉出

### 11.4 `levels/*.json`：`{lemma: "A1" | ... | "C2" | "beyond"}`

### 11.5 `examples/{shard}.json`：`{lemma: [{ru, en, form}]}`；`topics.json`：`{lemma: [topic_key]}` 與主題對照表

---

## 12. 國際化（i18n）

- **預設語言：English。** 語言切換鈕固定在頂部列右側，顯示「EN / 中文」。
- 語言偏好存 localStorage（鍵名 `rwf.lang`，值 `en` 或 `zh-Hant`），也可用 URL 參數 `lang=zh-Hant` 指定（URL 優先）。不依瀏覽器語言自動切換。
- 切換時更新 `<html lang>`（`en` / `zh-Hant`）。
- **俄文內容永遠不翻譯**（原形、例句俄文、詞綴字串）。
- 釋義顯示規則：
  - EN 模式：顯示 `gloss_en`
  - 中文模式：顯示 `gloss_zh`；沒有時顯示 `gloss_en` 並加小標記「EN」
- 例句翻譯：兩種模式都顯示英文翻譯（SMARTool 只有英文）。
- 詞綴說明、詞性、特徵、語意類型、主題名稱都有 en 與 zh-Hant 兩個版本。
- 字串集中在 `web/src/i18n/en.json`、`zh-Hant.json`，以鍵名存取；缺少翻譯時退回英文並在 console 警告。

**核心 UI 字串（兩種語言都要完整實作）**

| key | en | zh-Hant |
|---|---|---|
| app.title | Russian Word Families | 俄文詞族 |
| search.placeholder | Type any Russian word or form | 輸入任何俄文單字或變化形 |
| search.rootMode | Search by root | 以詞根搜尋 |
| search.notFound | No match for "{q}". Try the dictionary form, or search by root. | 找不到「{q}」。試試原形，或改用詞根搜尋。 |
| search.latinHint | Type in Cyrillic. Latin transliteration isn't supported. | 請使用西里爾字母輸入，不支援拉丁轉寫。 |
| search.chooseFamily | This root appears in several unrelated families. Choose one: | 這個詞根出現在幾個不相關的詞族中，請選擇： |
| nav.family | Family | 詞族 |
| nav.browse | Browse | 瀏覽 |
| nav.about | About | 關於 |
| view.tree | Tree | 樹狀圖 |
| view.outline | Outline | 大綱 |
| filter.title | Filters | 篩選 |
| filter.clear | Clear filters | 清除篩選 |
| filter.mode | Show non-matching words | 不符合的詞 |
| filter.mode.dim | Dimmed | 淡化顯示 |
| filter.mode.prune | Hidden | 隱藏 |
| filter.mode.list | As a list | 改為清單 |
| filter.level | CEFR level | CEFR 等級 |
| filter.includeEstimated | Include estimated levels | 包含估計等級 |
| filter.includeUnleveled | Include words without a level | 包含未分級的詞 |
| filter.pos | Part of speech | 詞性 |
| filter.gender | Gender | 性別 |
| filter.animacy | Animacy | 有生性 |
| filter.aspect | Aspect | 動詞體 |
| filter.reflexive | Reflexive verbs only | 只顯示反身動詞 |
| filter.transitivity | Transitivity | 及物性 |
| filter.motion | Verbs of motion only | 只顯示運動動詞 |
| filter.posChange | Word formation | 詞性轉換 |
| filter.semanticType | Formation type | 構詞類型 |
| filter.affix | Contains affix | 含有詞綴 |
| filter.topic | Topic | 主題 |
| filter.freq | Frequency | 常用程度 |
| filter.hideUncertain | Hide uncertain splits | 隱藏不確定的切分 |
| settings.levelSource | Level source | 分級依據 |
| settings.levelSource.teaching | Teaching lists | 教學詞表 |
| settings.levelSource.frequency | Frequency lists | 頻率詞表 |
| settings.myLevel | My level | 我的程度 |
| settings.colorBy | Color nodes by | 節點著色依據 |
| settings.colorBy.level | Level | 等級 |
| settings.colorBy.pos | Part of speech | 詞性 |
| tree.showMore | Show {n} more | 再顯示 {n} 個 |
| tree.pathNode | Rare word, shown to connect the tree | 罕用詞，為了連接樹而顯示 |
| tree.relatedFamilies | See related families | 參見相關詞族 |
| tree.rootAlternation | Root vowel changes | 詞根母音交替 |
| detail.addedFrom | Formed from {parent} by adding | 由 {parent} 加上 |
| detail.examples | Examples | 例句 |
| detail.participles | Participles | 形動詞 |
| detail.gerunds | Verbal adverbs | 副動詞 |
| detail.levelSources | Level by source | 各來源等級 |
| detail.uncertain | This split is a model guess and may be wrong. | 此切分為模型推測，可能有誤。 |
| detail.estimated | Estimated from word frequency | 依詞頻估計 |
| detail.noGloss | No definition available | 暫無釋義 |
| morph.PREF | Prefix | 前綴 |
| morph.ROOT | Root | 詞根 |
| morph.SUFF | Suffix | 後綴 |
| morph.END | Ending | 詞尾 |
| morph.POSTFIX | Postfix | 後置詞綴 |
| level.beyond | Beyond C2 | 超出分級 |
| level.none | No level | 未分級 |
| browse.title | Browse families | 瀏覽詞族 |
| browse.entryLevel | Entry level | 入門等級 |
| browse.size | Family size | 詞族大小 |
| browse.byAffix | Words with an affix | 依詞綴查詢 |
| browse.byFormation | Word formation patterns | 依構詞規律查詢 |
| browse.empty | No families match these filters. Remove a filter to see more. | 沒有符合條件的詞族。移除一個篩選條件試試。 |
| about.licenses | Data sources and licenses | 資料來源與授權 |

其餘字串依相同風格補齊：簡潔、主動語態、sentence case、錯誤訊息說明發生了什麼與如何解決。

---

## 13. 前端功能規格

### 13.1 路由（HashRouter）

- `#/` → 首頁：大搜尋框 + 5 個示範詞族連結（писать、читать、ходить、работа、новый）
- `#/family/:id?focus=<lemma>&...filters`
- `#/browse?...filters`
- `#/about`

### 13.2 搜尋

- 輸入正規化：小寫、去除 U+0301、`ё`→`е`、去頭尾空白。
- 輸入含拉丁字母 → 顯示 `search.latinHint`。
- 流程：查 `forms/{shard}` → 原形 → `lexicon` 取得 `family_id` → 跳轉並聚焦。
- 多個原形對應同一變化形時，列出所有候選（附詞性與釋義）讓使用者選。
- 詞根模式（切換開關）：查 `roots.json`；多個詞族時列出選項，每項附樹根詞與釋義。
- 輸入時提供最多 8 筆自動完成（從已載入分片的鍵中前綴比對）。

### 13.3 詞族樹

- **Tree 模式**（寬度 ≥ 768px 預設）：D3 水平樹（左到右），可縮放平移，節點可收合。
- **Outline 模式**（寬度 < 768px 預設）：縮排清單，同一份資料。
- 預設展開 2 層；每個節點預設只顯示最常用的前 8 個子節點，其餘收在 `tree.showMore`。
- 有 `focus` 時：展開樹根到該詞的完整路徑、置中並高亮該節點。
- `is_path_node` 節點淡色顯示並有 tooltip `tree.pathNode`。
- `cross_links`：虛線連到另一詞族的節點（點擊跳轉）。
- 連線標籤：新增詞綴 + 語意類型（例如 `-ние · Action noun`）；`root_alternation` 加標 `tree.rootAlternation`。
- 節點內容：重音原形（詞素上色）、詞性標籤、等級徽章。
- 鍵盤操作：方向鍵在節點間移動，Enter 開啟詳細面板，Space 收合／展開。

### 13.4 詳細面板

- 桌面：右側固定面板（寬 380px）；手機：底部抽屜。
- 內容順序：重音原形（大字、詞素上色）→ 詞素圖例 → 詞性與所有特徵 → 等級（顯示採用的來源，展開可看各來源等級）→ 釋義 → `detail.addedFrom` 與詞綴說明 → 主題標籤 → 例句 → 形動詞／副動詞（僅動詞）→ 常用程度星等。
- 切分 `uncertain` 時顯示 `detail.uncertain`。

### 13.5 篩選

| 維度 | 選項 | URL 參數 |
|---|---|---|
| CEFR 等級 | A1–C2、beyond 多選；含估計、含未分級開關 | `level=A1,A2&est=1&unleveled=0` |
| 詞性 | 第 7 節八類多選 | `pos=VERB,NOUN` |
| 性別 | 第 7 節 | `gender=femn` |
| 有生性 | 第 7 節 | `anim=anim` |
| 動詞體 | 第 7 節 | `aspect=perf` |
| 反身 | 開關 | `refl=1` |
| 及物性 | 第 7 節 | `trans=tran` |
| 運動動詞 | 開關 | `motion=1` |
| 詞性轉換 | 所有出現過的 `pos_change`（顯示為「Verb → Noun」） | `pc=VERB>NOUN` |
| 構詞類型 | 第 8.1 節語意類型 | `st=action_noun` |
| 詞綴 | 自動完成選擇，可多個 | `affix=вы-,-ние` |
| 主題 | SMARTool 主題 | `topic=еда` |
| 常用程度 | 最低星等 | `stars=3` |
| 隱藏不確定切分 | 開關 | `certain=1` |

- **維度之間為 AND，同一維度內為 OR。**
- 名詞子分類只在 `pos` 未指定或包含 NOUN 時顯示；動詞子分類同理。
- **詞性轉換與構詞類型作用於連線，符合的是子節點**（篩 `VERB>NOUN` 時符合的是 `чтение`，不是 `читать`）。
- 預設全部顯示；「估計等級」預設包含、「未分級」預設包含。
- 篩選面板：桌面為左側可收合抽屜；手機為全螢幕面板。已啟用的篩選以標籤列顯示在樹上方，每個可單獨移除。

### 13.6 篩選呈現模式（`mode=dim|prune|list`，預設 `dim`）

1. **dim**：不符合的節點透明度 0.25，保留結構；沒有任何符合節點的子樹自動收合。
2. **prune**：隱藏不符合節點，但保留符合節點通往樹根的所有祖先（透明度 0.4）。與建置時的路徑保留共用演算法（前端另寫一份 TypeScript 版本）。
3. **list**：符合的詞攤平成清單，可依等級或星等排序。

### 13.7 我的程度

- 設定值：None（預設）、A1–C2，存 localStorage `rwf.myLevel`。
- 設定後：≤ 我的程度 → 正常；**高一級 → 加粗外框與「Next」標記（中文「下一步」）**；更高 → 透明度 0.5。

### 13.8 著色依據

- `colorBy=level`（預設）：節點底色 = 等級色。
- `colorBy=pos`：節點底色 = 詞性色。
- 無論哪種模式，等級徽章永遠顯示文字（A1…），詞性標籤永遠顯示文字。

### 13.9 詞族瀏覽頁

- 表格清單：樹根詞（重音）、釋義、入門等級、詞族大小、各等級數量迷你條。
- 排序：入門等級、詞族大小、樹根詞字母。
- 篩選：第 13.5 節全部維度 + 「至少有 N 個符合條件的詞」（`min=3`）。符合定義：該詞族內符合條件的詞數。
- 分頁：每頁 50 筆。
- 兩個分頁籤：
  - **Words with an affix**：選一個詞綴 → 跨詞族列出所有含該詞綴的詞（可再套等級、詞性篩選），每筆可跳到詞族並聚焦。
  - **Word formation patterns**：選一種詞性轉換或構詞類型 → 列出「父詞 → 子詞」配對（例如 `читать → чтение`），可套等級篩選。
- 詞族的等級統計在前端依目前「分級依據」即時計算。

### 13.10 效能

- 所有 JSON 以 fetch 動態載入，已載入分片快取在記憶體。
- `families_index.json` 與 `affix_index.json` 只在進入 Browse 頁時載入。
- 超過 300 個可見節點時，自動改用收合更深層級。

---

## 14. 視覺設計（已確定）

**概念：植物標本圖鑑式的詞源樹。** 詞如同從枝幹長出的新枝，詞根是整棵樹的紅色核心。畫面主角是詞素上色與連線上的詞綴標籤，其餘部分安靜克制。

**字體**
- 俄文詞（節點、詳細面板大字、例句俄文）：**PT Serif**（為俄文設計，西里爾字母與重音符號顯示優秀）
- 英文 UI：**IBM Plex Sans**
- 中文 UI：**Noto Sans TC**（放在 IBM Plex Sans 之後作為 fallback，確保中英混排正常）
- 字級：基準 16px，比例 1.25（12.8 / 16 / 20 / 25 / 31.25）；詳細面板俄文大字 31.25px；行高內文 1.55、俄文襯線 1.6。

**色彩 tokens（淺色）**

| token | hex | 用途 |
|---|---|---|
| --bg | #F3F5F1 | 頁面背景（淡灰綠） |
| --surface | #FFFFFF | 面板 |
| --ink | #1D2A2F | 主要文字 |
| --ink-muted | #5B6A70 | 次要文字 |
| --line | #C9D2CC | 連線、分隔線 |
| --accent | #2F5D50 | 焦點、選取、按鈕 |

**深色**

| token | hex |
|---|---|
| --bg | #151C1E |
| --surface | #1E2729 |
| --ink | #E6ECE8 |
| --ink-muted | #9AA8A4 |
| --line | #3A4745 |
| --accent | #7FB8A6 |

**詞素文字色（淺／深）**：PREF #1D5FA8 / #7DB3F0；ROOT #A8261D / #F08A7E；SUFF #2E7033 / #8FD19A；END #6B7478 / #9AA5A9；POSTFIX #6E4596 / #C5A2EE。詞根另加粗體。

**等級底色（淺／深，文字一律用 --ink）**：A1 #DDEFD9 / #2C4430；A2 #C3E4C4 / #36543A；B1 #D5E6F3 / #2B4152；B2 #B3D0EA / #34506A；C1 #E9DDF1 / #43364F；C2 #D6BFE6 / #54406A；beyond #E7E3DC / #3C3934。估計等級：徽章改為 1.5px 虛線外框。

**詞性底色（colorBy=pos）**：NOUN #D6E4F5；VERB #F6DCC8；ADJ #D8EDD9；ADV #E6DDF3；其餘 #E7E6E2（深色模式各自降低亮度到同一明度層級）。

**版面（桌面）**

```
┌──────────────────────────────────────────────────────────┐
│ Russian Word Families   [ search.................. ]  Browse About  EN/中文 ⚙ │
├──────────┬───────────────────────────────────┬───────────┤
│ Filters  │ [active filter chips]             │ Detail    │
│ (drawer) │                                   │ panel     │
│          │        tree canvas                │ 380px     │
│          │                                   │           │
└──────────┴───────────────────────────────────┴───────────┘
```
- 左對齊為主；樹畫布佔滿剩餘空間。
- 節點：小圓角（4px）矩形，無陰影；層級靠線條與留白表達，不用卡片堆疊。
- 動畫：只在展開／收合與聚焦時使用 200ms 過渡；尊重 `prefers-reduced-motion`（改為無動畫）。
- 避免：漸層裝飾、全大寫標籤、到處都是的圓角卡片、裝飾性編號。

**無障礙**：所有色彩組合對比度 ≥ 4.5:1（徽章文字）；可見焦點框（2px --accent 外框）；所有圖示按鈕有 `aria-label`（依語言）；樹有 `role="tree"`、節點 `role="treeitem"`。

---

## 15. 測試與驗收

### 15.1 建置腳本（pytest）
- 路徑祖先保留（篩除罕用詞後樹不斷裂）
- 詞綴差異計算：同時新增前綴＋後綴、詞根交替、比對失敗三種情況
- 詞綴變體對應（`рас-` → `раз-`）
- `-ть` 強制為 END
- ё/е 正規化、動詞體成對拆分
- pymorphy3 標記 → 統一詞性與特徵；雙體判定
- 中文釋義清理（OpenCC 轉換與 `〔…〕` 移除）
- 頻率估計門檻計算

### 15.2 抽查詞族（寫入 `reports/spot_checks.md`，並在 FINAL_REPORT 中摘要是否合理）
`писать`、`читать`、`делать`、`ходить`、`идти`、`работа`、`новый`、`говорить`、`брать`、`вода`、`водить`

### 15.3 前端（vitest）
- 篩選 AND/OR 邏輯
- prune 模式祖先保留
- 詞性轉換篩選作用於子節點
- 我的程度的分組計算
- i18n：兩個語言檔的鍵完全一致（測試比對鍵集合）

### 15.4 驗收條件
- 搜尋 `записал` 能到達 `писать` 詞族並聚焦 `записать`
- 切換中文後所有 UI 文字變為繁體中文，俄文內容不變，重新整理後保持中文
- `?level=A1,A2&pos=VERB&mode=prune` 的網址能重現相同畫面
- 手機寬度 375px 可正常使用 Outline 模式與底部詳細面板
- Lighthouse 無障礙分數 ≥ 90
- 部署到 GitHub Pages 後所有路由可直接開啟

---

## 16. 里程碑（依序全部完成，不要停下）

1. **M1 下載與探勘**：完成 `download.py`，下載所有資料，偵測 DeriNet 欄位、維基詞典可用欄位、切分模型授權，記錄到 `DECISIONS.md`。
2. **M2 Adapters 與建置管線**：第 6 節步驟 1–9，輸出所有 JSON 與建置報告；建立第 8 節所有人工檔案。
3. **M3 前端骨架**：路由、i18n（EN 預設 + 中文切換）、主題色彩與字體、深色模式、搜尋（原形 + 變化形）。
4. **M4 詞族樹與詳細面板**：Tree／Outline 模式、收合、聚焦、連線標籤、詳細面板、例句。
5. **M5 分級**：等級顯示、分級依據切換、我的程度、著色依據。
6. **M6 篩選**：第 13.5 節全部維度、三種呈現模式、URL 同步、篩選標籤列。
7. **M7 瀏覽頁**：詞族清單、依詞綴查詢、依構詞規律查詢。
8. **M8 完善與部署**：詞根搜尋、相關詞族、About 頁與授權、無障礙檢查、測試全部通過、GitHub Actions 部署、`FINAL_REPORT.md`。

---

## 17. 不做的事

- 閱讀助手、閃卡、間隔複習、帳號、雲端同步
- 任何模型訓練
- 語料覆蓋率研究
- 變格／變位練習（變化形只用於搜尋索引與詳細面板）
- 拉丁轉寫輸入
- 藏文或其他語言（adapter 介面保持語言無關）
