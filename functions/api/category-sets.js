import { proxySheetCSV } from './cards.js';

// Configure after the category_enshu sheet has been published as CSV.
export function onRequest({ request, env }) {
  return proxySheetCSV(request, env?.CATEGORY_SHEET_CSV_URL);
}
