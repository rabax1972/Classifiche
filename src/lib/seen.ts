// Film visti e serie viste, lato client: spunte nel localStorage del browser, comuni a tutti i periodi e alla scheda in modale.
// Film: chiave entryKey, comune a Cinema e Film. Serie: l'ID TMDB quando è noto (src/lib/data.ts, seriesSeenKey).
// Ogni cambio è annunciato con un evento sul documento, così tabella e modale restano allineate.

export type SeenList = 'film' | 'serie';
const STORAGE: Record<SeenList, string> = { film: 'visti', serie: 'serie-viste' };
export const SEEN_EVENT = 'visti:cambio';

export interface SeenChange {
  list: SeenList;
  key: string;
  seen: boolean;
}

// Copia in memoria: se il localStorage non è disponibile (es. navigazione privata) le spunte valgono solo per questa visita.
const memory: Record<SeenList, Set<string>> = { film: new Set(), serie: new Set() };

/** Titoli segnati come visti (riletti ogni volta: potrebbero essere cambiati in un'altra scheda del browser). */
export function seenKeys(list: SeenList): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE[list]);
    if (raw) memory[list] = new Set(JSON.parse(raw) as string[]);
  } catch {
    // Storage non disponibile: resta la copia in memoria.
  }
  return new Set(memory[list]);
}

export function setSeen(list: SeenList, key: string, seen: boolean) {
  const keys = seenKeys(list);
  if (seen) keys.add(key);
  else keys.delete(key);
  memory[list] = keys;
  try {
    localStorage.setItem(STORAGE[list], JSON.stringify([...keys]));
  } catch {
    // Storage non disponibile: resta la copia in memoria.
  }
  document.dispatchEvent(new CustomEvent<SeenChange>(SEEN_EVENT, { detail: { list, key, seen } }));
}
