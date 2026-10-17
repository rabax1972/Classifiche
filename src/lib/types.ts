// Schema dati condiviso tra script di ingestion, aggregazione e UI.

export const CATEGORY_IDS = ['canzoni', 'libri', 'cinema', 'film', 'serie-tv'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export const PERIOD_IDS = ['oggi', 'settimana', 'mese', 'anno'] as const;
export type PeriodId = (typeof PERIOD_IDS)[number];

/** Una riga di classifica, nel formato comune a tutte le fonti. */
export interface ChartEntry {
  rank: number;
  title: string;
  /** Artista, autore, regista… */
  subtitle: string | null;
  cover: string | null;
  source: string;
  sourceUrl: string | null;
  externalId: string | null;
}

/** Classifica raccolta da una singola fonte in un giorno. */
export interface SourceSnapshot {
  source: string;
  fetchedAt: string;
  entries: ChartEntry[];
}

/** File data/snapshots/{categoria}/{YYYY-MM-DD}.json */
export interface DailySnapshot {
  date: string;
  category: CategoryId;
  sources: Record<string, SourceSnapshot>;
}

export type OfficialPeriodType = 'week' | 'month' | 'year';

/** File data/official/{categoria}/{week|month|year}/{chiave}.json */
export interface OfficialChart {
  category: CategoryId;
  source: string;
  periodType: OfficialPeriodType;
  /** Settimana: data di fine (YYYY-MM-DD); anno: YYYY. */
  periodKey: string;
  periodLabel: string;
  url: string | null;
  fetchedAt: string;
  entries: ChartEntry[];
}

export type Change =
  | { kind: 'new' }
  | { kind: 'same' }
  | { kind: 'up'; by: number }
  | { kind: 'down'; by: number };

export interface RankedEntry extends ChartEntry {
  key: string;
  change: Change | null;
  /** Solo per classifiche calcolate da snapshot. */
  points?: number;
  daysInChart?: number;
  bestRank?: number;
}

/** official = classifica ufficiale della fonte; daily = ultimo snapshot; computed = Borda sugli snapshot. */
export type ViewKind = 'official' | 'daily' | 'computed';

export interface ChartView {
  kind: ViewKind;
  label: string;
  sources: string[];
  periodLabel: string;
  from: string;
  to: string;
  /** Giorni con dati / giorni del periodo (solo calcolate). */
  coverage?: { days: number; expected: number };
  note?: string;
  entries: RankedEntry[];
}

/** File data/charts/{categoria}/{periodo}.json, letto dalla UI. */
export interface PeriodChart {
  category: CategoryId;
  period: PeriodId;
  generatedAt: string;
  /** Data dell'ultimo snapshot valido della categoria. */
  lastSnapshot: string | null;
  /** true se l'ultimo snapshot non è di oggi (fonte non raggiungibile). */
  stale: boolean;
  views: ChartView[];
}

/** File data/status.json: esito dell'ultima ingestion per fonte. */
export interface SourceStatus {
  source: string;
  category: CategoryId;
  ok: boolean;
  lastAttempt: string;
  lastSuccess: string | null;
  error?: string;
  entries?: number;
}

export const CURATED_IDS = ['album-da-avere', 'album-consequence', 'libri-da-avere', 'libri-le-monde'] as const;
export type CuratedId = (typeof CURATED_IDS)[number];

/** Un brano della tracklist di un album (scripts/album-tracks.ts). */
export interface CuratedTrack {
  /** Numero del disco, solo per gli album con più dischi. */
  disc?: number;
  n: number;
  title: string;
  /** Durata in millisecondi. */
  ms?: number;
  /** Link diretto al brano su Apple Music. */
  url?: string;
}

/** Lista statica curata a mano (data/curated/{id}.json). */
export interface CuratedEntry {
  rank: number;
  title: string;
  /** Artista o autore. */
  creator: string;
  /** Anno di uscita; testo per opere senza un anno preciso (es. "VIII secolo a.C."). */
  year: number | string;
  description: string;
  cover?: string | null;
  /** Pagina dell'opera (Apple Music, Apple Books, Open Library). */
  url?: string | null;
  /** Titolo originale, per cercare la copertina (scripts/*-covers.ts). */
  original?: string;
  /** Autore come compare nei cataloghi internazionali, per la ricerca della copertina. */
  searchAuthor?: string;
  /** Termini di ricerca alternativi per la copertina. */
  coverSearch?: string;
  /** Catalogo Apple Books da provare per primo, con il titolo originale (es. "fr"). */
  coverCountry?: string;
  /** Tracklist (solo album). */
  tracks?: CuratedTrack[];
}

export interface CuratedList {
  id: CuratedId;
  /** Percorso della pagina (es. "libri-da-avere/le-monde"). */
  path: string;
  /**
   * Liste alternative sullo stesso tema (es. due classifiche di libri): stessa voce di menu,
   * selettore per passare dall'una all'altra e spunte "Ce l'ho" condivise.
   */
  group?: CuratedId;
  /** Etichetta nel selettore delle liste del gruppo. */
  tabLabel?: string;
  title: string;
  intro: string;
  listSource: string;
  listUrl: string;
  /** Nota sulle copertine mostrata sotto l'introduzione. */
  coversNote: string;
  entries: CuratedEntry[];
}

/** Scheda di un brano per la modale delle Canzoni (data/cache/song-info.json, scripts/song-info.ts). */
export interface SongInfo {
  album: string | null;
  /** Data di uscita (YYYY-MM-DD). */
  released: string | null;
  genre: string | null;
  durationMs: number | null;
  /** Copertina grande (600x600). */
  cover: string | null;
  appleUrl: string | null;
  /** Introduzione della voce di Wikipedia sul brano (CC BY-SA), se esiste. */
  wiki: WikiIntro | null;
}

/** Introduzione di una voce di Wikipedia (CC BY-SA 4.0). */
export interface WikiIntro {
  lang: 'it' | 'en';
  title: string;
  url: string;
  extract: string;
}

/** Scheda di un artista per la modale delle Canzoni (data/cache/artist-info.json, scripts/artist-info.ts). */
export interface ArtistInfo {
  wiki: WikiIntro | null;
  photo: PersonPhoto | null;
  appleUrl: string | null;
}

/** Foto con licenza libera da Wikimedia Commons, con i crediti richiesti dalla licenza. */
export interface PersonPhoto {
  src: string;
  page: string;
  author: string;
  license: string;
  licenseUrl: string | null;
}

/** Dati di un artista incorporati nella pagina per la modale (src/components/ArtistDialog.astro). */
export interface ArtistCard {
  name: string;
  info: ArtistInfo | null;
  /** Brani dell'artista presenti nella pagina (chiave e titolo), per aprirne la scheda. */
  songs: { key: string; title: string }[];
}

/** Dati di un brano incorporati nella pagina per la modale (src/components/SongDialog.astro). */
export interface SongCard {
  title: string;
  artist: string | null;
  cover: string | null;
  sourceUrl: string | null;
  info: SongInfo | null;
}

/** Scheda di un libro per la modale dei Libri (data/cache/book-info.json, scripts/book-info.ts). */
export interface BookInfo {
  /** Presentazione dell'editore su Apple Books (testo semplice, paragrafi separati da righe vuote). */
  blurb: string | null;
  /** Introduzione della voce di Wikipedia sul libro (CC BY-SA), solo se manca la presentazione dell'editore. */
  wiki: WikiIntro | null;
  /** Data di uscita dell'edizione (YYYY-MM-DD). */
  released: string | null;
  genre: string | null;
  /** Copertina grande (600x600). */
  cover: string | null;
  appleUrl: string | null;
  /** Pagina dell'autore (o del primo autore) su Apple Books. */
  authorUrl: string | null;
}

/** Scheda di un autore per la modale dei Libri (data/cache/author-info.json, scripts/author-info.ts). */
export interface AuthorInfo {
  wiki: WikiIntro | null;
  photo: PersonPhoto | null;
  appleUrl: string | null;
}

/** Dati di un libro incorporati nella pagina per la modale (src/components/BookDialog.astro). */
export interface BookCard {
  title: string;
  author: string | null;
  cover: string | null;
  sourceUrl: string | null;
  /** Anno della prima edizione (liste curate): più significativo della data dell'edizione in vendita. */
  year?: number | string;
  /** Descrizione scritta per la lista curata, se manca una presentazione del libro. */
  description?: string;
  info: BookInfo | null;
}

/** Un libro della pagina da cui si aprono le modali di libro e autore (classifica o lista curata). */
export interface BookItem extends Omit<BookCard, 'info'> {
  /** Chiave della scheda in data/cache/book-info.json. */
  key: string;
}

/** Dati di un autore incorporati nella pagina per la modale (src/components/AuthorDialog.astro). */
export interface AuthorCard {
  name: string;
  info: AuthorInfo | null;
  /** Libri dell'autore presenti nella pagina (chiave e titolo), per aprirne la scheda. */
  books: { key: string; title: string }[];
}
