// Catalogo dei podcast per la pagina "I miei podcast", come file statico (/podcast/catalogo.json) scaricato solo da quella pagina:
// il catalogo privato/podcast-seguiti.json (scripts/spotify-import.ts, fuori da git) più i podcast delle classifiche Podcast,
// così compaiono anche quelli spuntati sul sito. Quali podcast mostrare lo decide la pagina, con le spunte dell'utente
// (lista "podcast-seguiti").
import type { APIRoute } from 'astro';
import { podcastKey } from '../../lib/aggregate';
import { getChart } from '../../lib/data';
import { sourceName } from '../../lib/sources';
import { PERIOD_IDS, type FollowedPodcast, type FollowedPodcastCatalog } from '../../lib/types';

const catalogs = import.meta.glob<FollowedPodcastCatalog>('/privato/podcast-seguiti.json', { eager: true, import: 'default' });

function catalog(): FollowedPodcast[] {
  const podcasts: FollowedPodcast[] = [];
  const byKey = new Map<string, FollowedPodcast>();
  /** Aggiunge il podcast o completa quello già presente con una delle stesse chiavi, e lo restituisce. */
  const add = (p: FollowedPodcast): FollowedPodcast => {
    const known = p.keys.map((k) => byKey.get(k)).find(Boolean);
    if (!known) {
      podcasts.push(p);
      for (const k of p.keys) byKey.set(k, p);
      return p;
    }
    known.cover ??= p.cover;
    known.publisher ??= p.publisher;
    known.url ??= p.url;
    for (const k of p.keys.filter((k) => !known.keys.includes(k))) {
      known.keys.push(k);
      byKey.set(k, known);
    }
    return known;
  };
  for (const c of Object.values(catalogs)) for (const p of c.podcasts) add({ ...p, keys: [...p.keys], ranks: [] });

  // Prima le classifiche di oggi, per le posizioni; poi gli altri periodi, per i podcast usciti dalla classifica.
  for (const period of PERIOD_IDS)
    for (const view of getChart('podcast', period)?.views ?? [])
      for (const e of view.entries) {
        const keys = [podcastKey(e.title), ...(e.externalId?.startsWith('spotify:') ? [e.externalId] : [])];
        const p = add({ title: e.title, publisher: e.subtitle, cover: e.cover, url: e.sourceUrl, ranks: [], keys });
        if (period === 'oggi' && view.kind === 'daily') p.ranks.push({ source: sourceName(e.source), rank: e.rank });
      }
  return podcasts;
}

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ podcasts: catalog() }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
