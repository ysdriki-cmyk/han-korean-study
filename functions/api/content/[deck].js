import { proxySheetCSV } from '../cards.js';

const BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRh2suLk8kb79htB7NQhVfed8BuWPiZ04oqQCWsShnxmZDwvtoejMTtINRJgRyTmc_ysQIvjfhGSFnL/pub';
const sources = Object.freeze({
  kanji: { gid: '29317581', variable: 'KANJI_SHEET_CSV_URL' },
  vocabulary: { gid: '0', variable: 'VOCABULARY_SHEET_CSV_URL' },
});

export function onRequest({ request, env, params }) {
  const source = Object.hasOwn(sources, params?.deck) ? sources[params.deck] : null;
  if (!source) return new Response('Not found', { status: 404 });
  const url = env?.[source.variable] || `${BASE}?gid=${source.gid}&single=true&output=csv`;
  return proxySheetCSV(request, url);
}
