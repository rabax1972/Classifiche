// Profili pubblici (pagina /utenti/): le liste che un utente può rendere visibili a tutti, come PUBLIC_GROUPS in
// public/api/_inc/app.php (da tenere uguali).

export const PUBLIC_GROUPS = [
  { id: 'film-visti', label: 'Film visti' },
  { id: 'da-vedere', label: 'Film da vedere' },
  { id: 'serie-viste', label: 'Serie viste' },
  { id: 'libri-letti', label: 'Libri letti' },
] as const;

export type PublicGroup = (typeof PUBLIC_GROUPS)[number]['id'];

/** Nome pubblico valido, come PUBLIC_NAME_PATTERN in public/api/_inc/app.php. */
export const PUBLIC_NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]{2,29}$/u;
