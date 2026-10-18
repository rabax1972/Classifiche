// Libri della propria libreria aNobii (https://www.anobii.com), dall'esportazione CSV del profilo, convertiti nel file di
// spunte che la pagina /account/ sa importare ("Importa da file"), destinato a un solo account, come scripts/trakt-import.ts.
// aNobii non ha un'API pubblica e il suo robots.txt esclude i bot: si usa solo il file esportato dall'utente.
//
//   Libri letti (lista "letti", chiave entryKey di titolo e primo autore, più qualche variante del titolo): quelli
//   "Finito" e quelli senza stato di lettura; "In lettura" e "Abbandonato" solo con --tutti.
//
// Scrive anche il catalogo dei libri (privato/libri-letti.json: titolo, autore, copertina, anno, pagine, editore, data di
// fine lettura e voto), pubblicato con il sito nella pagina "I miei libri letti" (src/pages/libri/catalogo.json.ts).
// Copertine: Open Library per ISBN, altrimenti Apple Books (ricerca per titolo e autore); quelle già trovate si riusano.
//
//   npm run import:anobii -- --account email@esempio.it [--file privato/export.csv] [--tutti] [--copertine]

import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { entryKey } from '../src/lib/aggregate';
import type { ReadBookCatalog } from '../src/lib/types';
import { biggerArtwork } from './adapters/apple';
import { loadEnv } from './lib/env';
import { fetchJson } from './lib/http';
import { nameMatch, overlap, stripParens } from './lib/match';

const OUT_DIR = path.resolve('privato');
const CATALOG = path.join(OUT_DIR, 'libri-letti.json');
const CACHE = { retries: 1, cacheTtlMs: 90 * 86_400_000 };

type Book = ReadBookCatalog['books'][number];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Righe del CSV di aNobii. L'esportazione mescola le codifiche: il testo dei campi è in UTF-16LE, mentre virgole, virgolette
 * e a capo sono byte singoli. Un byte di separazione si riconosce perché non è seguito da 0 (come lo sarebbe un carattere
 * latino in UTF-16LE). I file in UTF-8 o in UTF-16 "puliti" (es. salvati di nuovo da un foglio di calcolo) si leggono a parte.
 */
