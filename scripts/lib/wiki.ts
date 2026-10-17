// Testi e foto presi da Wikipedia e Wikimedia Commons per le schede di brani, artisti, libri e autori.

import { normalizeText } from '../../src/lib/aggregate';
import type { PersonPhoto, WikiIntro } from '../../src/lib/types';
import { fetchJson } from './http';

const CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };

/** Il primo paragrafo (o i primi, se brevi), tagliato a fine frase entro ~900 caratteri. */
export function trimExtract(text: string, max = 900): string {
  const paras = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  let out = '';
  for (const p of paras) {
    if (out && out.length + p.length > max) break;
    out = out ? `${out}\n\n${p}` : p;
  }
  if (out.length <= max) return out;
  const cut = out.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return end > 200 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

export const wikiUrl = (lang: 'it' | 'en', title: string) => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

type WikiPage = {
  title: string;
  missing?: boolean;
  length?: number;
  extract?: string;
  pageimage?: string;
  thumbnail?: { source: string };
  pageprops?: { disambiguation?: string };
  links?: { title: string }[];
};

interface WikiPages {
  query?: { pages?: WikiPage[]; redirects?: { from: string; to: string }[] };
}

/** "KAROL G" → "Karol G": i titoli di Wikipedia distinguono le maiuscole (tranne la prima lettera). */
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toUpperCase());

/** Le voci richieste; `redirected` sono i titoli raggiunti da un redirect (es. "Michail Bulgakov" → "Michail Afanas'evič Bulgakov"). */
async function wikiPages(lang: 'it' | 'en', titles: string[], props: string) {
  const { query } = await fetchJson<WikiPages>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(titles.join('|'))}&${props}`,
    CACHE,
  );
  return { pages: query?.pages ?? [], redirected: new Set((query?.redirects ?? []).map((r) => r.to)) };
}

const PAGE_PROPS =
  'prop=extracts|pageimages|pageprops|info&exintro=1&explaintext=1&exlimit=max&piprop=thumbnail|name&pithumbsize=480&pilicense=free&ppprop=disambiguation';

export interface PersonKind {
  /** Titoli tipici delle voci, per distinguerle dagli omonimi ("Shiva (rapper)", "Jo Nesbø (scrittore)"). */
  qualifiers: Record<'it' | 'en', string[]>;
  /** Parole che nella prima frase della voce indicano il mestiere cercato. */
  words: Record<'it' | 'en', RegExp>;
}

/** Voce di Wikipedia su una persona (o un gruppo), con l'eventuale immagine a licenza libera. */
export async function wikiPerson(lang: 'it' | 'en', name: string, kind: PersonKind) {
  const want = normalizeText(name);
  const names = [...new Set([name, titleCase(name)])];
  let { pages, redirected } = await wikiPages(lang, names.flatMap((n) => kind.qualifiers[lang].map((q) => (q ? `${n} (${q})` : n))), PAGE_PROPS);

  // Il titolo deve essere il nome cercato, o la voce a cui rimanda (nome completo, grafia diversa).
  const matches = (p: WikiPage) =>
    !p.missing &&
    !p.pageprops &&
    Boolean(p.extract) &&
    (normalizeText(p.title.replace(/\s*\(.*\)$/, '')) === want || redirected.has(p.title)) &&
    kind.words[lang].test(p.extract!.slice(0, 300));

  // Nessuna voce con i titoli tipici: prova quelle elencate nelle pagine di disambiguazione
  // (es. "Elisa (cantante 1977)").
  if (!pages.some(matches)) {
    const disambiguation = pages.filter((p) => p.pageprops).map((p) => p.title);
    if (disambiguation.length) {
      const linked = (await wikiPages(lang, disambiguation, 'prop=links&pllimit=max&plnamespace=0')).pages;
      const titles = linked.flatMap((p) => (p.links ?? []).map((l) => l.title).filter((t) => t.startsWith(`${p.title} (`))).slice(0, 50);
      if (titles.length) ({ pages, redirected } = await wikiPages(lang, titles, PAGE_PROPS));
    }
  }

  // Due omonimi dello stesso mestiere: la voce più ampia è, di solito, quella della persona più nota.
  const p = pages.filter(matches).sort((a, b) => (b.length ?? 0) - (a.length ?? 0))[0];
  if (!p) return null;
  const intro: WikiIntro = { lang, title: p.title, url: wikiUrl(lang, p.title), extract: trimExtract(p.extract!) };
  return { intro, image: p.pageimage && p.thumbnail ? { file: p.pageimage, src: p.thumbnail.source } : null };
}

interface CommonsInfo {
  query?: {
    pages?: {
      missing?: boolean;
      imageinfo?: { descriptionurl: string; extmetadata?: Record<string, { value: string } | undefined> }[];
    }[];
  };
}

export const stripHtml = (s: string) =>
  s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

/** Autore e licenza della foto: senza questi dati la foto non viene usata. */
export async function commonsCredit(image: { file: string; src: string }): Promise<PersonPhoto | null> {
  const res = await fetchJson<CommonsInfo>(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&titles=${encodeURIComponent(`File:${image.file}`)}` +
      `&prop=imageinfo&iiprop=extmetadata|url&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl`,
    CACHE,
  );
  const info = res.query?.pages?.[0]?.imageinfo?.[0];
  const meta = info?.extmetadata ?? {};
  const license = meta.LicenseShortName?.value;
  if (!info || !license) return null;
  const author = stripHtml(meta.Artist?.value ?? '');
  return {
    src: image.src,
    page: info.descriptionurl,
    author: author.length > 80 ? `${author.slice(0, 79)}…` : author || 'autore sconosciuto',
    license: stripHtml(license),
    licenseUrl: meta.LicenseUrl?.value ?? null,
  };
}

interface PageProps {
  query?: { pages?: { title: string; pageprops?: { wikibase_item?: string } }[] };
}

interface WikidataClaims {
  claims?: Record<string, { mainsnak?: { datavalue?: { value?: { time?: string } } } }[]>;
}

/**
 * Anno di morte (P570 su Wikidata) delle persone di cui abbiamo la voce di Wikipedia; null se vivente o senza data.
 * Gli anni avanti Cristo sono negativi.
 */
export async function deathYears(intros: WikiIntro[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const lang of ['it', 'en'] as const) {
    const titles = intros.filter((w) => w.lang === lang).map((w) => w.title);
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50);
      const res = await fetchJson<PageProps>(
        `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(batch.join('|'))}`,
        CACHE,
      );
      for (const p of res.query?.pages ?? []) {
        const id = p.pageprops?.wikibase_item;
        if (!id) continue;
        const { claims } = await fetchJson<WikidataClaims>(`https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity=${id}&property=P570`, CACHE);
        const time = claims?.P570?.find((c) => c.mainsnak?.datavalue?.value?.time)?.mainsnak?.datavalue?.value?.time;
        const year = time?.match(/^([+-])0*(\d+)-/);
        out.set(`${lang}:${p.title}`, year ? (year[1] === '-' ? -1 : 1) * Number(year[2]) : null);
      }
    }
  }
  return out;
}
