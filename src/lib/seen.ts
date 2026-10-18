// Film visti, serie viste e libri letti, lato client: spunte comuni a tutti i periodi e alla scheda in modale, salvate con src/lib/ticks.ts
// (localStorage del browser e, con l'account collegato, sul server).
// Film: chiave entryKey, comune a Cinema e Film. Serie: l'ID TMDB quando è noto (src/lib/data.ts, seriesSeenKey).
// Libri: chiave entryKey (titolo e primo autore), comune alla classifica e alle liste "Libri da avere".
// Ogni cambio (anche quelli arrivati dall'account) è annunciato con SEEN_EVENT, così tabella e modale restano allineate.
// Un film può essere spuntato anche con l'ID TMDB ("movie:{id}", es. dalla sincronizzazione con Trakt, src/lib/trakt-sync.ts):
// la pagina registra l'alias con aliasSeen() e quella spunta vale come quella del titolo in classifica.

import { TICK_EVENT, getTicks, setTick, setTicks, type TickChange } from './ticks';

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

/** Chiave di un film per ID TMDB, alternativa a quella del titolo. */
export const movieIdKey = (id: number) => `movie:${id}`;
/** Alias → chiave del titolo nella pagina (solo film). */
const aliases = new Map<string, string>();

/** La spunta `alias` (es. "movie:123") vale come quella del titolo `key`. */
export function aliasSeen(key: string, alias: string) {
  if (alias !== key) aliases.set(alias, key);
}

document.addEventListener(TICK_EVENT, (ev) => {
  const { store, key, on } = (ev as CustomEvent<TickChange>).detail;
  const list = (Object.keys(STORE) as SeenList[]).find((l) => STORE[l] === store);
  if (!list) return;
  const main = aliases.get(key);
  // Un alias cambia la spunta del titolo solo se l'altra chiave non la tiene già (o non la toglie).
  const target = main ?? key;
  const seen = main ? seenKeys(list).has(main) : on || seenKeys(list).has(key);
  document.dispatchEvent(new CustomEvent<SeenChange>(SEEN_EVENT, { detail: { list, key: target, seen } }));
});

/** Titoli segnati come visti (anche tramite un alias). */
export function seenKeys(list: SeenList): Set<string> {
  const keys = getTicks(STORE[list]);
  for (const [alias, key] of aliases) if (keys.has(alias)) keys.add(key);
  return keys;
}

/** Spunta messa o tolta dall'utente (dalla classifica o dalla scheda); togliendola si tolgono anche i suoi alias. */
export function setSeen(list: SeenList, key: string, seen: boolean) {
  setTick(STORE[list], key, seen);
  if (!seen) setTicks(STORE[list], [...aliases].filter(([, k]) => k === key).map(([alias]) => alias), false);
  document.dispatchEvent(new CustomEvent<SeenChange>(SEEN_CHOICE_EVENT, { detail: { list, key, seen } }));
}
