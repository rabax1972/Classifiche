// Film visti, lato client: spunte nel localStorage del browser con chiave entryKey, comuni a Cinema e Film, a tutti i periodi
// e alla scheda del film. Ogni cambio è annunciato con un evento sul documento, così tabella e modale restano allineate.

const KEY = 'visti';
export const SEEN_EVENT = 'visti:cambio';

export interface SeenChange {
  key: string;
  seen: boolean;
}

// Copia in memoria: se il localStorage non è disponibile (es. navigazione privata) le spunte valgono solo per questa visita.
let memory = new Set<string>();

/** Film segnati come visti (riletti ogni volta: potrebbero essere cambiati in un'altra scheda del browser). */
export function seenKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = new Set(JSON.parse(raw) as string[]);
  } catch {
    // Storage non disponibile: resta la copia in memoria.
  }
  return new Set(memory);
}

export function setSeen(key: string, seen: boolean) {
  const keys = seenKeys();
  if (seen) keys.add(key);
  else keys.delete(key);
  memory = keys;
  try {
    localStorage.setItem(KEY, JSON.stringify([...keys]));
  } catch {
    // Storage non disponibile: resta la copia in memoria.
  }
  document.dispatchEvent(new CustomEvent<SeenChange>(SEEN_EVENT, { detail: { key, seen } }));
}
