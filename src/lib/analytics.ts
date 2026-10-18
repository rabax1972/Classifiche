// Google Analytics (GA4) solo con il consenso del visitatore (GDPR ed ePrivacy: i cookie statistici di terze parti vanno
// accettati PRIMA di essere installati). Il banner (#consenso-statistiche in src/layouts/Base.astro) esiste solo nella build
// pubblicata con GA_MEASUREMENT_ID nel .env; lo script di Google si carica solo dopo "Accetta" e solo sul dominio del sito.
// La scelta resta nel localStorage (non in un cookie) e si può cambiare dal link "Preferenze cookie" nel footer.

const KEY = 'consenso-statistiche';

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    [disable: `ga-disable-${string}`]: boolean | undefined;
  }
}

function readChoice(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // senza localStorage il banner si ripropone a ogni visita: nessun consenso, nessun tracciamento
  }
}

function writeChoice(value: 'si' | 'no') {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Scelta valida solo per questa visita.
  }
}

function loadAnalytics(id: string) {
  window[`ga-disable-${id}`] = false;
  if (document.getElementById('gtag-js')) return;
  const script = document.createElement('script');
  script.id = 'gtag-js';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.append(script);
  window.dataLayer ??= [];
  const gtag: Gtag = function () {
    // gtag.js vuole proprio l'oggetto arguments.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', id);
}

/** Consenso revocato: niente più invii e via i cookie di Analytics (_ga, _ga_…) già installati. */
function stopAnalytics(id: string) {
  window[`ga-disable-${id}`] = true;
  const names = document.cookie
    .split(';')
    .map((c) => c.split('=')[0]!.trim())
    .filter((n) => n === '_ga' || n.startsWith('_ga_'));
  const domains = ['', location.hostname, `.${location.hostname.replace(/^www\./, '')}`];
  for (const name of names) for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
}

export function setupAnalytics() {
  const banner = document.getElementById('consenso-statistiche');
  if (!banner) return;
  const id = banner.dataset.ga!;
  // Solo sul sito pubblicato: le prove in locale non finiscono nelle statistiche.
  if (location.hostname !== banner.dataset.host) return;

  const show = () => {
    banner.hidden = false;
    banner.querySelector<HTMLButtonElement>('[data-accetta]')!.focus();
  };
  const choice = readChoice();
  if (choice === 'si') loadAnalytics(id);
  else if (choice !== 'no') banner.hidden = false;

  banner.querySelector('[data-accetta]')!.addEventListener('click', () => {
    writeChoice('si');
    banner.hidden = true;
    loadAnalytics(id);
  });
  banner.querySelector('[data-rifiuta]')!.addEventListener('click', () => {
    writeChoice('no');
    banner.hidden = true;
    stopAnalytics(id);
  });
  // Footer e pagina Privacy: revocare o dare il consenso deve essere facile quanto la prima scelta.
  for (const b of document.querySelectorAll<HTMLElement>('[data-preferenze-cookie]')) {
    b.hidden = false;
    const box = b.closest<HTMLElement>('[data-preferenze-box]');
    if (box) box.hidden = false;
    b.addEventListener('click', show);
  }
}
