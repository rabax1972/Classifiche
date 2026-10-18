// Spunte dell'utente (film visti e da vedere, serie viste, episodi visti, titoli posseduti delle liste curate), lato client.
// Ogni lista vive nel localStorage con il proprio nome ("visti", "da-vedere", "serie-viste", "episodi-visti", "posseduti:…"), così il sito funziona anche
// senza account. Con l'account collegato ogni cambio va anche in una coda inviata all'API, e a ogni pagina le liste locali
// vengono riallineate a quelle del server (più i cambi ancora in coda). Ogni cambio è annunciato con TICK_EVENT.

import { ApiError, api, cachedAccount, setCachedAccount } from './account';

export const TICK_EVENT = 'spunte:cambio';
/** Stesso schema di LIST_PATTERN in public/api/_inc/app.php. */
const STORE_PATTERN = /^(visti|da-vedere|serie-viste|episodi-visti|posseduti:[a-z0-9-]{1,60})$/;
const QUEUE = 'spunte:coda';

export interface TickChange {
  store: string;
  key: string;
  on: boolean;
}
export type TickLists = Record<string, string[]>;
interface QueuedChange {
  lista: string;
  chiave: string;
  on: boolean;
}

export const isTickStore = (name: string) => STORE_PATTERN.test(name);

// Copia in memoria: se il localStorage non è disponibile (es. navigazione privata) le spunte valgono solo per questa visita.
const memory = new Map<string, Set<string>>();

function readJson<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(name);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(name: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(name);
    else localStorage.setItem(name, JSON.stringify(value));
  } catch {
    // Storage non disponibile: resta la copia in memoria.
  }
}

/** Spunte di una lista (rilette ogni volta: potrebbero essere cambiate in un'altra scheda del browser). */
export function getTicks(store: string): Set<string> {
  const saved = readJson<string[] | null>(store, null);
  if (saved) memory.set(store, new Set(saved));
  return new Set(memory.get(store) ?? []);
}

function saveTicks(store: string, keys: Set<string>) {
  memory.set(store, keys);
  writeJson(store, keys.size ? [...keys] : null);
}

/** Nomi delle liste presenti in questo browser. */
function localStores(): string[] {
  const names = new Set(memory.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name && isTickStore(name)) names.add(name);
    }
  } catch {
    // Storage non disponibile.
  }
  return [...names];
}

export function localTicks(): TickLists {
  const lists: TickLists = {};
  for (const store of localStores()) {
    const keys = getTicks(store);
    if (keys.size) lists[store] = [...keys];
  }
  return lists;
}

function announce(changes: TickChange[]) {
  for (const detail of changes) document.dispatchEvent(new CustomEvent<TickChange>(TICK_EVENT, { detail }));
}

/** Sostituisce le liste locali con quelle date e annuncia solo le spunte cambiate. */
function replaceLocal(lists: Record<string, Set<string>>) {
  const changes: TickChange[] = [];
  for (const store of new Set([...localStores(), ...Object.keys(lists)])) {
    const before = getTicks(store);
    const after = lists[store] ?? new Set<string>();
    for (const key of after) if (!before.has(key)) changes.push({ store, key, on: true });
    for (const key of before) if (!after.has(key)) changes.push({ store, key, on: false });
    saveTicks(store, after);
  }
  announce(changes);
}

/** Liste del server con sopra i cambi non ancora inviati (funzione pura, per i test). */
export function applyQueue(server: TickLists, queue: readonly QueuedChange[]): Record<string, Set<string>> {
  const lists: Record<string, Set<string>> = {};
  for (const [store, keys] of Object.entries(server)) lists[store] = new Set(keys);
  for (const { lista, chiave, on } of queue) {
    const keys = (lists[lista] ??= new Set());
    if (on) keys.add(chiave);
    else keys.delete(chiave);
  }
  return lists;
}

// --- Sincronizzazione con l'account -------------------------------------------------------------------------------

