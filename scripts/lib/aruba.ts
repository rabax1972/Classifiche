// Sito pubblicato su Aruba: indirizzo, impronte dei file e chiamate all'API di pubblicazione (public/api/_inc/aggiornamenti.php).
// Usato da scripts/dist-aruba.ts (distribuzione manuale) e scripts/pubblica-aruba.ts (pubblicazione automatica).

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { USER_AGENT } from './http';

export const SITE_URL = 'https://www.giacomorabaglia.com';
export const BASE_PATH = '/classifiche';
const API = `${SITE_URL}${BASE_PATH}/api/index.php`;

/** Build del sito per Aruba in dist/. */
export function buildForAruba() {
  console.log(`\nBuild per ${SITE_URL}${BASE_PATH}/ …`);
  execSync('npm run build', { stdio: 'inherit', env: { ...process.env, SITE_URL, BASE_PATH } });
}

/** Impronta (sha1, come sha1_file del PHP) di ogni file della cartella, con i percorsi relativi separati da "/". */
export function fingerprints(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) fingerprints(full, base, out);
    else out[path.relative(base, full).split(path.sep).join('/')] = createHash('sha1').update(readFileSync(full)).digest('hex');
  }
  return out;
}

/** Chiamata all'API di pubblicazione con la chiave ARUBA_CHIAVE (chiave_pubblicazione in mdb-database/classifiche-config.php). */
export async function publishApi<T>(action: string, key: string, body?: Buffer): Promise<T> {
  // Richiesta al nostro server, non a una fonte: niente fetchJson (solo GET, con cache e limiti pensati per le fonti).
  const res = await fetch(`${API}?a=${action}`, {
    method: action === 'sito-impronte' ? 'GET' : 'POST',
    headers: { 'X-Chiave': key, 'User-Agent': USER_AGENT, ...(body ? { 'Content-Type': 'application/octet-stream' } : {}) },
    body: body ? new Uint8Array(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { errore?: string };
  if (!res.ok) throw new Error(`${action}: HTTP ${res.status}${data.errore ? ` (${data.errore})` : ''}`);
  return data;
}
