// Film visti, serie viste e libri letti, lato client: spunte comuni a tutti i periodi e alla scheda in modale, salvate con src/lib/ticks.ts
// (localStorage del browser e, con l'account collegato, sul server).
// Film: chiave entryKey, comune a Cinema e Film. Serie: l'ID TMDB quando è noto (src/lib/data.ts, seriesSeenKey).
// Libri: chiave entryKey (titolo e primo autore), comune alla classifica e alle liste "Libri da avere".
// Ogni cambio (anche quelli arrivati dall'account) è annunciato con SEEN_EVENT, così tabella e modale restano allineate.

import { TICK_EVENT, getTicks, setTick, type TickChange } from './ticks';

export type SeenList = 'film' | 'serie' | 'libri';
const STORE: Record<SeenList, string> = { film: 'visti', serie: 'serie-viste', libri: 'letti' };
export const SEEN_EVENT = 'visti:cambio';
/** Solo le spunte messe dall'utente (non quelle arrivate dall'account): es. per proporre di segnare anche gli episodi. */
export const SEEN_CHOICE_EVENT = 'visti:scelta';

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

/** Spunta messa o tolta dall'utente (dalla classifica o dalla scheda). */
export function setSeen(list: SeenList, key: string, seen: boolean) {
  setTick(STORE[list], key, seen);
  document.dispatchEvent(new CustomEvent<SeenChange>(SEEN_CHOICE_EVENT, { detail: { list, key, seen } }));
}
