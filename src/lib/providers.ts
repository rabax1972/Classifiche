// Servizi di streaming (dati JustWatch via TMDB): lo stesso servizio compare con più nomi, che qui diventano uno solo.

import type { WatchProvider } from './types';

/** "HBO Max Amazon Channel" e "Amazon Prime Video with Ads" contano come HBO Max e Amazon Prime Video. */
export const providerName = (name: string) =>
  name.replace(/\s+Amazon Channel$/i, '').replace(/\s+(Standard\s+)?with Ads$/i, '').replace(/^Paramount\+$/, 'Paramount Plus').trim();

/** Servizi con il nome unificato e senza doppioni: il logo è quello del servizio stesso, se c'è, altrimenti quello di un suo canale. */
export function mergeProviders(list: readonly WatchProvider[]): WatchProvider[] {
  const out = new Map<string, string | null>();
  for (const p of list) {
    const name = providerName(p.name);
    if (!out.get(name) || p.name === name) out.set(name, p.logo ?? out.get(name) ?? null);
  }
  return [...out].map(([name, logo]) => ({ name, logo }));
}
