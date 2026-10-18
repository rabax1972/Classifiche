// Modali delle schede (brani e artisti, libri e autori, film e registi, serie e creatori), lato client: una sola aperta alla volta,
// link diretto nell'URL (#brano=… / #artista=… / #libro=… / #autore=… / #film=… / #regista=… / #serie=… / #creatore=…) e, alla chiusura, focus restituito al pulsante della classifica che l'ha aperta.

import { artistKey, splitArtists } from './aggregate';
import type { WatchProvider } from './types';

/** Schede di serie aggiunte alla modale dopo il caricamento (detail: Record<chiave, SeriesCard>), src/components/SeriesDialog.astro. */
export const SERIES_CARDS_EVENT = 'serie:schede';

let opener: HTMLElement | null = null;

interface DialogOptions {
  dialog: HTMLDialogElement;
  /** Nome del parametro nell'URL e dell'attributo data-* dei pulsanti che aprono la modale. */
  name: 'brano' | 'artista' | 'libro' | 'autore' | 'film' | 'regista' | 'serie' | 'creatore';
  /** Classe dei pulsanti che aprono la modale. */
  trigger: string;
  /** Riempie la modale; false se la chiave non è nota. */
  render: (key: string) => boolean;
}

export function setupDialog({ dialog, name, trigger, render }: DialogOptions) {
  const show = (key: string, from: HTMLElement | null) => {
    if (!render(key)) return;
    // Da un'altra modale (es. un brano nella scheda dell'artista) il focus torna comunque alla classifica.
    if (from && !from.closest('dialog')) opener = from;
    for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) if (d !== dialog) d.close();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[data-scroll]')?.scrollTo(0, 0);
    history.replaceState(null, '', `#${name}=${encodeURIComponent(key)}`);
  };

  document.addEventListener('click', (ev) => {
    const btn = (ev.target as Element).closest<HTMLElement>(`.${trigger}`);
    if (btn?.dataset[name]) show(btn.dataset[name], btn);
  });
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  // Clic sullo sfondo (fuori dal riquadro) per chiudere.
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (document.querySelector('dialog[open]')) return;
    history.replaceState(null, '', location.pathname + location.search);
    opener?.focus();
  });

  /** Apre la scheda indicata nell'URL, se c'è (anche più tardi, quando i dati arrivano dopo il caricamento). */
  const openLinked = () => {
    const linked = location.hash.match(new RegExp(`^#${name}=(.+)$`))?.[1];
    if (!linked || dialog.open) return;
    const key = decodeURIComponent(linked);
    const btn = [...document.querySelectorAll<HTMLElement>(`.${trigger}`)].find((b) => b.dataset[name] === key) ?? null;
    show(key, btn);
  };
  openLinked();
  return { openLinked };
}

/** Testo semplice in un elemento, diviso in paragrafi. */
export function setParagraphs(el: HTMLElement, text: string, className = '') {
  el.replaceChildren(
    ...text.split(/\n+/).map((t) => {
      const p = document.createElement('p');
      p.textContent = t;
      if (className) p.className = className;
      return p;
    }),
  );
}

/** I nomi degli artisti (o degli autori) come pulsanti che aprono la loro scheda (stessa divisione della classifica). */
export function setArtistButtons(
  el: HTMLElement,
  subtitle: string | null,
  known: (key: string) => boolean,
  { trigger, name }: { trigger: string; name: 'artista' | 'autore' | 'regista' | 'creatore' } = { trigger: 'artist-open', name: 'artista' },
) {
  el.replaceChildren(
    ...splitArtists(subtitle ?? '', (n) => known(artistKey(n))).map((part, i) => {
      const key = artistKey(part);
      if (i % 2 === 1 || !known(key)) return document.createTextNode(part);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `${trigger} cursor-pointer underline decoration-gray-400 decoration-dotted underline-offset-4 hover:text-indigo-700 hover:decoration-solid dark:hover:text-indigo-300`;
      b.dataset[name] = key;
      b.setAttribute('aria-haspopup', 'dialog');
      b.textContent = part;
      return b;
    }),
  );
}

/** Una riga di "Dove vederlo": etichetta (Abbonamento, Noleggio, Acquisto) e servizi con il logo. */
export function providerRow(label: string, list: WatchProvider[]) {
  const row = document.createElement('div');
  row.className = 'flex flex-wrap items-center gap-2';
  const name = document.createElement('span');
  name.className = 'w-24 shrink-0 text-gray-600 dark:text-gray-400';
  name.textContent = label;
  const ul = document.createElement('ul');
  ul.className = 'flex flex-wrap gap-1.5';
  ul.append(
    ...list.map((p) => {
      const li = document.createElement('li');
      li.className = 'inline-flex items-center gap-1.5 rounded-full bg-gray-100 py-0.5 pr-2.5 pl-0.5 dark:bg-gray-800';
      if (p.logo) {
        const img = document.createElement('img');
        img.src = p.logo;
        img.alt = '';
        img.width = 22;
        img.height = 22;
        img.referrerPolicy = 'no-referrer';
        img.className = 'h-[22px] w-[22px] rounded-full';
        li.append(img);
      } else li.classList.replace('pl-0.5', 'pl-2.5');
      li.append(p.name);
      return li;
    }),
  );
  row.append(name, ul);
  return row;
}
