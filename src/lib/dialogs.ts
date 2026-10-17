// Modali delle schede (brani e artisti, libri e autori, film e registi), lato client: una sola aperta alla volta, link diretto
// nell'URL (#brano=… / #artista=… / #libro=… / #autore=… / #film=… / #regista=…) e, alla chiusura, focus restituito al pulsante della classifica che l'ha aperta.

import { artistKey, splitArtists } from './aggregate';

let opener: HTMLElement | null = null;

interface DialogOptions {
  dialog: HTMLDialogElement;
  /** Nome del parametro nell'URL e dell'attributo data-* dei pulsanti che aprono la modale. */
  name: 'brano' | 'artista' | 'libro' | 'autore' | 'film' | 'regista';
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

  const linked = location.hash.match(new RegExp(`^#${name}=(.+)$`))?.[1];
  if (linked) {
    const key = decodeURIComponent(linked);
    const btn = [...document.querySelectorAll<HTMLElement>(`.${trigger}`)].find((b) => b.dataset[name] === key) ?? null;
    show(key, btn);
  }
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
  { trigger, name }: { trigger: string; name: 'artista' | 'autore' | 'regista' } = { trigger: 'artist-open', name: 'artista' },
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
