// Podcast seguiti su Spotify, dall'esportazione dei dati personali (spotify.com → Account → Privacy dell'account → "Scarica i tuoi
// dati", pacchetto "Dati dell'account": arriva per email in pochi giorni), convertiti nel file di spunte che la pagina /account/ sa
// importare ("Importa da file"), destinato a un solo account, come scripts/anobii-import.ts.
// L'API web di Spotify non si può usare: da febbraio 2026 le app in Development Mode funzionano solo se il proprietario ha Premium.
//
//   Podcast seguiti (lista "podcast-seguiti"): chiave podcastKey del titolo, più l'URI Spotify ("spotify:show:…") come alias.
//
// Scrive anche il catalogo dei podcast (privato/podcast-seguiti.json: titolo, editore, copertina, link), pubblicato con il sito
// nella pagina "I miei podcast" (src/pages/podcast/catalogo.json.ts). Copertine: quelle della classifica Spotify negli snapshot,
// altrimenti Apple Podcasts (ricerca per titolo); quelle già trovate si riusano.
//
//   npm run import:spotify -- --account email@esempio.it [--file privato/…/YourLibrary.json] [--copertine]

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { podcastKey } from '../src/lib/aggregate';
import type { FollowedPodcastCatalog } from '../src/lib/types';
import { biggerArtwork } from './adapters/apple';
import { spotifyShowUrl } from './adapters/spotify';
import { loadEnv } from './lib/env';
import { fetchJson } from './lib/http';
import { overlap } from './lib/match';
import { readSnapshots } from './lib/store';

const OUT_DIR = path.resolve('privato');
const CATALOG = path.join(OUT_DIR, 'podcast-seguiti.json');
const LIBRARY = 'yourlibrary.json';
const CACHE = { retries: 1, cacheTtlMs: 90 * 86_400_000 };

type Podcast = FollowedPodcastCatalog['podcasts'][number];

/** Un podcast seguito in YourLibrary.json. */
export interface LibraryShow {
  name?: string;
  publisher?: string;
  uri?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Podcast seguiti dell'esportazione (campo "shows" di YourLibrary.json), senza righe vuote né doppioni. */
export function libraryShows(json: unknown): { name: string; publisher: string | null; uri: string | null }[] {
  const shows = (json as { shows?: LibraryShow[] } | null)?.shows;
  if (!Array.isArray(shows)) throw new Error('Il file non contiene i podcast seguiti (manca "shows"): serve YourLibrary.json di Spotify.');
  const seen = new Set<string>();
  return shows
    .filter((s) => s.name?.trim())
    .map((s) => ({ name: s.name!.trim(), publisher: s.publisher?.trim() || null, uri: s.uri?.startsWith('spotify:show:') ? s.uri : null }))
    .filter((s) => {
      const id = s.uri ?? podcastKey(s.name);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

/** YourLibrary.json più recente in privato/ (anche nelle sottocartelle, es. "Spotify Account Data" dello zip estratto). */
async function latestLibrary(dir = OUT_DIR): Promise<string | null> {
  let newest: { f: string; t: number } | null = null;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const f = path.join(dir, entry.name);
    const found = entry.isDirectory() ? await latestLibrary(f) : entry.name.toLowerCase() === LIBRARY ? f : null;
    if (!found) continue;
    const t = (await stat(found)).mtimeMs;
    if (!newest || t > newest.t) newest = { f: found, t };
  }
  return newest?.f ?? null;
}

interface ApplePodcast {
  collectionName?: string;
  artistName?: string;
  artworkUrl600?: string;
  collectionViewUrl?: string;
}

async function appleCover(name: string): Promise<string | null> {
  try {
    const { results } = await fetchJson<{ results: ApplePodcast[] }>(
      `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&country=it&media=podcast&entity=podcast&limit=5`,
      CACHE,
    );
    const hit = results.find((r) => overlap(name, r.collectionName ?? '') >= 0.8 && overlap(r.collectionName ?? '', name) >= 0.5);
    return biggerArtwork(hit?.artworkUrl600, 400);
  } catch {
    return null;
  }
}

export async function importSpotify(file: string, account: string, opts: { covers?: boolean; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const shows = libraryShows(JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')));
  log(`Spotify: ${shows.length} podcast seguiti da ${path.relative(process.cwd(), file)}`);

  // Copertine: le importazioni precedenti, poi la classifica Spotify (URI) degli snapshot.
  const previous = new Map<string, string | null>();
  try {
    const old = JSON.parse(await readFile(CATALOG, 'utf8')) as FollowedPodcastCatalog;
    for (const p of old.podcasts) previous.set(p.keys.at(-1)!, p.cover);
  } catch {
    // Prima importazione.
  }
  const charted = new Map<string, string>();
  for (const snap of await readSnapshots('podcast'))
    for (const e of snap.sources['spotify-podcasts']?.entries ?? []) if (e.externalId && e.cover) charted.set(e.externalId, e.cover);

  const podcasts: Podcast[] = [];
  const keys = new Set<string>();
  let found = 0;
  for (const [i, s] of shows.entries()) {
    const id = s.uri ?? podcastKey(s.name);
    let cover = opts.covers ? undefined : previous.get(id);
    if (cover == null) cover = (s.uri && charted.get(s.uri)) || (await appleCover(s.name));
    if (cover) found++;
    if ((i + 1) % 25 === 0) log(`  copertine: ${i + 1}/${shows.length}`);
    // L'URI per ultimo: identifica il podcast tra un'importazione e l'altra.
    const k = [...new Set([podcastKey(s.name), ...(s.uri ? [s.uri] : [])])];
    for (const key of k) keys.add(key);
    podcasts.push({ title: s.name, publisher: s.publisher, cover, url: s.uri ? spotifyShowUrl(s.uri) : null, keys: k });
  }

  const day = new Date().toISOString().slice(0, 10);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(CATALOG, JSON.stringify({ date: day, podcasts } satisfies FollowedPodcastCatalog));
  const ticks = path.join(OUT_DIR, `spunte-spotify-${day}.json`);
  const data = { sito: 'Classifiche Italia', versione: 1, data: day, origine: 'spotify', account, liste: { 'podcast-seguiti': [...keys] } };
  await writeFile(ticks, JSON.stringify(data, null, 2));

  log(`\nPodcast seguiti: ${podcasts.length} (${keys.size} chiavi), con copertina ${found}.`);
  log(`Catalogo dei podcast (pubblicato con il sito): ${CATALOG}`);
  log(`\nFile: ${ticks}\nImportalo da /account/ ("Importa da file") dopo essere entrato come ${account}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  loadEnv();
  const account = arg('account') ?? process.env.SPOTIFY_ACCOUNT ?? process.env.TRAKT_ACCOUNT ?? '';
  if (!account) {
    console.error("Serve l'account a cui sono destinate le spunte: --account email@esempio.it (o SPOTIFY_ACCOUNT in .env).");
    process.exit(1);
  }
  Promise.resolve(arg('file') ?? latestLibrary())
    .then((file) => {
      if (!file)
        throw new Error(
          `Nessun YourLibrary.json in ${OUT_DIR}: scarica i dati dell'account da Spotify (Account → Privacy dell'account), estrai lo zip lì e riprova.`,
        );
      return importSpotify(file, account.toLowerCase(), { covers: process.argv.includes('--copertine') });
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
