import type { CategoryId, PeriodId } from './types';

export interface SourceInfo {
  id: string;
  name: string;
  homepage: string;
  /** Testo di attribuzione richiesto o consigliato dai termini d'uso. */
  attribution: string;
  /** Giorni massimi di conservazione dei dati imposti dai termini (es. TMDB: 6 mesi). */
  retentionDays?: number;
}

export const SOURCES: Record<string, SourceInfo> = {
  'apple-music': {
    id: 'apple-music',
    name: 'Apple Music',
    homepage: 'https://music.apple.com/it/',
    attribution: 'Classifica "Top brani" Italia da Apple Music (RSS Marketing Tools).',
  },
  lastfm: {
    id: 'lastfm',
    name: 'Last.fm',
    homepage: 'https://www.last.fm/',
    attribution: 'Dati di ascolto forniti da Last.fm.',
  },
  'wikipedia-fimi': {
    id: 'wikipedia-fimi',
    name: 'FIMI via Wikipedia',
    homepage: 'https://it.wikipedia.org/',
    attribution:
      'Classifiche ufficiali FIMI riportate da Wikipedia, testo disponibile con licenza CC BY-SA 4.0.',
  },
  'apple-books': {
    id: 'apple-books',
    name: 'Apple Books',
    homepage: 'https://books.apple.com/it/',
    attribution: 'Classifica ebook a pagamento di Apple Books Italia (RSS Marketing Tools).',
  },
  'spotify-podcasts': {
    id: 'spotify-podcasts',
    name: 'Spotify',
    homepage: 'https://podcastcharts.byspotify.com/it/top-podcasts',
    attribution: 'Classifica "Top Podcasts" Italia di Spotify Podcast Charts.',
  },
  'apple-podcasts': {
    id: 'apple-podcasts',
    name: 'Apple Podcasts',
    homepage: 'https://podcasts.apple.com/it/charts',
    attribution: 'Classifica "Top podcast" Italia di Apple Podcasts (RSS Marketing Tools).',
  },
  'tmdb-streaming': {
    id: 'tmdb-streaming',
    name: 'TMDB',
    homepage: 'https://www.themoviedb.org/',
    attribution: 'Popolarità su TMDB dei titoli disponibili in streaming in Italia.',
    retentionDays: 180,
  },
  'tmdb-trending': {
    id: 'tmdb-trending',
    name: 'TMDB (trending)',
    homepage: 'https://www.themoviedb.org/',
    attribution: 'Titoli di tendenza del giorno su TMDB.',
    retentionDays: 180,
  },
  'tmdb-now-playing': {
    id: 'tmdb-now-playing',
    name: 'TMDB (in sala)',
    homepage: 'https://www.themoviedb.org/',
    attribution: 'Film in programmazione nelle sale italiane, ordinati per popolarità su TMDB.',
    retentionDays: 180,
  },
  netflix: {
    id: 'netflix',
    name: 'Netflix Top 10',
    homepage: 'https://www.netflix.com/tudum/top10',
    attribution: 'Classifica settimanale ufficiale Netflix Top 10 per l\'Italia.',
  },
  wikidata: {
    id: 'wikidata',
    name: 'Wikidata',
    homepage: 'https://www.wikidata.org/',
    attribution: 'Tomatometer di Rotten Tomatoes dei film, come riportato da Wikidata (dati CC0).',
  },
  oscar: {
    id: 'oscar',
    name: 'Oscar',
    homepage: 'https://www.oscars.org/oscars/ceremonies',
    attribution: 'Vincitori dell\'Oscar al miglior film: elenco da Wikidata (CC0), con il link alla cerimonia sul sito dell\'Academy.',
  },
  imdb: {
    id: 'imdb',
    name: 'IMDb',
    homepage: 'https://www.imdb.com/chart/top/',
    attribution: 'Information courtesy of IMDb (https://www.imdb.com). Used with permission. Dataset non commerciali di IMDb, uso personale e non commerciale.',
  },
};

export interface CategoryConfig {
  id: CategoryId;
  label: string;
  description: string;
  /** Fonti degli snapshot giornalieri, in ordine di priorità: la prima disponibile vince. */
  snapshotSources: string[];
  /** Una scheda per ogni fonte degli snapshot (classifiche diverse, es. Spotify e Apple Podcasts) invece della prima disponibile. */
  viewPerSource?: boolean;
  /** Fonti ufficiali usate per periodo, quando esistono. */
  officialFor: Partial<Record<PeriodId, { source: string; periodType: 'week' | 'year' }>>;
  /** Nota mostrata sotto il titolo (limiti della fonte). */
  note?: string;
}

export const CATEGORIES: Record<CategoryId, CategoryConfig> = {
  canzoni: {
    id: 'canzoni',
    label: 'Canzoni',
    description: 'I brani più ascoltati in Italia.',
    snapshotSources: ['apple-music', 'lastfm'],
    officialFor: { anno: { source: 'wikipedia-fimi', periodType: 'year' } },
  },
  libri: {
    id: 'libri',
    label: 'Libri',
    description: 'Gli ebook più venduti in Italia.',
    snapshotSources: ['apple-books'],
    officialFor: {},
    note: 'Non esistono classifiche librarie italiane gratuite e riutilizzabili: questa classifica riflette solo le vendite di ebook su Apple Books.',
  },
  cinema: {
    id: 'cinema',
    label: 'Cinema',
    description: 'I film nelle sale italiane.',
    snapshotSources: ['tmdb-now-playing'],
    officialFor: {},
    note: 'Gli incassi ufficiali (Cinetel) non sono disponibili come dati aperti: la classifica ordina i film in programmazione nelle sale italiane per popolarità su TMDB, non per incasso.',
  },
  film: {
    id: 'film',
    label: 'Film',
    description: 'I film più popolari in streaming.',
    snapshotSources: ['tmdb-streaming', 'tmdb-trending'],
    officialFor: { settimana: { source: 'netflix', periodType: 'week' } },
  },
  'serie-tv': {
    id: 'serie-tv',
    label: 'Serie TV',
    description: 'Le serie più popolari in streaming.',
    snapshotSources: ['tmdb-streaming', 'tmdb-trending'],
    officialFor: { settimana: { source: 'netflix', periodType: 'week' } },
  },
  podcast: {
    id: 'podcast',
    label: 'Podcast',
    description: 'I podcast più ascoltati in Italia.',
    snapshotSources: ['spotify-podcasts', 'apple-podcasts'],
    viewPerSource: true,
    officialFor: {},
    note: 'Non esiste una classifica italiana dei podcast che comprenda tutte le piattaforme: qui ci sono quelle di Spotify e di Apple Podcasts, una per scheda.',
  },
};

export const PERIODS: Record<PeriodId, { label: string; days: number; computedLabel: string }> = {
  oggi: { label: 'Oggi', days: 1, computedLabel: 'Oggi' },
  settimana: { label: 'Settimana', days: 7, computedLabel: 'Ultimi 7 giorni' },
  mese: { label: 'Mese', days: 30, computedLabel: 'Ultimi 30 giorni' },
  anno: { label: 'Anno', days: 365, computedLabel: 'Ultimi 365 giorni' },
};

export function sourceName(id: string): string {
  return SOURCES[id]?.name ?? id;
}
