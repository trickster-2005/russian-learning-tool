import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { getEntries, getFamily, getFormsShard, getRoots } from "../data/api";
import type { LexEntry } from "../data/types";
import { hasLatin, keyLemma, normKey, shardOf } from "../lib/normalize";
import { glossFor } from "./Gloss";

interface Suggestion {
  form: string;
  keys: string[];
}

type Message =
  | { kind: "notFound"; q: string }
  | { kind: "words"; q: string; items: { key: string; entry: LexEntry | undefined }[] }
  | { kind: "families"; items: { id: string; root: string; gloss: string }[] }
  | null;

export default function SearchBox({ big = false, autoFocus = false }: { big?: boolean; autoFocus?: boolean }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [rootMode, setRootMode] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const hintId = useId();
  const reqRef = useRef(0);

  const latin = hasLatin(q);

  useEffect(() => {
    const key = normKey(q);
    const req = ++reqRef.current;
    if (rootMode || latin || key.length < 2) {
      setSuggestions([]);
      return;
    }
    getFormsShard(shardOf(key))
      .then((forms) => {
        if (req !== reqRef.current) return;
        const out: Suggestion[] = [];
        if (forms[key]) out.push({ form: key, keys: forms[key] });
        for (const [form, keys] of Object.entries(forms)) {
          if (out.length >= 8) break;
          if (form !== key && form.startsWith(key) && keys.some((k) => normKey(keyLemma(k)) === form)) {
            out.push({ form, keys });
          }
        }
        setSuggestions(out.slice(0, 8));
        setActive(-1);
      })
      .catch(() => setSuggestions([]));
  }, [q, rootMode, latin]);

  const goToWord = async (key: string) => {
    const entries = await getEntries([key]);
    const e = entries[key];
    if (!e) return;
    setOpen(false);
    setMessage(null);
    setQ("");
    navigate(`/family/${e.family_id}?focus=${encodeURIComponent(key)}`);
  };

  const submit = async (value: string) => {
    const key = normKey(value);
    if (!key || hasLatin(key)) return;
    setBusy(true);
    setOpen(false);
    try {
      if (rootMode) {
        const roots = await getRoots();
        const fids = roots[key] ?? [];
        if (fids.length === 0) setMessage({ kind: "notFound", q: value.trim() });
        else if (fids.length === 1) {
          setMessage(null);
          setQ("");
          navigate(`/family/${fids[0]}`);
        } else {
          const fams = await Promise.all(fids.slice(0, 20).map((id) => getFamily(id)));
          const rootKeys = fams.map((f) => f.nodes[0].key ?? f.nodes[0].lemma);
          const entries = await getEntries(rootKeys);
          setMessage({
            kind: "families",
            items: fams.map((f, i) => ({
              id: f.id,
              root: entries[rootKeys[i]]?.stressed ?? f.root_lemma,
              gloss: glossFor(entries[rootKeys[i]], lang).text,
            })),
          });
        }
        return;
      }
      const forms = await getFormsShard(shardOf(key));
      const keys = forms[key] ?? [];
      if (keys.length === 0) setMessage({ kind: "notFound", q: value.trim() });
      else if (keys.length === 1) await goToWord(keys[0]);
      else {
        const entries = await getEntries(keys);
        setMessage({ kind: "words", q: value.trim(), items: keys.map((k) => ({ key: k, entry: entries[k] })) });
      }
    } catch {
      setMessage({ kind: "notFound", q: value.trim() });
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (open && active >= 0 && suggestions[active]) {
      const s = suggestions[active];
      if (s.keys.length === 1) void goToWord(s.keys[0]);
      else void submit(s.form);
      return;
    }
    void submit(q);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && suggestions.length > 0 && !latin;

  return (
    <div className="search">
      <form role="search" onSubmit={onSubmit}>
        <div className="search-row">
          <label className="visually-hidden" htmlFor={`${listId}-input`}>
            {t("search.label")}
          </label>
          <input
            id={`${listId}-input`}
            type="search"
            value={q}
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            lang="ru"
            placeholder={rootMode ? t("search.rootMode") : t("search.placeholder")}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
            aria-describedby={latin ? hintId : undefined}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setMessage(null);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
          />
          {big ? (
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {t("search.button")}
            </button>
          ) : (
            <label className="root-toggle" title={t("search.rootMode")}>
              <input type="checkbox" checked={rootMode} onChange={(e) => setRootMode(e.target.checked)} />
              <span>{t("search.rootShort")}</span>
            </label>
          )}
        </div>
        {showList && (
          <ul id={listId} role="listbox" className="suggestions">
            {suggestions.map((s, i) => (
              <li
                key={s.form}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (s.keys.length === 1) void goToWord(s.keys[0]);
                  else void submit(s.form);
                }}
              >
                <span className="ru" lang="ru">
                  {s.form}
                </span>
                {s.keys.length === 1 && normKey(keyLemma(s.keys[0])) !== s.form && (
                  <span className="muted">
                    {t("search.formOf")}{" "}
                    <span className="ru" lang="ru">
                      {keyLemma(s.keys[0])}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {big && (
          <label className="check search-hint">
            <input type="checkbox" checked={rootMode} onChange={(e) => setRootMode(e.target.checked)} />
            {t("search.rootMode")}
          </label>
        )}
        {latin && (
          <p id={hintId} className="search-hint" role="status">
            {t("search.latinHint")}
          </p>
        )}
      </form>
      {busy && <p className="search-hint">{t("search.loading")}</p>}
      {message && (
        <div className="search-message" role="status">
          {message.kind === "notFound" && t("search.notFound", { q: message.q })}
          {message.kind === "words" && (
            <>
              {t("search.chooseWord", { q: message.q })}
              <ul>
                {message.items.map(({ key, entry }) => (
                  <li key={key}>
                    <button type="button" onClick={() => void goToWord(key)}>
                      <span className="ru" lang="ru">
                        {entry?.stressed ?? keyLemma(key)}
                      </span>
                      <span className="pos-tag">{entry ? t(`pos.${entry.pos}`) : ""}</span>
                      <span className="muted">{glossFor(entry, lang).text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {message.kind === "families" && (
            <>
              {t("search.chooseFamily")}
              <ul>
                {message.items.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setMessage(null);
                        navigate(`/family/${f.id}`);
                      }}
                    >
                      <span className="ru" lang="ru">
                        {f.root}
                      </span>
                      <span className="muted">{f.gloss}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
