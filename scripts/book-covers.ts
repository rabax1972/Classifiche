// Completa le copertine delle liste di libri ("Libri da avere" e Le Monde).
// Da lanciare a mano (la lista è statica): `npm run covers:libri` (aggiungi `-- --force` per rifarle tutte).
// Prima cerca l'edizione italiana su Apple Books (titolo italiano), poi su Open Library (titolo originale),
// infine su Apple Books Francia e USA (titolo originale).
// Per un libro trovato male si può aggiungere nel JSON `"coverSearch": "termini di ricerca"` (vale per Apple Books).

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeText } from '../src/lib/aggregate';
import type { CuratedEntry, CuratedList } from '../src/lib/types';
import { biggerArtwork } from './adapters/apple';
import { fetchJson } from './lib/http';
import { nameMatch, overlap, stripParens, tokens } from './lib/match';

const LISTS = ['libri-da-avere', 'libri-le-monde'].map((id) => path.resolve(`data/curated/${id}.json`));
const force = process.argv.includes('--force');
const CACHE = { retries: 2, cacheTtlMs: 7 * 86_400_000 };

/** Riassunti, guide allo studio e simili: mai la copertina dell'opera. */
const JUNK = /riassunt|sintesi|analisi|guida (allo studio|alla lettura)|study guide|summary|sparknotes|quiz|commento a|cliffsnotes|workbook|coloring|da colorare/i;

const authorless = (e: CuratedEntry) => /autori vari/i.test(e.creator);

function score(e: CuratedEntry, title: string, author: string, wantTitle: string): number {
  if (JUNK.test(title)) return 0;
  const a = authorless(e) ? 1 : Math.max(nameMatch(e.creator, author), e.searchAuthor ? nameMatch(e.searchAuthor, author) : 0);
  if (a < 0.5) return 0;
  const want = stripParens(wantTitle);
  const t = overlap(want, title);
  const exact = normalizeText(stripParens(title)) === normalizeText(want) ? 0.3 : 0;
  const extra = Math.max(0, tokens(title).size - tokens(want).size) * 0.03;
  return a + t * 1.5 + exact - extra;
}

interface AppleBook {
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

async function appleBooks(e: CuratedEntry, country = 'it') {
  // Fuori dall'Italia si cerca con il titolo originale.
  const want = country === 'it' ? (e.coverSearch ?? stripParens(e.title)) : stripParens(e.original ?? e.title);
  const surname = authorless(e) ? '' : ` ${e.creator.split(' ').at(-1)}`;
  const { results } = await fetchJson<{ results: AppleBook[] }>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(want + surname)}&country=${country}&media=ebook&entity=ebook&limit=25`,
    CACHE,
  );
  let best: { hit: AppleBook; score: number } | null = null;
  for (const hit of results) {
    const s = score(e, hit.trackName ?? '', hit.artistName ?? '', want);
    if (!best || s > best.score) best = { hit, score: s };
  }
  if (!best || best.score < 2.2) return null;
  return {
    cover: biggerArtwork(best.hit.artworkUrl100, 400),
    url: best.hit.trackViewUrl?.replace(/[?&]uo=\d+/, '') ?? null,
    label: `Apple Books: ${best.hit.artistName} – ${best.hit.trackName} (${best.score.toFixed(2)})`,
  };
}

interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  cover_i?: number;
  edition_count?: number;
}

async function openLibrary(e: CuratedEntry) {
  const want = stripParens(e.original ?? e.title);
  const author = authorless(e) ? '' : `&author=${encodeURIComponent(e.searchAuthor ?? e.creator)}`;
  const { docs } = await fetchJson<{ docs: OpenLibraryDoc[] }>(
    `https://openlibrary.org/search.json?title=${encodeURIComponent(want)}${author}&fields=key,title,author_name,cover_i,edition_count&limit=10`,
    CACHE,
  );
  // Tra le opere che corrispondono, quella con più edizioni (di solito l'opera principale, non un'antologia).
  const hit = docs
    .filter((d) => d.cover_i && score(e, d.title, d.author_name?.join(', ') ?? '', want) >= 2.2)
    .sort((x, y) => (y.edition_count ?? 0) - (x.edition_count ?? 0))[0];
  if (!hit) return null;
  return {
    cover: `https://covers.openlibrary.org/b/id/${hit.cover_i}-M.jpg`,
    url: `https://openlibrary.org${hit.key}`,
    label: `Open Library: ${hit.author_name?.[0]} – ${hit.title}`,
  };
}


const key = (e: CuratedEntry) => `${normalizeText(e.creator)}|${normalizeText(e.title)}`;

async function main() {
  const lists = await Promise.all(LISTS.map(async (file) => ({ file, list: JSON.parse(await readFile(file, 'utf8')) as CuratedList })));
  // Copertine già trovate in una delle liste: un libro presente in entrambe usa la stessa.
  const known = new Map<string, CuratedEntry>();
  for (const { list } of lists) for (const e of list.entries) if (e.cover && !force) known.set(key(e), e);

  for (const { file, list } of lists) {
    const missing: string[] = [];
    console.log(`\n== ${list.title}`);
    for (const e of list.entries) {
      if (e.cover !== undefined && !force) continue;
      const same = known.get(key(e));
      const found = same?.cover
        ? { cover: same.cover, url: same.url ?? null, label: "stessa copertina dell'altra lista" }
        : ((e.coverCountry ? await appleBooks(e, e.coverCountry) : null) ??
          (await appleBooks(e)) ??
          (await openLibrary(e)) ??
          (await appleBooks(e, 'fr')) ??
          (await appleBooks(e, 'us')));
      if (found) {
        e.cover = found.cover;
        e.url = found.url;
        known.set(key(e), e);
        console.log(`${e.rank}. ${e.creator} – ${e.title}  →  ${found.label}`);
      } else {
        e.cover = null;
        missing.push(`${e.rank}. ${e.creator} – ${e.title}`);
      }
    }
    await writeFile(file, JSON.stringify(list, null, 2) + '\n');
    if (missing.length) console.log(`\nSenza copertina (${missing.length}):\n${missing.join('\n')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
