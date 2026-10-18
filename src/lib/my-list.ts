// Pezzi comuni delle liste personali costruite lato client (src/components/MyMovies.astro, MySeries.astro, MyBooks.astro):
// elementi della riga (copertina, voto, servizi) e filtri a scelta multipla.

import type { ImdbRating, RottenRating, WatchProvider } from './types';

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** Preferenze dell'utente nel localStorage (es. l'ordinamento scelto), senza errori se non è disponibile. */
export const pref = {
  get(key: string) {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage non disponibile (es. navigazione privata).
    }
  },
};

/** Valori nulli in fondo, qualunque sia la direzione. */
export const nullsLast = <T extends number | string>(a: T | null, b: T | null, dir: 1 | -1) =>
  a == null ? (b == null ? 0 : 1) : b == null ? -1 : (a < b ? -1 : a > b ? 1 : 0) * dir;

/** Copertina o locandina; senza immagine (o se non si carica) resta il riquadro grigio. */
export function coverBox(url: string | null, size = 'h-21 w-14 sm:h-30 sm:w-20') {
  const box = el('div', `${size} shrink-0 overflow-hidden rounded bg-gray-200 ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10`);
  if (url) {
    const img = el('img', 'h-full w-full object-cover');
    Object.assign(img, { src: url, alt: '', width: 80, height: 120, loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
  return box;
}

const STAR =
  '<svg class="h-3.5 w-3.5 text-amber-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"></path></svg>';

/** Voto medio TMDB (su 10) con il numero di voti nel suggerimento. */
export function voteBadge(vote: number, votes: number) {
  const badge = el(
    'span',
    'inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-900 tabular-nums ring-1 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-900',
  );
  badge.title = `Voto medio su TMDB (${votes.toLocaleString('it-IT')} voti)`;
  badge.innerHTML = `${STAR}<span class="sr-only">Voto TMDB</span>`;
  badge.append(vote.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  return badge;
}

/** Loghi dei servizi in abbonamento (al massimo 4, poi "+N"). */
export function providerBox(providers: readonly WatchProvider[]) {
  const names = providers.map((p) => p.name).join(', ');
  const box = el('span', 'inline-flex items-center gap-1');
  box.title = `In abbonamento su ${names}`;
  box.append(el('span', 'sr-only', `In abbonamento su ${names}`));
  for (const p of providers.slice(0, 4)) {
    if (p.logo) {
      const img = el('img', 'h-6 w-6 rounded-md ring-1 ring-black/10 dark:ring-white/10');
      Object.assign(img, { src: p.logo, alt: '', width: 24, height: 24, loading: 'lazy', referrerPolicy: 'no-referrer' });
      box.append(img);
    } else box.append(el('span', 'rounded-md bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800', p.name));
  }
  if (providers.length > 4) {
    const extra = el('span', 'text-xs text-gray-600 dark:text-gray-400', `+${providers.length - 4}`);
    extra.setAttribute('aria-hidden', 'true');
    box.append(extra);
  }
  return box;
}

/** Voti IMDb e Rotten Tomatoes di un film (scripts/movie-ratings.ts). */
export interface ExtraRatings {
  imdbId?: string | null;
  imdb?: ImdbRating | null;
  rt?: RottenRating | null;
}

const dayFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Collegamento a forma di etichetta (voto IMDb o Rotten Tomatoes), o etichetta semplice senza indirizzo. */
function ratingLink(url: string | null | undefined, className: string, title: string) {
  const badge = el(url ? 'a' : 'span', className);
  badge.title = title;
  if (url && badge instanceof HTMLAnchorElement) Object.assign(badge, { href: url, rel: 'noopener', target: '_blank' });
  return badge;
}

/** Voto IMDb (giallo) e Tomatometer di Rotten Tomatoes (rosso se almeno 60%, verde sotto), come nelle righe delle classifiche. */
export function ratingBadges({ imdbId, imdb, rt }: ExtraRatings): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (imdb) {
    const b = ratingLink(
      imdbId ? `https://www.imdb.com/it/title/${imdbId}/` : null,
      'inline-flex items-center gap-1 rounded-md bg-yellow-300 px-1.5 py-0.5 text-xs font-semibold text-black tabular-nums hover:bg-yellow-200',
      `Voto medio su IMDb (${imdb.votes.toLocaleString('it-IT')} voti)`,
    );
    b.append(el('span', 'font-extrabold tracking-tight', 'IMDb'), imdb.value.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    out.push(b);
  }
  if (rt) {
    const b = ratingLink(
      rt.url,
      `inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums hover:opacity-85 ${rt.score >= 60 ? 'bg-red-600' : 'bg-lime-700'}`,
      `Tomatometer di Rotten Tomatoes: ${rt.score}% di recensioni positive${rt.date ? ` (dato Wikidata del ${dayFmt.format(new Date(`${rt.date}T00:00:00Z`))})` : ''}`,
    );
    b.append(el('span', 'sr-only', 'Rotten Tomatoes '), `${rt.score}%`);
    out.push(b);
  }
  return out;
}

/** Riga con voti e servizi, se c'è almeno uno dei due. */
export function voteAndProviders(vote: number | null, votes: number, providers: readonly WatchProvider[], extra: ExtraRatings = {}) {
  const badges = ratingBadges(extra);
  if (!vote && !providers.length && !badges.length) return null;
  const line = el('div', 'mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5');
  line.append(...badges);
  if (vote) line.append(voteBadge(vote, votes));
  if (providers.length) line.append(providerBox(providers));
  return line;
}

/** Valori scelti in un menu a scelta multipla (<details data-multi>). */
export const chosen = (m: HTMLDetailsElement) => [...m.querySelectorAll<HTMLButtonElement>('[aria-pressed=true]')].map((b) => b.dataset.value!);

/** Voci di un menu a scelta multipla, dalla più frequente, con il conteggio; le scelte già fatte restano. */
export function fillMulti(m: HTMLDetailsElement, values: readonly { name: string; logo: string | null }[], onChange: () => void) {
  const picked = new Set(chosen(m));
  const counts = new Map<string, { n: number; logo: string | null }>();
  for (const v of values) counts.set(v.name, { n: (counts.get(v.name)?.n ?? 0) + 1, logo: v.logo ?? counts.get(v.name)?.logo ?? null });
  m.querySelector('[data-options]')!.replaceChildren(
    ...[...counts]
      .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0], 'it'))
      .map(([name, { n, logo }]) => {
        const li = el('li');
        const btn = el(
          'button',
          `inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-gray-300 py-1 text-sm hover:bg-gray-50 aria-pressed:border-indigo-600 aria-pressed:bg-indigo-600 aria-pressed:text-white dark:border-gray-700 dark:hover:bg-gray-800 dark:aria-pressed:border-indigo-500 dark:aria-pressed:bg-indigo-500 ${logo ? 'pr-3 pl-1' : 'px-3'}`,
        );
        btn.type = 'button';
        btn.dataset.value = name;
        btn.setAttribute('aria-pressed', String(picked.has(name)));
        if (logo) {
          const img = el('img', 'h-[22px] w-[22px] rounded-full');
          Object.assign(img, { src: logo, alt: '', width: 22, height: 22, loading: 'lazy', referrerPolicy: 'no-referrer' });
          btn.append(img);
        }
        btn.append(`${name} (${n})`);
        btn.addEventListener('click', () => {
          btn.setAttribute('aria-pressed', String(btn.getAttribute('aria-pressed') !== 'true'));
          onChange();
        });
        li.append(btn);
        return li;
      }),
  );
}

/** Etichetta del menu: "Tutti i …", il valore scelto o "valore +N". */
export function multiLabel(m: HTMLDetailsElement) {
  const values = chosen(m);
  m.querySelector('[data-multi-label]')!.textContent = values.length === 0 ? m.dataset.all! : values.length === 1 ? values[0]! : `${values[0]} +${values.length - 1}`;
}

/** Menu a scelta multipla chiusi con un clic fuori o con Esc (il focus torna sul menu). */
export function closeMultisOutside(root: HTMLElement, multis: HTMLDetailsElement[]) {
  document.addEventListener('click', (ev) => {
    for (const m of multis) if (m.open && !m.contains(ev.target as Node)) m.open = false;
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const open = multis.find((m) => m.open);
    if (open) {
      open.open = false;
      open.querySelector('summary')!.focus();
    }
  });
}

/** Rimanda `fn` di poco e la esegue una volta sola per una raffica di chiamate (es. le spunte riallineate dall'account). */
export function batched(fn: () => void, ms = 50) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

/** Liste di un profilo pubblico mostrate nella pagina /utenti/ (detail: { liste }), al posto delle spunte di chi guarda. */
export const PUBLIC_LISTS_EVENT = 'liste:pubbliche';
let publicLists: Record<string, string[]> | null = null;

/** La pagina /utenti/ consegna le liste del profilo aperto ai componenti in sola lettura (anche a quelli non ancora pronti). */
export function showPublicLists(liste: Record<string, string[]>) {
  publicLists = liste;
  document.dispatchEvent(new CustomEvent(PUBLIC_LISTS_EVENT, { detail: { liste } }));
}

export interface TickSource {
  /** Spunte di una lista (es. "visti"). */
  get(store: string): Set<string>;
  /** Liste di un altro utente: niente caselle da spuntare. */
  readOnly: boolean;
  /** Pronta quando ci sono le spunte da mostrare (subito per le proprie). */
  ready: Promise<void>;
}

/**
 * Da dove prendere le spunte della lista: le proprie (src/lib/ticks.ts) o, se il componente ha data-readonly, quelle di un
 * profilo pubblico che la pagina /utenti/ consegna con showPublicLists().
 */
export function tickSource(root: HTMLElement, own: (store: string) => Set<string>): TickSource {
  if (!('readonly' in root.dataset)) return { get: own, readOnly: false, ready: Promise.resolve() };
  const ready = publicLists
    ? Promise.resolve()
    : new Promise<void>((resolve) => document.addEventListener(PUBLIC_LISTS_EVENT, () => resolve(), { once: true }));
  return { get: (store) => new Set(publicLists?.[store] ?? []), readOnly: true, ready };
}

/** Esegue `start` quando il componente diventa visibile: subito, o all'apertura della scheda (.views-panel) che lo contiene. */
export function whenVisible(root: HTMLElement, start: () => void) {
  const panel = root.closest<HTMLElement>('.views-panel');
  if (!panel) return start();
  new MutationObserver(() => {
    if (!panel.hidden) start();
  }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  if (!panel.hidden) start();
}
