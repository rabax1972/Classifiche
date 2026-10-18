// Episodi di una stagione come file statico (/serie-tv/episodi/{tmdbId}/{stagione}.json), scaricato dalla modale della
// serie solo quando si apre la stagione: tutti gli episodi nella pagina la renderebbero troppo pesante.
// Serie delle classifiche (data/cache/episodes) e serie viste della pagina "Le mie serie viste" (privato/episodi, da
// scripts/trakt-import.ts, fuori da git: le stagioni raccolte da più di 150 giorni non vengono pubblicate, limite TMDB).
import type { APIRoute, GetStaticPaths } from 'astro';
import type { EpisodeCacheFile, SeasonEpisodes } from '../../../../lib/types';

const MAX_AGE_DAYS = 150;

const files = import.meta.glob<EpisodeCacheFile>('/data/cache/episodes/*.json', { eager: true, import: 'default' });
const privateFiles = import.meta.glob<EpisodeCacheFile>('/privato/episodi/*.json', { eager: true, import: 'default' });

export const getStaticPaths = (() => {
  const seasons = new Map<string, EpisodeCacheFile['seasons']>();
  const id = (file: string) => file.match(/(\d+)\.json$/)![1]!;
  const recent = Date.now() - MAX_AGE_DAYS * 86_400_000;
  for (const [file, data] of Object.entries(privateFiles))
    seasons.set(id(file), Object.fromEntries(Object.entries(data.seasons).filter(([, s]) => Date.parse(s.fetchedAt) >= recent)));
  // Le serie delle classifiche hanno gli episodi rinnovati dal cron: valgono quelli.
  for (const [file, data] of Object.entries(files)) seasons.set(id(file), { ...seasons.get(id(file)), ...data.seasons });
  return [...seasons].flatMap(([id, byNumber]) =>
    Object.entries(byNumber).map(([stagione, s]) => ({ params: { id, stagione }, props: { episodes: s.episodes } satisfies SeasonEpisodes })),
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
