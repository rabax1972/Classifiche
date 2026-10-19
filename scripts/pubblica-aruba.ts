// Pubblicazione automatica su Aruba, senza FTP: build del sito, confronto con le impronte dei file che il server serve adesso
// e invio a pezzi di uno zip con quelli nuovi o cambiati, che il server estrae in mdb-database/sito/ (public/api/_inc/aggiornamenti.php).
// La lancia il workflow "Aggiorna classifiche" dopo i dati; si può lanciare anche in locale.
//
//   npm run pubblica:aruba                 build e pubblicazione (serve ARUBA_CHIAVE, nel .env o nei secrets di GitHub)
//   npm run pubblica:aruba -- --no-build   usa la build già in dist/ (fatta con l'indirizzo di Aruba)
//
// Un catalogo delle liste personali si pubblica solo se la build aveva il suo file in privato/: su GitHub il workflow rifà quelli
// di film e serie da Trakt (npm run import:trakt), mentre i libri letti di aNobii (niente API) arrivano solo dal PC. I file che non esistono più non si eliminano: restano raggiungibili ma non collegati.
// Non pubblica api/ né la configurazione del server: per quelli serve la distribuzione manuale (npm run dist:aruba).

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildForAruba, fingerprints, publishApi } from './lib/aruba';
import { loadEnv } from './lib/env';
import { buildSummary } from './lib/riepilogo';
import { createZip, type ZipEntry } from './lib/zip';

/** Pagine generate anche da privato/ (fuori da git) → file da cui dipendono: si pubblicano solo da una build che lo aveva. */
const PRIVATE_OUTPUTS: Record<string, string> = {
  'film/catalogo.json': 'privato/film-visti.json',
  'serie-tv/catalogo.json': 'privato/serie-viste.json',
  'libri/catalogo.json': 'privato/libri-letti.json',
};
/** Certificati delle autorità per le richieste HTTPS del PHP di Aruba (che non li ha), dal sito di curl. */
const CACERT_URL = 'https://curl.se/ca/cacert.pem';

loadEnv();
const key = process.env.ARUBA_CHIAVE?.trim();
if (!key) {
  console.warn('ARUBA_CHIAVE non impostata: pubblicazione su Aruba saltata.');
  process.exit(0);
}

if (!process.argv.includes('--no-build')) buildForAruba();
const DIST = path.resolve('dist');
const publishable = (f: string) =>
  !f.startsWith('api/') && !['.htaccess', 'web.config'].includes(f) && (!PRIVATE_OUTPUTS[f] || existsSync(PRIVATE_OUTPUTS[f]));

const local = fingerprints(DIST);
const remote = await publishApi<{ file: Record<string, string>; pezzo: number }>('sito-impronte', key);
const changed = Object.keys(local).filter((f) => publishable(f) && remote.file[f] !== local[f]);
console.log(`${Object.keys(local).length} file nella build, ${changed.length} nuovi o cambiati rispetto al sito.`);

const entries: ZipEntry[] = changed.map((f) => ({ name: f, data: readFileSync(path.join(DIST, ...f.split('/'))) }));
// Lo zip parte comunque, anche senza file cambiati: porta il riepilogo per l'amministratore (classifiche confrontate con il
// commit PRIMA, impostato dal workflow prima dell'aggiornamento dei dati), aggiorna i certificati e segna la data della pubblicazione.
entries.push({ name: '_riepilogo.json', data: Buffer.from(JSON.stringify(buildSummary(process.env.PRIMA, changed))) });
try {
  const res = await fetch(CACERT_URL);
  if (res.ok) entries.push({ name: '_cacert.pem', data: Buffer.from(await res.arrayBuffer()) });
} catch (err) {
  console.warn(`Certificati non scaricati da ${CACERT_URL}: ${(err as Error).message}`);
}
const zip = createZip(entries);
const id = createHash('sha256').update(zip).digest('hex');
const size = Math.min(remote.pezzo, 4 * 1024 * 1024);
const parts = Math.ceil(zip.length / size);
console.log(`Zip di ${(zip.length / 1048576).toFixed(1)} MB in ${parts} ${parts === 1 ? 'pezzo' : 'pezzi'}…`);
let result: { file?: number } = {};
for (let n = 1; n <= parts; n++) {
  const chunk = zip.subarray((n - 1) * size, n * size);
  for (let attempt = 1; ; attempt++) {
    try {
      result = await publishApi(`sito-carica&id=${id}&parte=${n}&parti=${parts}`, key, chunk);
      break;
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`Pezzo ${n}: ${(err as Error).message}, riprovo…`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}
console.log(`Pubblicati ${result.file ?? 0} file su Aruba.`);
