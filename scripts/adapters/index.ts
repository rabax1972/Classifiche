import { appleBooks, appleMusic } from './apple';
import { lastfm } from './lastfm';
import { netflix } from './netflix';
import { tmdbNowPlaying, tmdbStreaming, tmdbTrending } from './tmdb';
import type { SourceAdapter } from './types';
import { wikipediaFimi } from './wikipedia';

/** Registro delle fonti. Per aggiungerne una: crea l'adapter e aggiungilo qui (vedi README). */
export const ADAPTERS: SourceAdapter[] = [
  appleMusic,
  lastfm,
  wikipediaFimi,
  appleBooks,
  tmdbNowPlaying,
  tmdbStreaming,
  tmdbTrending,
  netflix,
];