export function parseAnobiiCsv(buf: Buffer): string[][] {
  const mixed = buf[1] === 0x00 && buf.indexOf(Buffer.from([0x2c])) > 0 && buf[buf.indexOf(0x2c) + 1] !== 0x00;
  if (!mixed) {
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le').slice(1) : buf.toString('utf8').replace(/^﻿/, '');
    return parseCsvText(text);
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field: number[] = [];
  let quoted = false;
  const flush = () => {
    row.push(Buffer.from(field).toString('utf16le'));
    field = [];
  };
  for (let p = 0; p < buf.length; ) {
    const b0 = buf[p]!;
    const b1 = buf[p + 1];
    const single = b1 !== 0x00; // anche a fine file (b1 undefined)
    if (quoted) {
      if (b0 === 0x22 && single) {
        quoted = false;
        p++;
      } else {
        field.push(b0, b1 ?? 0);
        p += 2;
      }
    } else if (b0 === 0x22 && single && !field.length) {
      quoted = true;
      p++;
    } else if (b0 === 0x2c && single) {
      flush();
      p++;
    } else if ((b0 === 0x0a || b0 === 0x0d) && single) {
      if (b0 === 0x0a) {
        flush();
        rows.push(row);
        row = [];
      }
      p++;
    } else if (b1 === undefined) {
      p++;
    } else {
      field.push(b0, b1);
      p += 2;
    }
  }
  if (field.length || row.length) {
    flush();
    rows.push(row);
  }
  return rows;
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}

/** Chiavi con cui il libro può comparire in classifica o nelle liste: titolo intero, senza parentesi, senza sottotitolo. */
export function bookKeys(title: string, subtitle: string, author: string): string[] {
  const titles = new Set([title, stripParens(title), `${title}: ${subtitle}`]);
  const short = title.split(/\s[-–:]\s|[:.]\s/)[0]!.trim();
  if (short.length >= 3) titles.add(short);
  return [...new Set([...titles].filter((t) => t && !t.endsWith(': ')).map((t) => entryKey({ title: t, subtitle: author || null })))];
}

/** Stato di lettura di aNobii: "Finito nel 2019-11-23", "In lettura dal …", "Abbandonato nel …" o vuoto. */
export function readingState(state: string): { read: boolean; finished: string | null } {
  const finished = state.match(/^Finito nel (\d{4}(?:-\d{2}(?:-\d{2})?)?)/)?.[1] ?? null;
  return { read: !/^(In lettura|Abbandonato)/i.test(state), finished };
}

interface AppleBook {
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
}

async function openLibraryCover(isbn: string): Promise<string | null> {
  try {
    const ed = await fetchJson<{ covers?: number[] }>(`https://openlibrary.org/isbn/${isbn}.json`, CACHE);
    const id = ed.covers?.find((c) => c > 0);
    return id ? `https://covers.openlibrary.org/b/id/${id}-M.jpg` : null;
  } catch {
    return null; // edizione sconosciuta
  }
}

async function appleCover(title: string, author: string): Promise<string | null> {
  const want = stripParens(title);
  const surname = author.split(',')[0]!.trim().split(' ').at(-1) ?? '';
  try {
    const { results } = await fetchJson<{ results: AppleBook[] }>(
      `https://itunes.apple.com/search?term=${encodeURIComponent(`${want} ${surname}`)}&country=it&media=ebook&entity=ebook&limit=10`,
      CACHE,
    );
    const hit = results.find((r) => nameMatch(author, r.artistName ?? '') >= 0.5 && overlap(want, r.trackName ?? '') >= 0.8);
    return biggerArtwork(hit?.artworkUrl100, 400);
  } catch {
    return null;
  }
}

async function latestCsv(): Promise<string> {
  const files = (await readdir(OUT_DIR)).filter((f) => f.toLowerCase().endsWith('.csv')).map((f) => path.join(OUT_DIR, f));
  const dated = await Promise.all(files.map(async (f) => ({ f, t: (await stat(f)).mtimeMs })));
  const newest = dated.sort((a, b) => b.t - a.t)[0];
  if (!newest) throw new Error(`Nessun file CSV in ${OUT_DIR}: esporta la libreria da aNobii e mettila lì.`);
  return newest.f;
}

export async function importAnobii(file: string, account: string, opts: { all?: boolean; covers?: boolean; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const [header, ...rows] = parseAnobiiCsv(await readFile(file));
  const col = (name: string) => header!.findIndex((h) => h.trim().toLowerCase() === name);
  const c = {
    isbn: col('isbn'),
    title: col('titolo'),
    subtitle: col('sottotitolo'),
    author: col('autore'),
    pages: col('numero di pagine'),
    publisher: col('editore'),
    published: col('data di pubblicazione'),
    state: col('stato di lettura'),
    rating: col('voto'),
  };
  if (c.title < 0 || c.author < 0) throw new Error(`${file}: non sembra un'esportazione di aNobii (mancano Titolo e Autore).`);
  log(`aNobii: ${rows.length} libri da ${path.basename(file)}`);

  // Copertine trovate nelle importazioni precedenti (per ISBN o titolo e autore).
  const previous = new Map<string, string | null>();
  try {
    const old = JSON.parse(await readFile(CATALOG, 'utf8')) as ReadBookCatalog;
    for (const b of old.books) previous.set(b.isbn ?? `${b.title}|${b.author}`, b.cover);
  } catch {
    // Prima importazione.
  }

  const books: Book[] = [];
  const keys = new Set<string>();
  const skipped: string[] = [];
  let found = 0;
  for (const [i, r] of rows.entries()) {
    const get = (n: number) => (n >= 0 ? (r[n] ?? '').trim() : '');
    const title = get(c.title);
    if (!title) continue;
    const author = get(c.author);
    const { read, finished } = readingState(get(c.state));
    if (!read && !opts.all) {
      skipped.push(`${title} (${get(c.state)})`);
      continue;
    }
    const isbn = get(c.isbn).replace(/[^0-9X]/gi, '') || null;
    const id = isbn ?? `${title}|${author}`;
    let cover = opts.covers ? undefined : previous.get(id);
    if (cover === undefined) {
      cover = (isbn ? await openLibraryCover(isbn) : null) ?? (await appleCover(title, author));
      if ((i + 1) % 25 === 0) log(`  copertine: ${i + 1}/${rows.length}`);
    }
    if (cover) found++;
    const bookKeys_ = bookKeys(title, get(c.subtitle), author);
    for (const k of bookKeys_) keys.add(k);
    books.push({
      title,
      author,
      cover,
      year: Number(get(c.published).slice(0, 4)) || null,
      pages: Number(get(c.pages)) || null,
      publisher: get(c.publisher) || null,
      finished,
      rating: Number(get(c.rating)) || null,
      keys: bookKeys_,
      isbn,
    });
  }

  const day = new Date().toISOString().slice(0, 10);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(CATALOG, JSON.stringify({ date: day, books } satisfies ReadBookCatalog));
  const ticks = path.join(OUT_DIR, `spunte-anobii-${day}.json`);
  const data = { sito: 'Classifiche Italia', versione: 1, data: day, origine: 'anobii', account, liste: { letti: [...keys] } };
  await writeFile(ticks, JSON.stringify(data, null, 2));

  log(`\nLibri letti: ${books.length} (${keys.size} chiavi), con copertina ${found}.`);
  if (skipped.length) log(`Non segnati come letti (${skipped.length}, usa --tutti per includerli): ${skipped.join('; ')}`);
  log(`Catalogo dei libri letti (pubblicato con il sito): ${CATALOG}`);
  log(`\nFile: ${ticks}\nImportalo da /account/ ("Importa da file") dopo essere entrato come ${account}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  loadEnv();
  const account = arg('account') ?? process.env.ANOBII_ACCOUNT ?? process.env.TRAKT_ACCOUNT ?? '';
  if (!account) {
    console.error("Serve l'account a cui sono destinate le spunte: --account email@esempio.it (o ANOBII_ACCOUNT in .env).");
    process.exit(1);
  }
  Promise.resolve(arg('file') ?? latestCsv())
    .then((file) => importAnobii(file, account.toLowerCase(), { all: process.argv.includes('--tutti'), covers: process.argv.includes('--copertine') }))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
