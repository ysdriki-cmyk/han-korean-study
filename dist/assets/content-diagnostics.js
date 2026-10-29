export const DIAGNOSTICS_KEY = 'han-hanja:diagnostics:v1';
const sources = new Set(['remote', 'cached', 'bundled', 'unavailable']);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

/** Local operational metadata only. No account identifiers, answers or CSV text. */
export function readContentDiagnostics(storage) {
  try {
    const value = JSON.parse(storage.getItem(DIAGNOSTICS_KEY));
    return value?.version === 1 && value.decks && typeof value.decks === 'object' && !Array.isArray(value.decks) ? value : { version: 1, decks: {} };
  } catch { return { version: 1, decks: {} }; }
}

export function recordContentDiagnostics(storage, deckId, details) {
  if (!['kanji', 'vocabulary'].includes(deckId) || !sources.has(details.source)) return false;
  try {
    const state = readContentDiagnostics(storage);
    const previous = state.decks[deckId];
    const checkedAt = timestamp(details.checkedAt) || new Date().toISOString();
    state.decks[deckId] = {
      source: details.source,
      checkedAt,
      lastSuccessAt: details.source === 'remote' ? checkedAt : timestamp(details.lastSuccessAt) || timestamp(previous?.lastSuccessAt),
      cardCount: Number.isSafeInteger(details.cardCount) && details.cardCount >= 0 ? details.cardCount : 0,
      warningCount: Number.isSafeInteger(details.warningCount) && details.warningCount >= 0 ? details.warningCount : 0,
      httpStatus: Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599 ? details.httpStatus : null,
      error: details.source === 'remote' ? '' : String(details.error || '').slice(0, 240),
    };
    storage.setItem(DIAGNOSTICS_KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}
