// Must match build/common.py norm_key() and shard_of().

export function normKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[́̀]/g, "")
    .normalize("NFC")
    .replace(/ё/g, "е");
}

export function shardOf(word: string): string {
  const k = Array.from(normKey(word))
    .filter((ch) => /\p{L}/u.test(ch))
    .join("");
  if (!k) return "_";
  return k.length >= 2 ? k.slice(0, 2) : k + "_";
}

export function hasLatin(s: string): boolean {
  return /[a-z]/i.test(s);
}

/** Display key: lexicon keys may carry '#POS' for homographs. */
export function keyLemma(key: string): string {
  const i = key.indexOf("#");
  return i < 0 ? key : key.slice(0, i);
}
