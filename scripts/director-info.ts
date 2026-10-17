// Schede dei registi per le modali di Cinema e Film: introduzione della voce di Wikipedia (prima in italiano, poi in
// inglese; CC BY-SA) e foto con licenza libera da Wikimedia Commons, con autore e licenza da citare. Senza voce o senza
// foto, la biografia e la foto del profilo di TMDB. I film diretti vengono da TMDB.
// Lanciato da `npm run info:film` dopo le schede dei film.

import { artistKey, movieSubtitle, splitArtists } from '../src/lib/aggregate';
import type { DirectorInfo, MovieInfo } from '../src/lib/types';
import { META_MAX_AGE_DAYS, TMDB_IMG, tmdb } from './adapters/tmdb';
import { MetaCache } from './lib/store';
import { commonsCredit, trimExtract, wikiPerson, type PersonKind } from './lib/wiki';
import { MOVIE_INFO_CACHE, movieTargets } from './movie-info';

export const DIRECTOR_INFO_CACHE = 'director-info';
const CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };

/** Le voci sui registi: spesso sono anche sceneggiatori, attori o produttori. */
const DIRECTOR: PersonKind = {
  qualifiers: {
    it: ['', 'regista', 'regista statunitense', 'regista britannico', 'regista italiano', 'attore', 'attrice', 'sceneggiatore'],
    en: ['', 'director', 'filmmaker', 'film director', 'American director', 'American filmmaker', 'British director', 'actor', 'actress', 'screenwriter'],
  },
  words: {
    it: /\b(regist[ai]|cineast[ai]|sceneggiator[ei]|sceneggiatrice|attor[ei]|attrice|produttor[ei]|produttrice|animator[ei]|animatrice|montator[ei]|direttor[ei] della fotografia|comic[oi]|fumettist[ai]|youtuber)\b/i,
    en: /\b(directors?|filmmakers?|film-?makers?|screenwriters?|actors?|actress(es)?|producers?|animators?|film editors?|cinematographers?|comedians?|cartoonists?|youtubers?)\b/i,
  },
};

interface TmdbPerson {
  biography?: string;
  profile_path?: string | null;
  movie_credits?: { crew: { id: number; title: string; job: string; release_date?: string; popularity?: number }[] };
}

async function tmdbPerson(id: number) {
  const p = await tmdb<TmdbPerson>(`/person/${id}?language=it-IT&append_to_response=movie_credits`, CACHE);
  let bio: DirectorInfo['bio'] = p.biography?.trim() ? { text: trimExtract(p.biography.trim()), lang: 'it' } : null;
  if (!bio) {
    const en = await tmdb<TmdbPerson>(`/person/${id}?language=en-US`, CACHE);
    if (en.biography?.trim()) bio = { text: trimExtract(en.biography.trim()), lang: 'en' };
  }
  const seen = new Set<number>();
  const films = (p.movie_credits?.crew ?? [])
    .filter((c) => c.job === 'Director' && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => (b.release_date || '9999').localeCompare(a.release_date || '9999'))
    .slice(0, 12)
    .map((c) => ({ id: c.id, title: c.title, year: c.release_date?.slice(0, 4) || null }));
  return { bio, photo: p.profile_path ? `${TMDB_IMG}/w300${p.profile_path}` : null, films };
}

export async function lookupDirectorInfo({ budget = 80, log = console.log } = {}) {
  const cache = await new MetaCache<DirectorInfo>(DIRECTOR_INFO_CACHE, META_MAX_AGE_DAYS).load();
  const movies = await new MetaCache<MovieInfo>(MOVIE_INFO_CACHE, META_MAX_AGE_DAYS).load();
  // Nomi da cercare (divisi come nella classifica) con l'ID TMDB preso dalle schede dei film.
  const names = new Map<string, { name: string; id: number | null }>();
  for (const [key, { entry }] of await movieTargets()) {
    const info = movies.get(key);
    const ids = new Map((info?.directors ?? []).map((d) => [artistKey(d.name), d.id]));
    const directors = movieSubtitle(entry.subtitle).directors ?? info?.directors.map((d) => d.name).join(', ') ?? '';
    splitArtists(directors).forEach((name, i) => {
      if (i % 2 === 1 || !name.trim()) return;
      const k = artistKey(name);
      if (!names.has(k) || (!names.get(k)!.id && ids.get(k))) names.set(k, { name: name.trim(), id: ids.get(k) ?? null });
    });
  }

  let done = 0;
  try {
    for (const [key, { name, id }] of names) {
      if (cache.has(key) || done >= budget) continue;
      done++;
      const found = (await wikiPerson('it', name, DIRECTOR)) ?? (await wikiPerson('en', name, DIRECTOR));
      const photo = found?.image ? await commonsCredit(found.image) : null;
      const t = id ? await tmdbPerson(id) : null;
      cache.set(key, {
        tmdbId: id,
        wiki: found?.intro ?? null,
        bio: found ? null : (t?.bio ?? null),
        photo,
        tmdbPhoto: photo ? null : (t?.photo ?? null),
        films: t?.films ?? [],
      });
      log(`- ${name}: ${found ? `Wikipedia ${found.intro.lang} «${found.intro.title}»` : t?.bio ? `TMDB ${t.bio.lang}` : 'biografia ✗'}, foto ${photo ? 'Commons' : t?.photo ? 'TMDB' : '✗'}`);
      if (done % 10 === 0) await cache.save();
    }
  } catch (err) {
    log(`! schede registi: ${(err as Error).message}`); // probabilmente rate limit: riprova alla prossima run
  }
  await cache.save();
  const missing = [...names.keys()].filter((k) => !cache.has(k)).length;
  log(`Schede registi: ${done} nuove${missing ? `, ${missing} ancora da completare` : ''}`);
}
