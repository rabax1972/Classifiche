import type { CategoryId, ChartEntry, OfficialChart } from '../../src/lib/types';

export interface AdapterContext {
  /** Data odierna in Italia (YYYY-MM-DD). */
  today: string;
  /** true durante il popolamento iniziale (`npm run seed`): recupera tutto lo storico disponibile. */
  seed: boolean;
  log: (msg: string) => void;
}

/**
 * Interfaccia comune a tutte le fonti.
 * Un adapter può fornire classifiche giornaliere (snapshot), classifiche ufficiali, o entrambe.
 * Deve lanciare un errore se la fonte non risponde o restituisce dati non validi:
 * l'ingestion lo registra in data/status.json e mantiene l'ultimo snapshot valido.
 */
export interface SourceAdapter {
  /** Deve corrispondere a una chiave di SOURCES in src/lib/sources.ts. */
  id: string;
  /**
   * Variabili d'ambiente necessarie, come alternative: basta che UN gruppo sia tutto valorizzato.
   * Es. [['TMDB_READ_TOKEN'], ['TMDB_API_KEY']]. Se nessun gruppo è soddisfatto, l'adapter viene saltato.
   */
  requiredEnv?: string[][];
  /** Categorie per cui fornisce snapshot giornalieri. */
  dailyCategories?: CategoryId[];
  fetchDaily?(category: CategoryId, ctx: AdapterContext): Promise<ChartEntry[]>;
  /** Restituisce le classifiche ufficiali nuove o aggiornate. */
  fetchOfficial?(ctx: AdapterContext): Promise<OfficialChart[]>;
}

/** Valida e normalizza una lista: scarta righe senza titolo, rinumera in modo contiguo. */
export function cleanEntries(entries: ChartEntry[], limit = 50): ChartEntry[] {
  const clean = entries
    .filter((e) => e.title && e.title.trim().length > 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((e, i) => ({ ...e, title: e.title.trim(), subtitle: e.subtitle?.trim() || null, rank: i + 1 }));
  if (clean.length === 0) throw new Error('La fonte ha restituito una classifica vuota');
  return clean;
}
