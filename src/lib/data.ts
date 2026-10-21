// Accesso ai JSON generati, a build time.

import { CURATED_IDS, type ArtistInfo, type AuthorInfo, type BookInfo, type FreeEdition, type CategoryId, type MovieRatings, type MovieRatingsFile, type CuratedId, type CuratedList, type DirectorInfo, type MovieInfo, type PeriodChart, type PeriodId, type PodcastInfo, type SeriesInfo, type CreatorInfo, type SongInfo, type SourceStatus } from './types';

const charts = import.meta.glob<PeriodChart>('/data/charts/*/*.json', { eager: true, import: 'default' });
const curated = import.meta.glob<CuratedList>('/data/curated/*.json', { eager: true, import: 'default' });
const songInfoFiles = import.meta.glob<Record<string, { value: SongInfo }>>('/data/cache/song-info.json', { eager: true, import: 'default' });
const artistInfoFiles = import.meta.glob<Record<string, { value: ArtistInfo }>>('/data/cache/artist-info.json', { eager: true, import: 'default' });
const bookInfoFiles = import.meta.glob<Record<string, { value: BookInfo }>>('/data/cache/book-info.json', { eager: true, import: 'default' });
const authorInfoFiles = import.meta.glob<Record<string, { value: AuthorInfo }>>('/data/cache/author-info.json', { eager: true, import: 'default' });
const freeBookFiles = import.meta.glob<Record<string, { value: FreeEdition }>>('/data/cache/free-books.json', { eager: true, import: 'default' });
const movieInfoFiles = import.meta.glob<Record<string, { value: MovieInfo }>>('/data/cache/movie-info.json', { eager: true, import: 'default' });
const directorInfoFiles = import.meta.glob<Record<string, { value: DirectorInfo }>>('/data/cache/director-info.json', { eager: true, import: 'default' });
const seriesInfoFiles = import.meta.glob<Record<string, { value: SeriesInfo }>>('/data/cache/series-info.json', { eager: true, import: 'default' });
const creatorInfoFiles = import.meta.glob<Record<string, { value: CreatorInfo }>>('/data/cache/creator-info.json', { eager: true, import: 'default' });
const podcastInfoFiles = import.meta.glob<Record<string, { value: PodcastInfo }>>('/data/cache/podcast-info.json', { eager: true, import: 'default' });
// Voti IMDb e Rotten Tomatoes (scripts/movie-ratings.ts): film delle classifiche e, fuori da git, del catalogo privato.
const ratingFiles = import.meta.glob<MovieRatingsFile>(['/data/cache/movie-ratings.json', '/privato/film-voti.json'], { eager: true, import: 'default' });
const statusFiles = import.meta.glob<SourceStatus[]>('/data/status.json', { eager: true, import: 'default' });

export function getChart(category: CategoryId, period: PeriodId): PeriodChart | null {
  return charts[`/data/charts/${category}/${period}.json`] ?? null;
}

/** Scheda di un brano (chiave: entryKey), se già raccolta da scripts/song-info.ts. */
export function getSongInfo(key: string): SongInfo | null {
  return Object.values(songInfoFiles)[0]?.[key]?.value ?? null;
}

/** Scheda di un artista (chiave: artistKey), se già raccolta da scripts/artist-info.ts. */
export function getArtistInfo(key: string): ArtistInfo | null {
  return Object.values(artistInfoFiles)[0]?.[key]?.value ?? null;
}

/** Scheda di un libro (chiave: entryKey), se già raccolta da scripts/book-info.ts. */
export function getBookInfo(key: string): BookInfo | null {
  return Object.values(bookInfoFiles)[0]?.[key]?.value ?? null;
}

/** Scheda di un podcast (chiave: podcastKey), se già raccolta da scripts/podcast-info.ts. */
export function getPodcastInfo(key: string): PodcastInfo | null {
  return Object.values(podcastInfoFiles)[0]?.[key]?.value ?? null;
}

/** Scheda di un autore (chiave: artistKey), se già raccolta da scripts/author-info.ts. */
export function getAuthorInfo(key: string): AuthorInfo | null {
  return Object.values(authorInfoFiles)[0]?.[key]?.value ?? null;
}

