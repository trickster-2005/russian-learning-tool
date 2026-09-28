"""Download all external data sources into build/.cache/.

Downloads are resumable (HTTP Range) and cached: a file that is already
complete is skipped. Each download is retried 3 times; failures are recorded
in reports/download_status.json and the build continues without that source.
"""

from __future__ import annotations

import gzip
import io
import json
import re
import sys
import tarfile
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
REPORTS = ROOT / "reports"
STATUS_FILE = REPORTS / "download_status.json"

DERINET_PAGE = "https://ufal.mff.cuni.cz/derinet"
DERINET_ZIP_RE = re.compile(r'href="([^"]*derinet-?ru-?0\.5\.zip)"', re.IGNORECASE)
# Fallback: Universal Derivations 1.1 (LINDAT, hdl 11234/1-3247) ships DeriNet.RU as ru-DeriNetRU.
UDER_URL = (
    "https://lindat.mff.cuni.cz/repository/server/api/core/bitstreams/"
    "b988724d-8aef-4614-900d-563e4f1e49b5/content"
)
KELLY_URL ="https://ssharoff.github.io/kelly/ru_m3.xls"
SMARTOOL_BASE = "https://raw.githubusercontent.com/smartool/data-rus-eng/master/"
SMARTOOL_FILES = [
    "SMARTool_data_A1.csv",
    "SMARTool_data_A2.csv",
    "SMARTool_data_B1.csv",
    "SMARTool_data_B2.csv",
    "SMARTool_data_Topics.csv",
    "LICENSE",
]
# English Wiktionary: kaikki's Russian-only extract of the same wiktextract data (90 MB instead of
# the 3 GB all-language dump). It is already limited to Russian entries, so it is kept gzipped and
# read directly. zh/ru have no per-language file, so their raw dumps are streamed and filtered.
WIKT_EN_RU = "https://kaikki.org/dictionary/Russian/kaikki.org-dictionary-Russian.jsonl.gz"
WIKT = {
    "en": "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz",
    "zh": "https://kaikki.org/zhwiktionary/raw-wiktextract-data.jsonl.gz",
    "ru": "https://kaikki.org/ruwiktionary/raw-wiktextract-data.jsonl.gz",
}

