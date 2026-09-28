import type {
  AffixTable,
  Example,
  Family,
  FamilyIndexEntry,
  LevelMaps,
  LexEntry,
  Meta,
  SummaryRow,
  Topics,
} from "./types";
import { shardOf } from "../lib/normalize";

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();

export class NotFoundError extends Error {}

function fetchJson<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(BASE + path).then((r) => {
      if (r.status === 404) throw new NotFoundError(path);
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path)); // allow retry after failures
    cache.set(path, p);
  }
  return p;
}

export const getMeta = () => fetchJson<Meta>("meta.json");
export const getFamily = (id: string) => fetchJson<Family>(`families/${id}.json`);
export const getAffixes = () => fetchJson<AffixTable>("affixes.json");
export const getTopics = () => fetchJson<Topics>("topics.json");
export const getRoots = () => fetchJson<Record<string, string[]>>("lexicon/roots.json");
export const getAffixIndex = () =>
  fetchJson<Record<string, { lemma: string; family_id: string }[]>>("lexicon/affix_index.json");
export const getFamiliesIndex = () => fetchJson<FamilyIndexEntry[]>("families_index.json");
export const getSummary = () => fetchJson<Record<string, SummaryRow>>("lexicon/summary.json");

export async function getLevels(): Promise<LevelMaps> {
  const [kelly, smartool, estimated] = await Promise.all([
    fetchJson<LevelMaps["kelly"]>("levels/kelly.json").catch(() => ({})),
    fetchJson<LevelMaps["smartool"]>("levels/smartool.json").catch(() => ({})),
    fetchJson<LevelMaps["estimated"]>("levels/estimated.json").catch(() => ({})),
  ]);
  return { kelly, smartool, estimated };
}

async function shardFile<T>(dir: string, shard: string, listed: string[]): Promise<Record<string, T>> {
  if (!listed.includes(shard)) return {};
  return fetchJson<Record<string, T>>(`${dir}/${shard}.json`);
}

export async function getLexShard(shard: string): Promise<Record<string, LexEntry>> {
  const meta = await getMeta();
  return shardFile<LexEntry>("lexicon", shard, meta.lexicon_shards);
}

export async function getFormsShard(shard: string): Promise<Record<string, string[]>> {
  const meta = await getMeta();
  return shardFile<string[]>("lexicon/forms", shard, meta.forms_shards);
}

/** Load lexicon entries for the given keys (fetches the needed shards in parallel). */
export async function getEntries(keys: string[]): Promise<Record<string, LexEntry>> {
  const shards = [...new Set(keys.map((k) => shardOf(k.split("#")[0])))];
  const loaded = await Promise.all(shards.map((s) => getLexShard(s)));
  const out: Record<string, LexEntry> = {};
  for (const data of loaded) {
    for (const k of keys) if (data[k]) out[k] = data[k];
  }
  return out;
}

export async function getExamples(key: string): Promise<Example[]> {
  const meta = await getMeta();
  const data = await shardFile<Example[]>("examples", shardOf(key.split("#")[0]), meta.example_shards).catch(
    () => ({}) as Record<string, Example[]>,
  );
  return data[key] ?? [];
}

export const nodeKey = (n: { lemma: string; key?: string }) => n.key ?? n.lemma;
