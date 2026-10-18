// Catalogo dei libri per la pagina "I miei libri letti", come file statico (/libri/catalogo.json) scaricato solo da quella pagina:
// il catalogo privato/libri-letti.json (scripts/anobii-import.ts, fuori da git) più i libri della classifica Libri e delle
// liste "Libri da avere", così compaiono anche quelli spuntati sul sito. Quali libri mostrare lo decide la pagina, con le
// spunte dell'utente (lista "letti").
import type { APIRoute } from 'astro';
import { entryKey } from '../../lib/aggregate';
import { getBookInfo, getChart, getCuratedList } from '../../lib/data';
import { CURATED_IDS, PERIOD_IDS, type ReadBook, type ReadBookCatalog } from '../../lib/types';

const catalogs = import.meta.glob<ReadBookCatalog>('/privato/libri-letti.json', { eager: true, import: 'default' });

function catalog(): ReadBook[] {
  const books: ReadBook[] = [];
  const byKey = new Map<string, ReadBook>();
  const add = (b: ReadBook) => {
    const known = b.keys.map((k) => byKey.get(k)).find(Boolean);
    if (known) {
      known.cover ??= b.cover;
      known.year ??= b.year;
      return;
    }
    books.push(b);
    for (const k of b.keys) byKey.set(k, b);
  };
  for (const c of Object.values(catalogs)) for (const { isbn: _, ...b } of c.books) add(b);

  const empty = { pages: null, publisher: null, finished: null, rating: null };
  for (const period of PERIOD_IDS)
    for (const view of getChart('libri', period)?.views ?? [])
      for (const e of view.entries) {
        const info = getBookInfo(e.key);
        add({ ...empty, title: e.title, author: e.subtitle ?? '', cover: e.cover, year: Number(info?.released?.slice(0, 4)) || null, keys: [e.key] });
      }
  for (const id of CURATED_IDS.filter((id) => id.startsWith('libri-')))
    for (const e of getCuratedList(id).entries)
      add({
        ...empty,
        title: e.title,
        author: e.creator,
        cover: e.cover ?? null,
        year: typeof e.year === 'number' ? e.year : null,
        keys: [entryKey({ title: e.title, subtitle: e.creator })],
      });
  return books;
}

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ books: catalog() }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
