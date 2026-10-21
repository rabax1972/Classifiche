// Schema dati condiviso tra script di ingestion, aggregazione e UI.

export const CATEGORY_IDS = ['canzoni', 'libri', 'cinema', 'film', 'serie-tv', 'podcast'] as const;
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
  /** Voto medio sulla fonte (es. IMDb, su 10), per le classifiche ordinate per voto. */
  rating?: { value: number; votes: number };
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
  /** Voto medio dei lettori su Apple Books (da 1 a 5) e numero di voti; assente nelle schede raccolte prima di ottobre 2026. */
  rating?: number | null;
  ratings?: number;
}

/** Scheda di un autore per la modale dei Libri (data/cache/author-info.json, scripts/author-info.ts). */
export interface AuthorInfo {
  wiki: WikiIntro | null;
  photo: PersonPhoto | null;
  appleUrl: string | null;
  /** Anno di morte da Wikidata (negativo se a.C.); null se vivente o sconosciuto, assente se non ancora cercato. */
  died?: number | null;
}

/**
 * Edizioni gratuite di un libro di pubblico dominio (data/cache/free-books.json, scripts/free-books.ts):
 * solo da siti che pubblicano testi liberi da diritti, traduzioni comprese.
 */
export interface FreeEdition {
  /** Anno di morte dell'ultimo autore; null per le opere antiche senza autore o senza data. */
  authorDied: number | null;
  /** Pagina dell'opera su Liber Liber (EPUB, PDF e altri formati gratuiti). */
  liberLiber: string | null;
  wikisource: { title: string; url: string; epub: string } | null;
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
  /** Presente solo se il libro è di pubblico dominio. */
  free: FreeEdition | null;
}

