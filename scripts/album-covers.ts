// Completa le copertine delle liste di album (Rolling Stone e Consequence) con l'API di ricerca iTunes.
// Da lanciare a mano (la lista è statica): `npm run covers:album` (aggiungi `-- --force` per rifarle tutte).
// Se iTunes non ha l'album, prova Cover Art Archive (MusicBrainz).
// Per un album trovato male si può aggiungere nel JSON `"coverSearch": "termini di ricerca"`.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeText } from '../src/lib/aggregate';
import type { CuratedEntry, CuratedList } from '../src/lib/types';
import { biggerArtwork } from './adapters/apple';
import { fetchJson, USER_AGENT } from './lib/http';
import { curatedKey as entryKey, nameMatch, overlap, tokens } from './lib/match';

const LISTS = ['album-da-avere', 'album-consequence'].map((id) => path.resolve(`data/curated/${id}.json`));
const force = process.argv.includes('--force');

interface ItunesAlbum {
  collectionName?: string;
  artistName?: string;
  artworkUrl100?: string;
  collectionViewUrl?: string;
}

const JUNK = /karaoke|tribute|cover|made famous|in the style of|lullaby|instrumental versions?|outtakes|acoustic|demos/i;

function scoreAlbum(entry: { creator: string; title: string }, hit: ItunesAlbum): number {
  if (!hit.collectionName || !hit.artistName || JUNK.test(hit.collectionName) || JUNK.test(hit.artistName)) return 0;
  const artist = entry.creator.replace(/\(.*?\)/g, '');
  const title = entry.title.replace(/\(.*?\)/g, '');
  const a = nameMatch(artist, hit.artistName);
  if (a < 0.5) return 0;
  const t = overlap(title, hit.collectionName);
  if (/ - (single|ep)$/i.test(hit.collectionName)) return 0;
  // Bonus per titolo identico, piccola penalità per edizioni con molte parole in più.
  const exact = normalizeText(hit.collectionName.replace(/\(.*?\)|\[.*?\]/g, '')) === normalizeText(title) ? 0.3 : 0;
  const extra = Math.max(0, tokens(hit.collectionName).size - tokens(title).size) * 0.02;
  return a * 1 + t * 1.5 + exact - extra;
}

const searchUrl = (params: string) => `https://itunes.apple.com/${params}&media=music`;
const get = <T>(params: string) => fetchJson<{ results: T[] }>(searchUrl(params), { retries: 2, cacheTtlMs: 7 * 86_400_000 });

/** Discografia completa dell'artista: più affidabile della ricerca testuale per i classici. */
async function artistAlbums(artist: string, country: string): Promise<ItunesAlbum[]> {
  const name = artist.replace(/\(.*?\)/g, '');
  const { results } = await get<{ artistId?: number; artistName?: string }>(
    `search?term=${encodeURIComponent(name)}&country=${country}&entity=musicArtist&limit=5`,
  );
  const match = results.find((r) => r.artistName && normalizeText(r.artistName) === normalizeText(name)) ?? results[0];
  if (!match?.artistId) return [];
  const albums = await get<ItunesAlbum & { wrapperType?: string }>(`lookup?id=${match.artistId}&country=${country}&entity=album&limit=200`);
  return albums.results.filter((r) => r.wrapperType === 'collection');
}

async function textSearch(term: string, country: string): Promise<ItunesAlbum[]> {
  return (await get<ItunesAlbum>(`search?term=${encodeURIComponent(term)}&country=${country}&entity=album&limit=25`)).results;
}

interface MbReleaseGroup {
  id: string;
  title: string;
  score: number;
  'artist-credit'?: { name: string }[];
}

/** Riserva: copertina da Cover Art Archive, cercando il release group su MusicBrainz. */
async function coverArtArchive(e: { creator: string; title: string }): Promise<{ cover: string; mbid: string } | null> {
  const artist = ` AND artist:"${e.creator.replace(/\(.*?\)/g, '').trim()}"`;
  // Titolo completo, poi la parte prima dei due punti ("The Anthology: 1947-1972" → "The Anthology").
  const full = e.title.replace(/\(.*?\)/g, '').trim();
  for (const title of new Set([full, full.split(':')[0]!.trim()])) {
    const res = await fetchJson<{ 'release-groups': MbReleaseGroup[] }>(
      `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(`releasegroup:"${title}"${artist}`)}&fmt=json&limit=5`,
      { retries: 4, cacheTtlMs: 30 * 86_400_000 },
    );
    for (const rg of res['release-groups'].filter((r) => r.score >= 85 && normalizeText(r.title).startsWith(normalizeText(title)))) {
      const cover = `https://coverartarchive.org/release-group/${rg.id}/front-250`;
      const head = await fetch(cover, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': USER_AGENT } });
      if (head.status >= 300 && head.status < 400) return { cover, mbid: rg.id };
    }
  }
  return null;
}

async function findCover(e: CuratedEntry): Promise<{ cover: string | null; url: string | null; label: string } | null> {
  const term = e.coverSearch ?? `${e.creator.replace(/\(.*?\)/g, '')} ${e.title.replace(/\(.*?\)/g, '')}`;
  let best: { hit: ItunesAlbum; score: number } | null = null;
  const attempts = [
    ...(e.coverSearch ? [] : ['it', 'us'].map((c) => () => artistAlbums(e.creator, c))),
    ...['it', 'us'].map((c) => () => textSearch(term, c)),
  ];
  for (const attempt of attempts) {
    for (const hit of await attempt()) {
      const score = scoreAlbum(e, hit);
      if (!best || score > best.score) best = { hit, score };
    }
    if (best && best.score >= 2.2) break;
  }
  if (best && best.score >= 1.6) {
    return {
      cover: biggerArtwork(best.hit.artworkUrl100, 400),
      url: best.hit.collectionViewUrl?.replace(/[?&]uo=\d+/, '') ?? null,
      label: `${best.hit.artistName} – ${best.hit.collectionName} (${best.score.toFixed(2)})`,
    };
  }
  const caa = e.coverSearch ? null : await coverArtArchive(e);
  return caa ? { cover: caa.cover, url: null, label: `Cover Art Archive ${caa.mbid}` } : null;
}

async function main() {
  const lists = await Promise.all(LISTS.map(async (file) => ({ file, list: JSON.parse(await readFile(file, 'utf8')) as CuratedList })));
  // Copertine già trovate in una delle liste: un album presente in entrambe usa la stessa.
  const known = new Map<string, CuratedEntry>();
  for (const { list } of lists) for (const e of list.entries) if (e.cover && !force) known.set(entryKey(e), e);

  for (const { file, list } of lists) {
    const missing: string[] = [];
    console.log(`\n== ${list.title}`);
    for (const e of list.entries) {
      if (e.cover !== undefined && !force) continue;
      const same = known.get(entryKey(e));
      const found = same?.cover ? { cover: same.cover, url: same.url ?? null, label: "stessa copertina dell'altra lista" } : await findCover(e);
      if (found) {
        e.cover = found.cover;
        e.url = found.url;
        known.set(entryKey(e), e);
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
