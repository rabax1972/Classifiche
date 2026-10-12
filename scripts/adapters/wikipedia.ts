// Wikipedia in italiano — API MediaWiki (https://it.wikipedia.org/w/api.php).
// Contenuti CC BY-SA 4.0: citiamo la pagina di provenienza. User-Agent con contatto, 1 richiesta/secondo.
// Usata per le classifiche annuali ufficiali FIMI (Top Singoli), che FIMI non offre in forma riutilizzabile.

import * as cheerio from 'cheerio';
import type { ChartEntry, OfficialChart } from '../../src/lib/types';
import { fetchJson, HttpError } from '../lib/http';
import { officialExists } from '../lib/store';
import type { SourceAdapter } from './types';

const API = 'https://it.wikipedia.org/w/api.php';

interface ParseResponse {
  parse?: { title: string; text: string };
  error?: { code: string; info: string };
}

export function wikiUrl(title: string) {
  return `https://it.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** HTML renderizzato di una pagina, o null se la pagina non esiste. */
async function pageHtml(title: string): Promise<{ title: string; html: string } | null> {
  const url = `${API}?action=parse&format=json&formatversion=2&prop=text&redirects=1&page=${encodeURIComponent(title)}`;
  const res = await fetchJson<ParseResponse>(url);
  if (res.error?.code === 'missingtitle') return null;
  if (res.error) throw new Error(`Wikipedia: ${res.error.info}`);
  return { title: res.parse!.title, html: res.parse!.text };
}

function cellText($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]) {
  const c = $(el).clone();
  c.find('sup, .reference, style, .sortkey').remove();
  return c.text().replace(/\s+/g, ' ').trim();
}

/** Converte una tabella HTML in una griglia di testi, espandendo rowspan e colspan. */
export function tableGrid($: cheerio.CheerioAPI, table: Parameters<cheerio.CheerioAPI>[0]): string[][] {
  const grid: string[][] = [];
  const carry: { text: string; left: number }[] = []; // celle con rowspan ancora attive, per colonna
  for (const tr of $(table).find('tr').toArray()) {
    const row: string[] = [];
    const cells = $(tr).children('th, td').toArray();
    let col = 0;
    const fillCarried = () => {
      while (carry[col] && carry[col]!.left > 0) {
        row[col] = carry[col]!.text;
        carry[col]!.left--;
        col++;
      }
    };
    for (const cell of cells) {
      fillCarried();
      const text = cellText($, cell);
      const rowspan = Number($(cell).attr('rowspan')) || 1;
      const colspan = Number($(cell).attr('colspan')) || 1;
      for (let k = 0; k < colspan; k++) {
        row[col] = text;
        carry[col] = { text, left: rowspan - 1 };
        col++;
      }
    }
    fillCarried();
    grid.push(row);
  }
  return grid;
}

/**
 * Estrae la classifica dalla prima tabella con colonne posizione / titolo / artista.
 * Restituisce le righe nell'ordine della tabella.
 */
export function parseSinglesTable(html: string, source: string, pageUrl: string): ChartEntry[] {
  const $ = cheerio.load(html);
  for (const table of $('table.wikitable').toArray()) {
    const [head = [], ...rows] = tableGrid($, table);
    const headers = head.map((h) => h.toLowerCase());
    const iTitle = headers.findIndex((h) => h.startsWith('titolo') || h === 'brano' || h === 'singolo');
    const iArtist = headers.findIndex((h) => h.startsWith('artist') || h.startsWith('interpret'));
    if (iTitle < 0 || iArtist < 0) continue;

    const entries: ChartEntry[] = [];
    for (const cells of rows) {
      const rank = Number.parseInt(cells[0] ?? '', 10);
      const title = (cells[iTitle] ?? '').replace(/^"|"$/g, '');
      const artist = cells[iArtist] ?? '';
      if (!Number.isFinite(rank) || !title) continue;
      entries.push({ rank, title, subtitle: artist || null, cover: null, source, sourceUrl: pageUrl, externalId: null });
    }
    if (entries.length > 0) return entries;
  }
  return [];
}

export function singlesPageTitle(year: number) {
  return `Classifica dei singoli più venduti in Italia nel ${year}`;
}

export const wikipediaFimi: SourceAdapter = {
  id: 'wikipedia-fimi',
  async fetchOfficial(ctx) {
    const current = Number(ctx.today.slice(0, 4));
    // Seed: ultimi 5 anni. Run giornaliere: solo l'anno appena concluso, finché non compare.
    const years = ctx.seed ? [1, 2, 3, 4, 5].map((n) => current - n) : [current - 1];
    const out: OfficialChart[] = [];
    for (const year of years) {
      if (!ctx.seed && (await officialExists('canzoni', 'year', String(year)))) continue;
      let page;
      try {
        page = await pageHtml(singlesPageTitle(year));
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) page = null;
        else throw e;
      }
      if (!page) {
        ctx.log(`  pagina annuale ${year} non ancora disponibile`);
        continue;
      }
      const url = wikiUrl(page.title);
      const entries = parseSinglesTable(page.html, this.id, url);
      if (entries.length < 10) throw new Error(`Tabella non riconosciuta in "${page.title}" (${entries.length} righe)`);
      out.push({
        category: 'canzoni',
        source: this.id,
        periodType: 'year',
        periodKey: String(year),
        periodLabel: `Anno ${year} (Top Singoli FIMI)`,
        url,
        fetchedAt: new Date().toISOString(),
        entries: entries.slice(0, 100),
      });
    }
    return out;
  },
};
