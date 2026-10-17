// Account degli utenti, lato client: chiamate all'API PHP (public/api/index.php, sullo stesso dominio del sito)
// e utente collegato ricordato nel localStorage, così l'intestazione e le spunte non aspettano il server.

export interface Account {
  email: string;
}

export const ACCOUNT_EVENT = 'account:cambio';
const STORAGE = 'account';
const API = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/index.php`;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Chiamata all'API: GET senza corpo, POST con corpo JSON. Gli errori arrivano come ApiError con un messaggio da mostrare. */
export async function api<T>(action: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}?a=${encodeURIComponent(action)}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
    });
  } catch {
    throw new ApiError('Connessione non riuscita: controlla la rete e riprova.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { errore?: string; codice?: string };
  if (!res.ok) throw new ApiError(data.errore ?? `Errore del server (${res.status}).`, res.status, data.codice);
  return data;
}

/** Utente collegato secondo l'ultima risposta del server (può essere scaduto: lo dirà il prossimo 401). */
export function cachedAccount(): Account | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

export function setCachedAccount(account: Account | null) {
  try {
    if (account) localStorage.setItem(STORAGE, JSON.stringify(account));
    else localStorage.removeItem(STORAGE);
  } catch {
    // Storage non disponibile: l'account vale solo per questa pagina.
  }
  document.dispatchEvent(new CustomEvent<Account | null>(ACCOUNT_EVENT, { detail: account }));
}
