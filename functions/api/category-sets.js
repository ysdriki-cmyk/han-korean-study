import { cachedSheetCSV } from '../_lib/content-cache.js';

const DEFAULT_SOURCE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRh2suLk8kb79htB7NQhVfed8BuWPiZ04oqQCWsShnxmZDwvtoejMTtINRJgRyTmc_ysQIvjfhGSFnL/pub?gid=297489818&single=true&output=csv';

export function onRequest(context) {
  return cachedSheetCSV(context,context.env?.CATEGORY_SHEET_CSV_URL || DEFAULT_SOURCE,'category_enshu');
}
