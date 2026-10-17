// Confronto approssimato tra titoli e nomi, per gli script delle copertine.

import { normalizeText } from '../../src/lib/aggregate';

const STOPWORDS = new Set(['the', 'il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'di', 'del', 'della', 'a', 'of', 'e']);

export const tokens = (s: string) => new Set(normalizeText(s).split(' ').filter((t) => t && !STOPWORDS.has(t)));

/** Quota di parole di `want` presenti in `got` (0..1). */
export function overlap(want: string, got: string): number {
  const w = tokens(want);
  if (!w.size) return 0;
  const g = tokens(got);
  return [...w].filter((t) => g.has(t)).length / w.size;
}

/** Somiglianza tra due nomi di artista/autore, in entrambe le direzioni (0..1). */
export const nameMatch = (a: string, b: string) => Math.max(overlap(a, b), overlap(b, a));

/** Toglie le parti tra parentesi, es. "Harry Potter (la saga)" → "Harry Potter". */
export const stripParens = (s: string) => s.replace(/\(.*?\)|\[.*?\]/g, '').trim();

/** Identità di un titolo tra liste diverse (stessa formula delle spunte "Ce l'ho" nella pagina). */
export const curatedKey = (e: { creator: string; title: string }) => `${normalizeText(e.creator)}|${normalizeText(e.title)}`;