/** Un libro della pagina da cui si aprono le modali di libro e autore (classifica o lista curata). */
export interface BookItem extends Omit<BookCard, 'info' | 'free'> {
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

/** Scheda di un film per le modali di Cinema e Film (data/cache/movie-info.json, scripts/movie-info.ts; dati TMDB). */
export interface MovieInfo {
  tmdbId: number;
  /** Titolo italiano su TMDB (manca nelle schede raccolte prima di ottobre 2026). */
  title?: string;
  /** Trama da TMDB, in italiano o, se manca, in inglese. */
  overview: string | null;
  overviewLang: 'it' | 'en' | null;
  tagline: string | null;
  originalTitle: string | null;
  genres: string[];
  runtime: number | null;
  /** Uscita nelle sale italiane (YYYY-MM-DD), o la data di uscita generale. */
  released: string | null;
  /** Voto medio TMDB (0-10) e numero di voti. */
  vote: number | null;
  votes: number;
  /** Locandina grande (w500). */
  poster: string | null;
  directors: { id: number; name: string }[];
  /** Attori principali, con il personaggio. */
  cast: { name: string; character: string | null }[];
  /** Chiave del trailer su YouTube. */
  trailer: string | null;
  /** Dove vederlo in Italia (dati JustWatch via TMDB): link alla pagina TMDB e servizi in abbonamento, noleggio e acquisto. */
  watch: { link: string; flatrate: WatchProvider[]; rent: WatchProvider[]; buy: WatchProvider[] } | null;
}

/** Voto medio su IMDb (su 10) e numero di voti, dai dataset non commerciali di IMDb. */
export interface ImdbRating {
  value: number;
  votes: number;
}

/** Tomatometer di Rotten Tomatoes (percentuale di recensioni positive dei critici), come riportato da Wikidata. */
export interface RottenRating {
  score: number;
  /** Giorno in cui Wikidata ha registrato il dato (YYYY-MM-DD). */
  date: string | null;
  url: string | null;
}

/** Voti di un film su IMDb e Rotten Tomatoes (scripts/movie-ratings.ts). */
export interface MovieRatings {
  imdbId: string | null;
  imdb: ImdbRating | null;
  rt: RottenRating | null;
}

/**
 * File data/cache/movie-ratings.json (film delle classifiche) e privato/film-voti.json (solo film del catalogo privato,
 * fuori da git): voti per ID TMDB.
 */
export interface MovieRatingsFile {
  /** Ultimo aggiornamento completo (YYYY-MM-DD). */
  date: string;
  films: Record<string, MovieRatings>;
}

export interface WatchProvider {
  name: string;
  logo: string | null;
}

/** Scheda di un regista per le modali di Cinema e Film (data/cache/director-info.json, scripts/director-info.ts). */
export interface DirectorInfo {
  tmdbId: number | null;
  /** Introduzione della voce di Wikipedia (CC BY-SA); se manca, la biografia di TMDB in `bio`. */
  wiki: WikiIntro | null;
  bio: { text: string; lang: 'it' | 'en' } | null;
  /** Foto da Wikimedia Commons con i crediti; altrimenti la foto del profilo TMDB in `tmdbPhoto`. */
  photo: PersonPhoto | null;
  tmdbPhoto: string | null;
  /** Film diretti, dal più recente (al massimo 12). */
  films: { id: number; title: string; year: string | null }[];
}

/** Dati di un film incorporati nella pagina per la modale (src/components/MovieDialog.astro). */
export interface MovieCard {
  title: string;
  /** Registi come nella classifica ("A, B"), senza l'anno. */
  directors: string | null;
  year: string | null;
  cover: string | null;
  sourceUrl: string | null;
  info: MovieInfo | null;
  ratings?: MovieRatings | null;
}

/**
 * Un film delle liste personali ("I miei visti" della pagina Film, pagina "Da vedere"; file statico /film/catalogo.json,
 * src/pages/film/catalogo.json.ts): dal catalogo privato/film-visti.json di scripts/trakt-import.ts più le schede dei film in
 * cache. Dati TMDB, servizi di JustWatch.
 */
export interface SeenMovie {
  tmdbId: number;
  title: string;
  year: number | null;
  /** Uscita nelle sale italiane (YYYY-MM-DD) o, se manca, la data di uscita originale: per l'ordinamento. */
  released: string | null;
  directors: string[];
  /** Locandina piccola (w185). */
  poster: string | null;
  /** Voto medio TMDB, solo con almeno 10 voti. */
  vote: number | null;
  votes: number;
  genres: string[];
  runtime: number | null;
  /** Servizi in abbonamento in Italia, con il nome unificato (src/lib/providers.ts). */
  providers: WatchProvider[];
  /** Voti IMDb e Rotten Tomatoes (scripts/movie-ratings.ts). */
  imdbId?: string | null;
  imdb?: ImdbRating | null;
  rt?: RottenRating | null;
  /** Chiavi della lista "visti" (entryKey) con cui il film può comparire: è visto se ne è spuntata una. */
  keys: string[];
}

/** File privato/film-visti.json (fuori da git), scritto da scripts/trakt-import.ts. */
export interface SeenMovieCatalog {
  /** Giorno di raccolta dei dati TMDB (YYYY-MM-DD): oltre i 150 giorni il catalogo non viene pubblicato. */
  date: string;
  films: SeenMovie[];
}

/**
 * Un libro della pagina "I miei libri letti" (file statico /libri/catalogo.json, src/pages/libri/catalogo.json.ts): dal catalogo
 * privato/libri-letti.json di scripts/anobii-import.ts più i libri della classifica e delle liste "Libri da avere".
 */
export interface ReadBook {
  title: string;
  author: string;
  cover: string | null;
  /** Anno di pubblicazione (dell'edizione letta, per i libri di aNobii). */
  year: number | null;
  pages: number | null;
  publisher: string | null;
  /** Fine della lettura (YYYY, YYYY-MM o YYYY-MM-DD), dall'esportazione di aNobii. */
  finished: string | null;
  /** Voto dato su aNobii (da 0,5 a 5). */
  rating: number | null;
  /** Chiavi della lista "letti" (entryKey di titolo e autore) con cui il libro può comparire: è letto se ne è spuntata una. */
  keys: string[];
}

/**
 * Una serie della pagina "Le mie serie viste" (file statico /serie-tv/catalogo.json, src/pages/serie-tv/catalogo.json.ts): dal
 * catalogo privato/serie-viste.json di scripts/trakt-import.ts più le schede delle serie in cache. Dati TMDB, servizi di JustWatch.
 * Vista per intero se è spuntata "tv:{tmdbId}" (lista "serie-viste"), in corso se ha episodi spuntati ("episodi-visti").
 */
export interface SeenSeries {
  tmdbId: number;
  title: string;
  /** Prima messa in onda (YYYY-MM-DD). */
  firstAired: string | null;
  creators: string[];
  /** Locandina piccola (w185). */
  poster: string | null;
  /** Voto medio TMDB, solo con almeno 10 voti. */
  vote: number | null;
  votes: number;
  genres: string[];
  seasons: number | null;
  episodes: number | null;
  /** "in-corso" (ancora prodotta) o "conclusa". */
  status: 'in-corso' | 'conclusa' | null;
  providers: WatchProvider[];
}

/** Serie del file /serie-tv/catalogo.json: dati della lista più la scheda per la modale (src/components/SeriesDialog.astro). */
export interface SeenSeriesEntry extends SeenSeries {
  /** Chiave della scheda nella modale: entryKey per le serie delle classifiche, "tv:{tmdbId}" per le altre. */
  key: string;
  card: SeriesCard;
}

/** File privato/serie-viste.json (fuori da git), scritto da scripts/trakt-import.ts: le schede TMDB delle serie viste. */
export interface SeenSeriesCatalog {
  date: string;
  series: SeriesInfo[];
}

/** File privato/libri-letti.json (fuori da git), scritto da scripts/anobii-import.ts. */
export interface ReadBookCatalog {
  date: string;
  books: (ReadBook & { isbn: string | null })[];
}

/** Un podcast della pagina "I miei podcast" (/podcast/catalogo.json). */
export interface FollowedPodcast {
  title: string;
  publisher: string | null;
  cover: string | null;
  /** Pagina del podcast su Spotify o, se manca, su Apple Podcasts. */
  url: string | null;
  /** Posizioni nelle classifiche di oggi (nome della fonte e posizione). */
  ranks: { source: string; rank: number }[];
  /** Chiavi della lista "podcast-seguiti" (podcastKey del titolo, URI Spotify): è seguito se ne è spuntata una. */
  keys: string[];
}

/** Un episodio recente di un podcast, dal suo feed RSS. */
export interface PodcastEpisode {
  title: string;
  /** Data di pubblicazione (YYYY-MM-DD). */
  date: string | null;
  /** Durata in secondi. */
  seconds: number | null;
  /** Pagina dell'episodio indicata dal feed. */
  url: string | null;
}

/** Scheda di un podcast per la modale (data/cache/podcast-info.json, scripts/podcast-info.ts; chiave podcastKey). */
export interface PodcastInfo {
  /** Scheda su Apple Podcasts (API di ricerca di iTunes). */
  appleUrl: string | null;
  genres: string[];
  /** Numero di episodi pubblicati. */
  episodes: number | null;
  /** Copertina grande (600x600). */
  cover: string | null;
  /** Feed RSS pubblico del podcast. */
  feedUrl: string | null;
  /** Descrizione del podcast dal feed RSS (testo semplice). */
  description: string | null;
  /** Pagina web del podcast indicata dal feed. */
  website: string | null;
  /** Ultimi episodi, dal più recente. */
  latest: PodcastEpisode[];
}

/** Un podcast della pagina da cui si apre la modale (src/components/PodcastDialog.astro). */
export interface PodcastCard {
  title: string;
  publisher: string | null;
  cover: string | null;
  spotifyUrl: string | null;
  appleUrl: string | null;
  /** Posizioni nelle classifiche di oggi (nome della fonte e posizione). */
  ranks: { source: string; rank: number }[];
  info: PodcastInfo | null;
}

/** File privato/podcast-seguiti.json (fuori da git), scritto da scripts/spotify-import.ts. */
export interface FollowedPodcastCatalog {
  date: string;
  podcasts: Omit<FollowedPodcast, 'ranks'>[];
}

/** Un film della pagina da cui si aprono le modali di film e regista. */
export interface MovieItem extends Omit<MovieCard, 'info'> {
  /** Chiave della scheda in data/cache/movie-info.json (entryKey). */
  key: string;
}

/** Dati di un regista incorporati nella pagina per la modale (src/components/DirectorDialog.astro). */
export interface DirectorCard {
  name: string;
  info: DirectorInfo | null;
  /** Film del regista presenti nella pagina (chiave e titolo), per aprirne la scheda. */
  movies: { key: string; title: string }[];
}

/** Scheda di una serie per le modali di Serie TV (data/cache/series-info.json, scripts/series-info.ts; dati TMDB). */
export interface SeriesInfo {
  tmdbId: number;
  /** Titolo italiano su TMDB (manca nelle schede raccolte prima di ottobre 2026). */
  title?: string;
  /** Trama da TMDB, in italiano o, se manca, in inglese. */
  overview: string | null;
  overviewLang: 'it' | 'en' | null;
  tagline: string | null;
  originalTitle: string | null;
  genres: string[];
  /** Durata tipica di un episodio, in minuti. */
  episodeRuntime: number | null;
  /** Prima e ultima messa in onda (YYYY-MM-DD). */
  firstAired: string | null;
  lastAired: string | null;
  /** Stato su TMDB: "Returning Series", "Ended", "Canceled", "In Production", "Planned", "Pilot". */
  status: string | null;
  seasons: number | null;
  episodes: number | null;
  /** Stagioni (gli speciali, numero 0, in fondo), con gli episodi in data/cache/episodes/{tmdbId}.json. */
  seasonList: SeasonSummary[];
  /** Prossimo episodio annunciato. */
  nextEpisode: { date: string; season: number; episode: number } | null;
  /** Reti o piattaforme che la producono. */
  networks: string[];
  /** Voto medio TMDB (0-10) e numero di voti. */
  vote: number | null;
  votes: number;
  /** Locandina grande (w500). */
  poster: string | null;
  creators: { id: number; name: string }[];
  /** Interpreti principali di tutte le stagioni, con il personaggio. */
  cast: { name: string; character: string | null }[];
  /** Chiave del trailer su YouTube. */
  trailer: string | null;
  /** Dove vederla in Italia (dati JustWatch via TMDB). */
  watch: MovieInfo['watch'];
}

export interface SeasonSummary {
  /** Numero della stagione su TMDB (0 = speciali). */
  n: number;
  name: string;
  /** Prima messa in onda (YYYY-MM-DD). */
  date: string | null;
  episodes: number;
}

/** Un episodio, per le schede nella modale della serie (dati TMDB). */
export interface EpisodeInfo {
  n: number;
  title: string;
  date: string | null;
  runtime: number | null;
  /** Trama in italiano o, se manca, in inglese. */
  overview: string | null;
  overviewLang: 'it' | 'en' | null;
  /** Fotogramma (w300). */
  still: string | null;
  vote: number | null;
  votes: number;
  directors: string[];
  writers: string[];
}

/** Gli episodi di una stagione: file statico /serie-tv/episodi/{tmdbId}/{stagione}.json, letto dalla modale. */
export interface SeasonEpisodes {
  episodes: EpisodeInfo[];
}

/** File data/cache/episodes/{tmdbId}.json (scripts/episode-info.ts): stagioni con la data di raccolta, per la scadenza TMDB. */
export interface EpisodeCacheFile {
  seasons: Record<string, SeasonEpisodes & { fetchedAt: string }>;
}

/** Stato delle serie su TMDB, in italiano. */
export const SERIES_STATUS: Record<string, string> = {
  'Returning Series': 'In corso',
  'In Production': 'In produzione',
  Planned: 'Annunciata',
  Pilot: 'Episodio pilota',
  Ended: 'Conclusa',
  Canceled: 'Cancellata',
};

/** Scheda di un creatore di serie per le modali di Serie TV (data/cache/creator-info.json, scripts/creator-info.ts). */
export interface CreatorInfo {
  tmdbId: number | null;
  /** Introduzione della voce di Wikipedia (CC BY-SA); se manca, la biografia di TMDB in `bio`. */
  wiki: WikiIntro | null;
  bio: { text: string; lang: 'it' | 'en' } | null;
  /** Foto da Wikimedia Commons con i crediti; altrimenti la foto del profilo TMDB in `tmdbPhoto`. */
  photo: PersonPhoto | null;
  tmdbPhoto: string | null;
  /** Serie create, dalla più recente (al massimo 12). */
  series: { id: number; title: string; year: string | null }[];
}

/** Dati di una serie incorporati nella pagina per la modale (src/components/SeriesDialog.astro). */
export interface SeriesCard {
  title: string;
  /** Creatori come nella classifica ("A, B"), senza l'anno; null per le righe Netflix. */
  creators: string | null;
  year: string | null;
  /** Stagione indicata dalla Top 10 Netflix ("Stagione 2"). */
  label: string | null;
  cover: string | null;
  sourceUrl: string | null;
  /** Chiave della spunta "Vista" (src/lib/seen.ts): la stessa per tutte le stagioni e le fonti, se l'ID TMDB è noto. */
  seenKey: string;
  info: SeriesInfo | null;
}

/** Una serie della pagina da cui si aprono le modali di serie e creatore. */
export interface SeriesItem extends Omit<SeriesCard, 'info' | 'seenKey'> {
  /** Chiave della scheda in data/cache/series-info.json (entryKey). */
  key: string;
  externalId: string | null;
}

/** Dati di un creatore incorporati nella pagina per la modale (src/components/CreatorDialog.astro). */
export interface CreatorCard {
  name: string;
  info: CreatorInfo | null;
  /** Serie del creatore presenti nella pagina (chiave e titolo), per aprirne la scheda. */
  series: { key: string; title: string }[];
}

/**
 * Riepilogo di un aggiornamento automatico (scripts/pubblica-aruba.ts → _riepilogo.json nello zip → mdb-database/aggiornamento.json),
 * mostrato all'amministratore in /account/.
 */
export interface UpdateSummary {
  quando: string;
  /** Fonti dell'ultima ingestion (data/status.json) e quelle non raggiunte. */
  fonti: { totali: number; errori: { fonte: string; categoria: string; errore: string }[] };
  /** Nuove entrate per classifica rispetto a prima dell'aggiornamento; null se il confronto non era possibile (es. lancio dal PC). */
  classifiche: UpdateChartChange[] | null;
  file: { pagine: number; episodi: number; altri: number };
}

export interface UpdateChartChange {
  categoria: string;
  periodo: string;
  vista: string;
  /** Primi titoli entrati ("Titolo — Sottotitolo"); "altri" quelli oltre. */
  nuovi: string[];
  altri: number;
  usciti: number;
}
