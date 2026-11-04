/**
 * Word matching for the vocabularies (python/src/factlot/words.py is the same code): a text
 * becomes words, and keyword phrases are found in those words. ASCII only after normalization,
 * so both languages read the same words.
 */

/** Simple plural folding: "bakeries" → "bakery", "taxes" → "tax", "drinks" → "drink". */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (
    word.length > 4 &&
    ["sses", "shes", "ches", "xes"].some((e) => word.endsWith(e))
  )
    return word.slice(0, -2);
  if (
    word.length > 3 &&
    word.endsWith("s") &&
    !["ss", "us", "is"].some((e) => word.endsWith(e))
  )
    return word.slice(0, -1);
  return word;
}

/**
 * The words of a text: Unicode NFKD with combining marks removed, lower case, each run of ASCII
 * letters and digits one word, plurals folded. "Café & Bakeries" → ["cafe", "bakery"].
 */
export function words(text: string): string[] {
  const t = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return [...t.matchAll(/[a-z0-9]+/g)].map((m) => stem(m[0]));
}

export interface KeywordMatch {
  key: string;
  keyword: string;
  start: number;
  end: number;
}

/** Keyword phrases by key (a category), found as whole words in a text's words. */
export class KeywordIndex {
  private byFirst = new Map<
    string,
    { key: string; keyword: string; words: string[] }[]
  >();

  constructor(entries: Iterable<{ key: string; keywords: readonly string[] }>) {
    for (const { key, keywords } of entries)
      for (const keyword of keywords) {
        const w = words(keyword);
        if (w.length === 0) continue;
        const list = this.byFirst.get(w[0]!) ?? [];
        list.push({ key, keyword, words: w });
        this.byFirst.set(w[0]!, list);
      }
  }

  /**
   * Every keyword found in the words, except one lying inside a longer match: in "juice bar",
   * "bar" is dropped for "juice bar". Ordered by position, then by length (longest first).
   */
  find(text: readonly string[]): KeywordMatch[] {
    const found: KeywordMatch[] = [];
    text.forEach((w, i) => {
      for (const k of this.byFirst.get(w) ?? [])
        if (
          i + k.words.length <= text.length &&
          k.words.every((x, j) => text[i + j] === x)
        )
          found.push({
            key: k.key,
            keyword: k.keyword,
            start: i,
            end: i + k.words.length,
          });
    });
    const kept = found.filter(
      (a) =>
        !found.some(
          (b) =>
            b.start <= a.start &&
            a.end <= b.end &&
            b.end - b.start > a.end - a.start,
        ),
    );
    return kept.sort(
      (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
    );
  }
}
