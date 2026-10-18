// Distribuzione per Aruba: build del sito per https://www.giacomorabaglia.com/classifiche/ e copia in aruba/classifiche/,
// pronta da caricare con FileZilla nella cartella /classifiche del dominio.
//
// Per non ricaricare ogni volta tutto, mette in aruba/modifiche/ solo i file nuovi o cambiati rispetto all'ultima pubblicazione
// confermata (impronte dei file in aruba/pubblicato.json) e in aruba/da-eliminare.txt quelli che non servono più. Finché una
// pubblicazione non viene confermata, le modifiche si sommano: aruba/modifiche/ contiene sempre tutto quello che manca sul server.
//
//   npm run dist:aruba                 build con i dati presenti nel repository
//   npm run dist:aruba -- --update     prima aggiorna i dati (come il cron: richiede le chiavi nel .env)
//   npm run dist:aruba -- --conferma   dopo il caricamento: segna come pubblicata l'ultima build (distribuzione-aruba.cmd lo chiede)
//   npm run dist:aruba -- --tutto      dimentica le pubblicazioni precedenti: aruba/modifiche/ conterrà tutti i file

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SITE_URL = 'https://www.giacomorabaglia.com';
const BASE_PATH = '/classifiche';
const ARUBA = path.resolve('aruba');
const OUT = path.join(ARUBA, 'classifiche');
const CHANGES = path.join(ARUBA, 'modifiche');
const REMOVED = path.join(ARUBA, 'da-eliminare.txt');
/** Impronte dei file dell'ultima pubblicazione confermata (percorso relativo → sha1). */
const MANIFEST = path.join(ARUBA, 'pubblicato.json');

const run = (cmd: string, env: Record<string, string> = {}) =>
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

/** Impronta di ogni file della cartella, con i percorsi relativi separati da "/". */
function fingerprints(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) fingerprints(full, base, out);
    else out[path.relative(base, full).split(path.sep).join('/')] = createHash('sha1').update(readFileSync(full)).digest('hex');
  }
  return out;
}

/**
 * Svuota la cartella senza eliminarla: Windows non permette di eliminare una cartella aperta in Esplora risorse o in FileZilla
 * (che è proprio come la si usa). Quello che resta bloccato viene segnalato, non interrompe la distribuzione.
 */
function emptyDir(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    try {
      rmSync(path.join(dir, f), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      console.warn(`Non riesco a eliminare ${path.join(dir, f)}: chiudi le finestre che lo usano ed eliminalo a mano.`);
    }
  }
}

function readManifest(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

if (process.argv.includes('--conferma')) {
  if (!existsSync(OUT)) throw new Error(`Nessuna build in ${OUT}: lancia prima npm run dist:aruba.`);
  writeFileSync(MANIFEST, JSON.stringify(fingerprints(OUT), null, 1));
  emptyDir(CHANGES);
  rmSync(REMOVED, { force: true });
  console.log('Pubblicazione confermata: la prossima distribuzione conterrà solo i file cambiati da adesso.');
  process.exit(0);
}

if (process.argv.includes('--tutto')) rmSync(MANIFEST, { force: true });
if (process.argv.includes('--update')) run('npm run update');

console.log(`\nBuild per ${SITE_URL}${BASE_PATH}/ …`);
run('npm run build', { SITE_URL, BASE_PATH });

rmSync(OUT, { recursive: true, force: true });
cpSync('dist', OUT, { recursive: true });
if (!existsSync(path.join(OUT, '.htaccess'))) throw new Error('.htaccess mancante nella build');
if (!existsSync(path.join(OUT, 'api', 'index.php'))) throw new Error('API degli account (api/index.php) mancante nella build');

// Solo i file nuovi o cambiati rispetto all'ultima pubblicazione confermata.
const now = fingerprints(OUT);
const published = readManifest();
const changed = Object.keys(now).filter((f) => published[f] !== now[f]);
const removed = Object.keys(published).filter((f) => !(f in now));
emptyDir(CHANGES);
for (const f of changed) {
  const to = path.join(CHANGES, ...f.split('/'));
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(path.join(OUT, ...f.split('/')), to);
}
if (removed.length) writeFileSync(REMOVED, `File da eliminare dalla cartella /classifiche del sito (non servono più):\r\n\r\n${removed.join('\r\n')}\r\n`);
else rmSync(REMOVED, { force: true });

const first = !Object.keys(published).length;
console.log(`\nDistribuzione completa in ${OUT} (${Object.keys(now).length} file).`);
console.log(
  first
    ? `Prima pubblicazione con questo sistema: ${CHANGES} contiene tutti i file.`
    : `Da caricare: ${changed.length} file nuovi o cambiati in ${CHANGES}` + (removed.length ? `; ${removed.length} da eliminare (elenco in ${REMOVED}).` : '.'),
);
console.log(`Con FileZilla carica il contenuto di aruba/modifiche (compreso l'eventuale file nascosto .htaccess) nella cartella /classifiche del dominio,`);
console.log(`sovrascrivendo i file esistenti; poi conferma con: npm run dist:aruba -- --conferma`);
console.log(`Il database degli account (mdb-database/classifiche.sqlite nella radice del dominio) non fa parte della distribuzione: non toccarlo.`);