const readQueue = () => readJson<QueuedChange[]>(QUEUE, []);
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushing: Promise<boolean> | null = null;

/** Sessione scaduta o chiusa altrove: si torna alle sole spunte locali (rimandate al server al prossimo accesso). */
function signedOut() {
  writeJson(QUEUE, null);
  setCachedAccount(null);
}

/** Invia i cambi in coda. Restituisce false se non è stato possibile (rete assente, sessione scaduta). */
export function flushTicks(): Promise<boolean> {
  clearTimeout(flushTimer);
  flushing ??= (async () => {
    const queue = readQueue();
    if (!queue.length || !cachedAccount()) return true;
    try {
      await api('spunte', { modifiche: queue }, { keepalive: true });
      // Toglie dalla coda solo quello che è stato inviato: altri cambi possono essere arrivati nel frattempo.
      writeJson(QUEUE, readQueue().slice(queue.length));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) signedOut();
      return false;
    }
  })().finally(() => (flushing = null));
  return flushing;
}

export function setTick(store: string, key: string, on: boolean) {
  setTicks(store, [key], on);
}

/** Più spunte della stessa lista in una volta (es. tutti gli episodi di una stagione): una sola scrittura e un solo invio. */
export function setTicks(store: string, keys: readonly string[], on: boolean) {
  const current = getTicks(store);
  const changed = keys.filter((key) => current.has(key) !== on);
  if (!changed.length) return;
  for (const key of changed) {
    if (on) current.add(key);
    else current.delete(key);
  }
  saveTicks(store, current);
  announce(changed.map((key) => ({ store, key, on })));
  if (cachedAccount()) {
    writeJson(QUEUE, [...readQueue(), ...changed.map((key) => ({ lista: store, chiave: key, on }))]);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushTicks, 400);
  }
}

/** Riallinea le liste locali a quelle dell'account (dopo aver inviato i cambi in coda). */
export async function pullTicks(): Promise<void> {
  if (!cachedAccount() || !(await flushTicks())) return;
  try {
    const { liste } = await api<{ liste: TickLists }>('spunte');
    replaceLocal(applyQueue(liste, readQueue()));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) signedOut();
  }
}

/** Unisce le liste date (spunte di questo browser dopo l'accesso, o un file importato) a quelle dell'account. */
export async function mergeTicks(lists: TickLists): Promise<void> {
  const valid: TickLists = {};
  for (const [store, keys] of Object.entries(lists)) {
    if (isTickStore(store) && Array.isArray(keys)) valid[store] = keys.filter((k) => typeof k === 'string' && k !== '');
  }
  if (!cachedAccount()) {
    // Senza account l'unione resta in questo browser.
    const merged: Record<string, Set<string>> = {};
    for (const store of new Set([...localStores(), ...Object.keys(valid)])) merged[store] = new Set([...getTicks(store), ...(valid[store] ?? [])]);
    replaceLocal(merged);
    return;
  }
  await flushTicks();
  const { liste } = await api<{ liste: TickLists }>('spunte', { unisci: valid });
  replaceLocal(applyQueue(liste, readQueue()));
}

/** Dopo l'uscita dall'account le spunte vengono tolte da questo browser (restano salvate nell'account). */
export function clearTicks() {
  writeJson(QUEUE, null);
  replaceLocal({});
}

/** Account eliminato: le spunte restano in questo browser, i cambi in coda non hanno più dove andare. */
export function dropQueue() {
  writeJson(QUEUE, null);
}

let lastPull = 0;
/** Avvio su ogni pagina: riallinea le spunte all'account e le invia di nuovo quando torna la rete. */
export function startSync() {
  const pull = () => {
    lastPull = Date.now();
    void pullTicks();
  };
  pull();
  // Tornando su una scheda rimasta aperta (magari dopo aver spuntato qualcosa su un altro dispositivo).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastPull > 60_000) pull();
  });
  addEventListener('online', () => void flushTicks());
}
