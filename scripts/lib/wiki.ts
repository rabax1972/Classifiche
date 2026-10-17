// Testi presi da Wikipedia per le schede di brani e artisti.

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
