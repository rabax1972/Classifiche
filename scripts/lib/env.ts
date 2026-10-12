// Carica .env in locale (in GitHub Actions le chiavi arrivano dai secrets).

import { existsSync } from 'node:fs';

export function loadEnv() {
  if (existsSync('.env')) process.loadEnvFile('.env');
}
