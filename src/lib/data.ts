// Accesso ai JSON generati, a build time.

import { CURATED_IDS, type ArtistInfo, type CategoryId, type CuratedId, type CuratedList, type PeriodChart, type PeriodId, type SongInfo, type SourceStatus } from './types';

const charts = import.meta.glob<PeriodChart>('/data/charts/*/*.json', { eager: true, import: 'default' });
const curated = import.meta.glob<CuratedList>('/data/curated/*.json', { eager: true, import: 'default' });
const songInfoFiles = import.meta.glob<Record<string, { value: SongInfo }>>('/data/cache/song-info.json', { eager: true, import: 'default' });
const artistInfoFiles = import.meta.glob<Record<string, { value: ArtistInfo }>>('/data/cache/artist-info.json', { eager: true, import: 'default' });
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
