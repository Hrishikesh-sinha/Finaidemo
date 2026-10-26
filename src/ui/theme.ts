/**
 * The design tokens, mirrored as literals for anything that cannot read CSS
 * custom properties (Recharts gradient stops, canvas, inline SVG attributes
 * built from data). The values here must match the @theme block in index.css;
 * that file is the source of truth and carries the validation notes.
 */

export const C = {
  canvas: '#FFFFFF',
  sunken: '#EDEBE4',
  surface: '#F6F5F1',
  raised: '#ECEAE3',
  line: '#E0DED6',
  lineStrong: '#C9C6BC',
  ink: '#2C2C2A',
  ink2: '#5A5954',
  ink3: '#64635D',
  accent: '#B4431A',
  accentHi: '#963614',
  side: '#26215C',
  pos: '#2E6A1F',
  caution: '#8F5A00',
  neg: '#B2203F'
} as const;

/**
 * Categorical series colours, in fixed slot order, assigned by category and
 * never by rank. Chosen by a constrained search for the indigo/saffron theme:
 * every slot >= 3:1 against every surface, worst pair dE2000 19.6 (normal),
 * 13.4 (protanopia), 13.7 (deuteranopia), and >= 12.7 from every status
 * colour and the accent. A sixth category folds into `catOther`.
 */
export const CATEGORY_COLOR: Record<string, string> = {
  Bills: '#317DAA',
  Food: '#504827',
  Transport: '#2A958C',
  Shopping: '#692B6A',
  Entertainment: '#698A45'
};

export const CATEGORY_FALLBACK = '#6E6D82';

export function categoryColor(name: string): string {
  return CATEGORY_COLOR[name] ?? CATEGORY_FALLBACK;
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export const signedInr = (n: number) => `${n >= 0 ? '+' : '−'}${inr(Math.abs(n))}`;

export const signedPct = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? '0%' : `${r > 0 ? '+' : '−'}${Math.abs(r)}%`;
};

/** Compact rupees for axis ticks and chips: ₹12.3k, ₹980. */
export const inrShort = (n: number) =>
  Math.abs(n) >= 1000 ? `₹${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `₹${Math.round(n)}`;
