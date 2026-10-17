// Film visti e serie viste, lato client: spunte comuni a tutti i periodi e alla scheda in modale, salvate con src/lib/ticks.ts
// (localStorage del browser e, con l'account collegato, sul server).
// Film: chiave entryKey, comune a Cinema e Film. Serie: l'ID TMDB quando è noto (src/lib/data.ts, seriesSeenKey).
// Ogni cambio (anche quelli arrivati dall'account) è annunciato con SEEN_EVENT, così tabella e modale restano allineate.

import { TICK_EVENT, getTicks, setTick, type TickChange } from './ticks';

export type SeenList = 'film' | 'serie';
const STORE: Record<SeenList, string> = { film: 'visti', serie: 'serie-viste' };
export const SEEN_EVENT = 'visti:cambio';

export interface SeenChange {
  list: SeenList;
  key: string;
  seen: boolean;
}

document.addEventListener(TICK_EVENT, (ev) => {
  const { store, key, on } = (ev as CustomEvent<TickChange>).detail;
  const list = (Object.keys(STORE) as SeenList[]).find((l) => STORE[l] === store);
  if (list) document.dispatchEvent(new CustomEvent<SeenChange>(SEEN_EVENT, { detail: { list, key, seen: on } }));
});

/** Titoli segnati come visti. */
export function seenKeys(list: SeenList): Set<string> {
  return getTicks(STORE[list]);
}

export function setSeen(list: SeenList, key: string, seen: boolean) {
  setTick(STORE[list], key, seen);
}