UA = {"User-Agent": "russian-word-family-build/0.1 (non-commercial research)"}


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def fetch(url: str, dest: Path, retries: int = 3) -> None:
    """Resumable download with retries. Raises on final failure."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    if dest.exists():
        log(f"cached: {dest.name}")
        return
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            have = part.stat().st_size if part.exists() else 0
            headers = dict(UA)
            if have:
                headers["Range"] = f"bytes={have}-"
            with requests.get(url, headers=headers, stream=True, timeout=60) as r:
                if r.status_code == 416:  # already complete
                    part.rename(dest)
                    return
                r.raise_for_status()
                mode = "ab" if have and r.status_code == 206 else "wb"
                if mode == "wb":
                    have = 0
                total = int(r.headers.get("Content-Length", 0)) + have
                done = have
                next_report = time.time() + 30
                with open(part, mode) as f:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        f.write(chunk)
                        done += len(chunk)
                        if time.time() > next_report:
                            pct = f"{100 * done / total:.1f}%" if total else f"{done >> 20} MB"
                            log(f"  {dest.name}: {pct}")
                            next_report = time.time() + 30
            part.rename(dest)
            log(f"downloaded: {dest.name}")
            return
        except Exception as e:  # noqa: BLE001 - retry any network error
            last_err = e
            log(f"  attempt {attempt}/{retries} failed for {dest.name}: {e}")
            time.sleep(5 * attempt)
    raise RuntimeError(f"failed after {retries} attempts: {last_err}")


def download_derinet() -> None:
    """DeriNet.RU 0.5 from the ÚFAL page; falls back to the copy in UDer 1.1."""
    out_dir = CACHE / "derinet"
    if out_dir.exists() and any(out_dir.iterdir()):
        log("cached: derinet/")
        return
    try:
        dest = CACHE / "derinet-ru-0.5.zip"
        if not dest.exists():
            html = requests.get(DERINET_PAGE, headers=UA, timeout=60).text
            m = DERINET_ZIP_RE.search(html)
            if not m:
                raise RuntimeError("DeriNet.RU 0.5 zip link not found on the DeriNet page")
            url = requests.compat.urljoin(DERINET_PAGE, m.group(1))
            log(f"DeriNet.RU link: {url}")
            fetch(url, dest)
        with zipfile.ZipFile(dest) as z:
            z.extractall(out_dir)
        (out_dir / "SOURCE").write_text("derinet-ru-0.5", encoding="utf-8")
        log("extracted DeriNet.RU 0.5")
        return
    except Exception as e:  # noqa: BLE001
        log(f"DeriNet.RU 0.5 unavailable ({e}); falling back to UDer 1.1")
    tgz = CACHE / "UDer-1.1.tgz"
    fetch(UDER_URL, tgz)
    out_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tgz, "r:gz") as tar:
        for member in tar.getmembers():
            name = Path(member.name).name
            if name.startswith("UDer-1.1-ru-DeriNetRU") or name in ("LICENSE", "README.md"):
                f = tar.extractfile(member)
                if f is not None:
                    (out_dir / name).write_bytes(f.read())
    (out_dir / "SOURCE").write_text("uder-1.1", encoding="utf-8")
    log("extracted DeriNet.RU from UDer 1.1")


def download_kelly() -> None:
    fetch(KELLY_URL, CACHE / "kelly" / "ru_m3.xls")


def download_smartool() -> None:
    for name in SMARTOOL_FILES:
        fetch(SMARTOOL_BASE + name, CACHE / "smartool" / name)


def filter_wiktionary(lang: str, raw: Path, out: Path) -> int:
    """Stream the gzip line by line and keep only lang_code == 'ru' entries."""
    tmp = out.with_suffix(".tmp")
    kept = 0
    with gzip.open(raw, "rt", encoding="utf-8") as fin, open(tmp, "w", encoding="utf-8") as fout:
        for i, line in enumerate(fin):
            if '"ru"' not in line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("lang_code") != "ru":
                continue
            fout.write(line if line.endswith("\n") else line + "\n")
            kept += 1
            if i and i % 2_000_000 == 0:
                log(f"  wikt_{lang}: scanned {i:,} lines, kept {kept:,}")
    tmp.rename(out)
    return kept


def download_wiktionary(lang: str) -> None:
    out = CACHE / f"wikt_{lang}_ru.jsonl"
    if out.exists() or (CACHE / f"wikt_{lang}.v3.pkl").exists():
        log(f"cached: wikt_{lang}")
        return
    if lang == "en":
        fetch(WIKT_EN_RU, CACHE / "wikt_en_ru.jsonl.gz")
        return
    raw = CACHE / "raw" / f"wikt_{lang}_raw.jsonl.gz"
    fetch(WIKT[lang], raw)
    log(f"filtering {raw.name} ...")
    kept = filter_wiktionary(lang, raw, out)
    log(f"wikt_{lang}_ru.jsonl: {kept:,} Russian entries")


TASKS = {
    "derinet": download_derinet,
    "kelly": download_kelly,
    "smartool": download_smartool,
    "wikt_en": lambda: download_wiktionary("en"),
    "wikt_zh": lambda: download_wiktionary("zh"),
    "wikt_ru": lambda: download_wiktionary("ru"),
}


def run(names: list[str]) -> dict[str, str]:
    REPORTS.mkdir(exist_ok=True)
    status: dict[str, str] = {}
    if STATUS_FILE.exists():
        status = json.loads(STATUS_FILE.read_text(encoding="utf-8"))

    def one(name: str) -> tuple[str, str]:
        try:
            TASKS[name]()
            return name, "ok"
        except Exception as e:  # noqa: BLE001 - record and continue without the source
            log(f"FAILED {name}: {e}")
            return name, f"failed: {e}"

    with ThreadPoolExecutor(max_workers=len(names)) as ex:
        for name, result in ex.map(one, names):
            status[name] = result
    STATUS_FILE.write_text(json.dumps(status, indent=2, ensure_ascii=False), encoding="utf-8")
    return status


if __name__ == "__main__":
    names = sys.argv[1:] or list(TASKS)
    result = run(names)
    for k, v in result.items():
        log(f"{k}: {v}")
