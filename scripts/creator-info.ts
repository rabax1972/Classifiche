// Schede dei creatori delle serie per le modali di Serie TV: introduzione della voce di Wikipedia (prima in italiano, poi in
// inglese; CC BY-SA) e foto con licenza libera da Wikimedia Commons, con autore e licenza da citare. Senza voce o senza
// foto, la biografia e la foto del profilo di TMDB. Le serie create vengono da TMDB.
// Lanciato da `npm run info:serie` dopo le schede delle serie.

import { artistKey, seriesSubtitle, splitArtists } from '../src/lib/aggregate';
import type { CreatorInfo, SeriesInfo } from '../src/lib/types';
import { META_MAX_AGE_DAYS, TMDB_IMG, tmdb } from './adapters/tmdb';
import { MetaCache } from './lib/store';
import { commonsCredit, trimExtract, wikiPerson, type PersonKind } from './lib/wiki';
import { SERIES_INFO_CACHE, seriesTargets } from './series-info';

export const CREATOR_INFO_CACHE = 'creator-info';
const CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };

/**
 * Le voci sui creatori: sceneggiatori e produttori, ma anche registi, comici e conduttori. Non basta "attore": l'omonimo attore
 * vincerebbe (Christopher Lloyd, creatore di Modern Family); i creatori che recitano sono descritti anche come autori.
 */
const CREATOR: PersonKind = {
  qualifiers: {
    it: ['', 'sceneggiatore', 'produttore televisivo', 'autore televisivo', 'regista', 'scrittore'],
    en: ['', 'screenwriter', 'writer', 'television producer', 'producer', 'showrunner', 'director', 'filmmaker'],
  },
  words: {
    it: /\b(sceneggiator[ei]|sceneggiatrice|produttor[ei]|produttrice|autor[ei] televisiv[oi]|autrice televisiva|showrunner|regist[ai]|scrittor[ei]|scrittrice|comic[oi]|conduttor[ei]|conduttrice|fumettist[ai]|animator[ei]|animatrice|personaggio televisivo)\b/i,
    en: /\b(screenwriters?|writers?|producers?|showrunners?|directors?|filmmakers?|comedians?|television hosts?|talk show hosts?|presenters?|cartoonists?|animators?|television personality)\b/i,
  },
};

interface TmdbPerson {
  biography?: string;
  profile_path?: string | null;
  tv_credits?: { crew: { id: number; name: string; job: string; first_air_date?: string }[] };
}

async function tmdbPerson(id: number) {
  const p = await tmdb<TmdbPerson>(`/person/${id}?language=it-IT&append_to_response=tv_credits`, CACHE);
  let bio: CreatorInfo['bio'] = p.biography?.trim() ? { text: trimExtract(p.biography.trim()), lang: 'it' } : null;
  if (!bio) {
    const en = await tmdb<TmdbPerson>(`/person/${id}?language=en-US`, CACHE);
    if (en.biography?.trim()) bio = { text: trimExtract(en.biography.trim()), lang: 'en' };
  }
  const seen = new Set<number>();
  const series = (p.tv_credits?.crew ?? [])
    .filter((c) => c.job === 'Creator' && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => (b.first_air_date || '9999').localeCompare(a.first_air_date || '9999'))
    .slice(0, 12)
    .map((c) => ({ id: c.id, title: c.name, year: c.first_air_date?.slice(0, 4) || null }));
  return { bio, photo: p.profile_path ? `${TMDB_IMG}/w300${p.profile_path}` : null, series };
}

export async function lookupCreatorInfo({ budget = 80, log = console.log } = {}) {
  const cache = await new MetaCache<CreatorInfo>(CREATOR_INFO_CACHE, META_MAX_AGE_DAYS).load();
  const shows = await new MetaCache<SeriesInfo>(SERIES_INFO_CACHE, META_MAX_AGE_DAYS).load();
  // Nomi da cercare (divisi come nella classifica) con l'ID TMDB preso dalle schede delle serie.
  const names = new Map<string, { name: string; id: number | null }>();
  for (const [key, { entry }] of await seriesTargets()) {
    const info = shows.get(key);
    const ids = new Map((info?.creators ?? []).map((c) => [artistKey(c.name), c.id]));
    const creators = seriesSubtitle(entry.subtitle).creators ?? info?.creators.map((c) => c.name).join(', ') ?? '';
    splitArtists(creators).forEach((name, i) => {
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
      const found = (await wikiPerson('it', name, CREATOR)) ?? (await wikiPerson('en', name, CREATOR));
      const photo = found?.image ? await commonsCredit(found.image) : null;
      const t = id ? await tmdbPerson(id) : null;
      cache.set(key, {
        tmdbId: id,
        wiki: found?.intro ?? null,
        bio: found ? null : (t?.bio ?? null),
        photo,
        tmdbPhoto: photo ? null : (t?.photo ?? null),
        series: t?.series ?? [],
      });
      log(`- ${name}: ${found ? `Wikipedia ${found.intro.lang} «${found.intro.title}»` : t?.bio ? `TMDB ${t.bio.lang}` : 'biografia ✗'}, foto ${photo ? 'Commons' : t?.photo ? 'TMDB' : '✗'}`);
      if (done % 10 === 0) await cache.save();
    }
  } catch (err) {
    log(`! schede creatori: ${(err as Error).message}`); // probabilmente rate limit: riprova alla prossima run
  }
  await cache.save();
  const missing = [...names.keys()].filter((k) => !cache.has(k)).length;
  log(`Schede creatori: ${done} nuove${missing ? `, ${missing} ancora da completare` : ''}`);
}
