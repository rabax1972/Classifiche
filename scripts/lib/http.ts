// Client HTTP per le fonti: timeout, retry con backoff, rate limit per host e cache su disco.

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const USER_AGENT = `ClassificheItalia/0.1 (+${process.env.CLASSIFICHE_CONTACT || 'https://github.com/'}; aggregatore non commerciale)`;

const CACHE_DIR = path.resolve('.cache/http');

/** Intervallo minimo tra due richieste allo stesso host (ms). */
const HOST_INTERVAL: Record<string, number> = {
  'api.themoviedb.org': 100,
  'it.wikipedia.org': 1000,
  'ws.audioscrobbler.com': 250,
  'rss.marketingtools.apple.com': 1000,
  'itunes.apple.com': 3000,
  'musicbrainz.org': 1500,
  'openlibrary.org': 1000,
};
const DEFAULT_INTERVAL = 1000;
const lastRequestAt = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle(host: string) {
  const interval = HOST_INTERVAL[host] ?? DEFAULT_INTERVAL;
  const wait = (lastRequestAt.get(host) ?? 0) + interval - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    body: string,
  ) {
    super(`HTTP ${status} da ${redact(url)}: ${body.slice(0, 200)}`);
  }
}

/** Nasconde le chiavi API negli URL scritti nei log. */
export function redact(url: string): string {
  return url.replace(/(api_key|apikey|key|token)=[^&]+/gi, '$1=***');
}

export interface FetchOptions {
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  /** Se impostato, la risposta viene salvata in .cache/http e riusata per questo intervallo. */
  cacheTtlMs?: number;
}

function isRetryable(status: number) {
  return status === 429 || status >= 500;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  return (await fetchBody(url, opts)).toString('utf8');
}

/** Come fetchText, ma restituisce i byte (es. archivi .gz). */
export async function fetchBuffer(url: string, opts: FetchOptions = {}): Promise<Buffer> {
  return fetchBody(url, opts);
}

async function fetchBody(url: string, opts: FetchOptions): Promise<Buffer> {
  const { headers = {}, retries = 3, timeoutMs = 30_000, cacheTtlMs } = opts;

  const cacheFile = cacheTtlMs
    ? path.join(CACHE_DIR, createHash('sha1').update(url + JSON.stringify(headers)).digest('hex'))
    : null;
  if (cacheFile) {
    const s = await stat(cacheFile).catch(() => null);
    if (s && Date.now() - s.mtimeMs < cacheTtlMs!) return readFile(cacheFile);
  }

  const host = new URL(url).host;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(30_000, 1000 * 2 ** attempt));
    await throttle(host);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = Buffer.from(await res.arrayBuffer());
      if (!res.ok) {
        const err = new HttpError(res.status, url, body.toString('utf8'));
        if (!isRetryable(res.status)) throw err;
        const retryAfter = Number(res.headers.get('retry-after'));
        if (retryAfter > 0) await sleep(Math.min(60, retryAfter) * 1000);
        lastError = err;
        continue;
      }
      if (cacheFile) {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(cacheFile, body);
      }
      return body;
    } catch (e) {
      if (e instanceof HttpError && !isRetryable(e.status)) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Risposta non JSON da ${redact(url)}`);
  }
}
