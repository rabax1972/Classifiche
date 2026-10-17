// Episodi di una stagione come file statico (/serie-tv/episodi/{tmdbId}/{stagione}.json), scaricato dalla modale della
// serie solo quando si apre la stagione: tutti gli episodi nella pagina la renderebbero troppo pesante.
import type { APIRoute, GetStaticPaths } from 'astro';
import type { EpisodeCacheFile, SeasonEpisodes } from '../../../../lib/types';

const files = import.meta.glob<EpisodeCacheFile>('/data/cache/episodes/*.json', { eager: true, import: 'default' });

export const getStaticPaths = (() =>
  Object.entries(files).flatMap(([file, data]) => {
    const id = file.match(/(\d+)\.json$/)![1];
    return Object.entries(data.seasons).map(([stagione, s]) => ({
      params: { id, stagione },
      props: { episodes: s.episodes } satisfies SeasonEpisodes,
    }));
  })) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
