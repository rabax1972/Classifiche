// Distribuzione per Aruba: build del sito per https://www.giacomorabaglia.com/classifiche/ e copia in aruba/classifiche/,
// pronta da caricare con FileZilla nella cartella /classifiche del dominio (sostituendo il contenuto precedente).
//
//   npm run dist:aruba                 build con i dati presenti nel repository
//   npm run dist:aruba -- --update     prima aggiorna i dati (come il cron: richiede le chiavi nel .env)

import { execSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const SITE_URL = 'https://www.giacomorabaglia.com';
const BASE_PATH = '/classifiche';
const OUT = path.resolve('aruba', 'classifiche');

const run = (cmd: string, env: Record<string, string> = {}) =>
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

if (process.argv.includes('--update')) run('npm run update');

console.log(`\nBuild per ${SITE_URL}${BASE_PATH}/ …`);
run('npm run build', { SITE_URL, BASE_PATH });

rmSync(OUT, { recursive: true, force: true });
cpSync('dist', OUT, { recursive: true });
if (!existsSync(path.join(OUT, '.htaccess'))) throw new Error('.htaccess mancante nella build');

const count = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce((n, f) => n + (f.isDirectory() ? count(path.join(dir, f.name)) : 1), 0);
console.log(`\nDistribuzione pronta in ${OUT} (${count(OUT)} file).`);
console.log(`Con FileZilla carica tutto il contenuto, compreso il file nascosto .htaccess, nella cartella /classifiche del dominio.`);