/** Edizioni gratuite di un libro di pubblico dominio (chiave come getBookInfo), da scripts/free-books.ts. */
export function getFreeEdition(key: string): FreeEdition | null {
  return Object.values(freeBookFiles)[0]?.[key]?.value ?? null;
}

/** Scheda di un film (chiave: entryKey), se già raccolta da scripts/movie-info.ts. */
export function getMovieInfo(key: string): MovieInfo | null {
  return Object.values(movieInfoFiles)[0]?.[key]?.value ?? null;
}

/** Voti IMDb e Rotten Tomatoes di un film (chiave: ID TMDB), se già raccolti. */
export function getMovieRatings(tmdbId: number | null | undefined): MovieRatings | null {
  if (!tmdbId) return null;
  for (const f of Object.values(ratingFiles)) if (f.films[tmdbId]) return f.films[tmdbId];
  return null;
}

/** Tutte le schede dei film in cache, con la chiave (anche di film non più in classifica, finché non scadono). */
export function allMovieInfo(): [string, MovieInfo][] {
  return Object.entries(Object.values(movieInfoFiles)[0] ?? {}).map(([key, e]) => [key, e.value]);
}

/** Tutte le schede delle serie in cache, con la chiave (anche di serie non più in classifica, finché non scadono). */
export function allSeriesInfo(): [string, SeriesInfo][] {
  return Object.entries(Object.values(seriesInfoFiles)[0] ?? {}).map(([key, e]) => [key, e.value]);
}

/** Scheda di un regista (chiave: artistKey), se già raccolta da scripts/director-info.ts. */
export function getDirectorInfo(key: string): DirectorInfo | null {
  return Object.values(directorInfoFiles)[0]?.[key]?.value ?? null;
}

/** Scheda di una serie (chiave: entryKey), se già raccolta da scripts/series-info.ts. */
export function getSeriesInfo(key: string): SeriesInfo | null {
  return Object.values(seriesInfoFiles)[0]?.[key]?.value ?? null;
}

/** Scheda di un creatore di serie (chiave: artistKey), se già raccolta da scripts/creator-info.ts. */
export function getCreatorInfo(key: string): CreatorInfo | null {
  return Object.values(creatorInfoFiles)[0]?.[key]?.value ?? null;
}

/**
 * Chiave della spunta "Vista" di una serie: l'ID TMDB, così la spunta vale per tutte le stagioni della Top 10 Netflix e per
 * le classifiche TMDB; senza ID, la chiave della riga.
 */
export function seriesSeenKey(e: { key: string; externalId: string | null }): string {
  const id = getSeriesInfo(e.key)?.tmdbId ?? e.externalId?.match(/^tmdb:tv:(\d+)$/)?.[1];
  return id ? `tv:${id}` : e.key;
}

export function getStatus(): SourceStatus[] {
  return Object.values(statusFiles)[0] ?? [];
}

export function getCuratedList(id: CuratedId): CuratedList {
  const list = curated[`/data/curated/${id}.json`];
  if (!list) throw new Error(`Lista mancante: data/curated/${id}.json`);
  return list;
}

/** Le liste dello stesso gruppo, nell'ordine di CURATED_IDS. */
export function getCuratedGroup(group: CuratedId): CuratedList[] {
  return CURATED_IDS.map(getCuratedList).filter((l) => l.group === group);
}

/** Percorso interno rispettando il `base` configurato (es. GitHub Pages). */
export function href(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const p = path.replace(/^\//, '');
  const isFile = /\.[a-z0-9]+$/i.test(p);
  return `${base}/${p}${p && !isFile && !p.endsWith('/') ? '/' : ''}`;
}

const dayFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Rome' });

/** "2026-10-11" → "11 ottobre 2026" */
export function formatDay(day: string | null | undefined): string {
  if (!day) return '—';
  if (/^\d{4}$/.test(day)) return day;
  return dayFmt.format(new Date(`${day}T00:00:00Z`));
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : '—';
}
