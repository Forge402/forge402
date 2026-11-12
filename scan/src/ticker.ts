// A "ticker" for spotting copies. Copycat tokens differ in case, spacing and punctuation, not in letters:
// "Wiener", "WIENER ", "W.I.N.E.R" and a full-width "ＷＩＮＥＲ" all become the same string.
// ponytail: it does not map look-alike letters (0 for O, l for I). Add that when copies using them show up in data.
export function normalizeTicker(raw: string): string | null {
  const t = raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  return t.length > 0 && t.length <= 32 ? t : null;
}
