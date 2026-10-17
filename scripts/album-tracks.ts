// Completa le tracklist delle liste di album (Rolling Stone e Consequence).
// Da lanciare a mano dopo `covers:album`: `npm run tracks:album` (aggiungi `-- --force` per rifarle tutte).
// Album su Apple Music: brani dall'API lookup di iTunes, con il link diretto a ogni brano. Se l'album abbinato
// è un'edizione deluxe/espansa, cerca nella discografia dell'artista l'edizione standard (tracklist originale).
// Album non presenti su Apple Music: tracklist da MusicBrainz, senza link.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeText } from '../src/lib/aggregate';
import type { CuratedEntry, CuratedList, CuratedTrack } from '../src/lib/types';
import { fetchJson } from './lib/http';
import { curatedKey, stripParens } from './lib/match';

const LISTS = ['album-da-avere', 'album-consequence'].map((id) => path.resolve(`data/curated/${id}.json`));
const force = process.argv.includes('--force');
const CACHE = { retries: 2, cacheTtlMs: 30 * 86_400_000 };

/** Edizioni con tracce bonus: meglio la tracklist dell'edizione standard. */
const EXPANDED = /deluxe|expanded|anniversary|legacy|edition|bonus|collector|super|box set|\[.*mix\]/i;
const BONUS = /bonus track|alternate take|outtake|demo version|\(demo\)|rehearsal/i;

interface ItunesItem {
  wrapperType?: string;
  kind?: string;
  artistId?: number;
  collectionId?: number;
  collectionName?: string;
  trackCount?: number;
  discCount?: number;
  discNumber?: number;
  trackNumber?: number;
  trackName?: string;
  trackTimeMillis?: number;
  trackViewUrl?: string;
}

const itunes = (params: string) => fetchJson<{ results: ItunesItem[] }>(`https://itunes.apple.com/lookup?${params}`, CACHE).then((r) => r.results);
const cleanUrl = (url?: string) => url?.replace(/[?&]uo=\d+/, '');
const baseTitle = (s: string) => normalizeText(stripParens(s));

async function appleTracks(url: string): Promise<{ tracks: CuratedTrack[]; label: string } | null> {
  const id = url.match(/\/(\d+)(?:\?|$)/)?.[1];
  if (!id) return null;
  let items = await itunes(`id=${id}&entity=song&country=it&limit=200`);
  let album = items.find((i) => i.wrapperType === 'collection');
  if (!album) return null;

  if (EXPANDED.test(album.collectionName ?? '') && album.artistId) {
    const discography = await itunes(`id=${album.artistId}&entity=album&country=it&limit=200`);
    const standard = discography
      .filter(
        (a) =>
          a.wrapperType === 'collection' &&
          a.collectionId !== album!.collectionId &&
          baseTitle(a.collectionName ?? '') === baseTitle(album!.collectionName ?? '') &&
          !EXPANDED.test(a.collectionName ?? '') &&
          (a.trackCount ?? 0) >= 4,
      )
      .sort((a, b) => (a.trackCount ?? 0) - (b.trackCount ?? 0))[0];
    if (standard?.collectionId) {
      const alt = await itunes(`id=${standard.collectionId}&entity=song&country=it&limit=200`);
      if (alt.some((i) => i.wrapperType === 'track')) {
        items = alt;
        album = standard;
      }
    }
  }

  // Se resta un'edizione espansa, almeno le tracce bonus dichiarate nel titolo si possono togliere.
  const expanded = EXPANDED.test(album.collectionName ?? '');
  const songs = items.filter((i) => i.wrapperType === 'track' && i.kind === 'song' && !(expanded && BONUS.test(i.trackName ?? '')));
  if (!songs.length) return null;
  const multiDisc = new Set(songs.map((s) => s.discNumber)).size > 1;
  const tracks = songs
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
    .map((s) => ({
      ...(multiDisc ? { disc: s.discNumber ?? 1 } : {}),
      n: s.trackNumber ?? 0,
      title: s.trackName ?? '',
      ...(s.trackTimeMillis ? { ms: s.trackTimeMillis } : {}),
      ...(s.trackViewUrl ? { url: cleanUrl(s.trackViewUrl) } : {}),
    }));
  return { tracks, label: `Apple Music: ${album.collectionName} (${tracks.length} brani)` };
}

interface MbRelease {
  id: string;
  date?: string;
  status?: string;
  media?: { position: number; tracks?: { position: number; title: string; length?: number | null }[] }[];
}

const mb = <T>(q: string) => fetchJson<T>(`https://musicbrainz.org/ws/2/${q}${q.includes('?') ? '&' : '?'}fmt=json`, { retries: 4, cacheTtlMs: 30 * 86_400_000 });

async function musicBrainzTracks(e: CuratedEntry): Promise<{ tracks: CuratedTrack[]; label: string } | null> {
  // Il release group è già noto se la copertina viene da Cover Art Archive.
  let rgid = e.cover?.match(/release-group\/([0-9a-f-]{36})/)?.[1];
  if (!rgid) {
    const query = `releasegroup:"${stripParens(e.title)}" AND artist:"${stripParens(e.creator)}"`;
    const res = await mb<{ 'release-groups': { id: string; title: string; score: number }[] }>(`release-group/?query=${encodeURIComponent(query)}&limit=5`);
    rgid = res['release-groups'].find((r) => r.score >= 85 && baseTitle(r.title) === baseTitle(e.title))?.id;
  }
  if (!rgid) return null;
  const { releases } = await mb<{ releases: MbRelease[] }>(`release?release-group=${rgid}&inc=recordings&limit=50`);
  // La prima edizione ufficiale con la tracklist completa.
  const release = releases
    .filter((r) => r.status === 'Official' && r.media?.some((m) => m.tracks?.length))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))[0];
  if (!release?.media) return null;
  const multiDisc = release.media.length > 1;
  const tracks = release.media.flatMap((m) =>
    (m.tracks ?? []).map((t) => ({
      ...(multiDisc ? { disc: m.position } : {}),
      n: t.position,
      title: t.title,
      ...(t.length ? { ms: t.length } : {}),
    })),
  );
  return { tracks, label: `MusicBrainz ${release.id} (${release.date ?? 's.d.'}, ${tracks.length} brani)` };
}

async function main() {
  const lists = await Promise.all(LISTS.map(async (file) => ({ file, list: JSON.parse(await readFile(file, 'utf8')) as CuratedList })));
  // Un album presente in entrambe le liste usa la stessa tracklist.
  const known = new Map<string, CuratedTrack[]>();
  for (const { list } of lists) for (const e of list.entries) if (e.tracks?.length && !force) known.set(curatedKey(e), e.tracks);

  for (const { file, list } of lists) {
    const missing: string[] = [];
    console.log(`\n== ${list.title}`);
    for (const e of list.entries) {
      if (e.tracks !== undefined && !force) continue;
      const same = known.get(curatedKey(e));
      const found = same
        ? { tracks: same, label: "stessa tracklist dell'altra lista" }
        : ((e.url ? await appleTracks(e.url) : null) ?? (await musicBrainzTracks(e)));
      if (found) {
        e.tracks = found.tracks;
        known.set(curatedKey(e), found.tracks);
        console.log(`${e.rank}. ${e.creator} – ${e.title}  →  ${found.label}`);
      } else {
        missing.push(`${e.rank}. ${e.creator} – ${e.title}`);
      }
    }
    await writeFile(file, JSON.stringify(list, null, 2) + '\n');
    if (missing.length) console.log(`\nSenza tracklist (${missing.length}):\n${missing.join('\n')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
