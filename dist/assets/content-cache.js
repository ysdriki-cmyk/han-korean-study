const LIMIT = 3 * 1024 * 1024;
const cacheKey = deckId => `han-hanja:content:v1:${deckId}`;

/** Cache public content separately from personal learning records. Failures are harmless. */
export function readContentCache(storage, deckId, sourceUrl) {
  try {
    const value = JSON.parse(storage.getItem(cacheKey(deckId)));
    return value?.url === sourceUrl && typeof value.text === 'string' && value.text.length <= LIMIT ? value.text : null;
  } catch { return null; }
}

export function writeContentCache(storage, deckId, sourceUrl, text) {
  if (typeof text !== 'string' || !text.trim() || text.length > LIMIT) return false;
  try {
    storage.setItem(cacheKey(deckId), JSON.stringify({ url: sourceUrl, text }));
    return true;
  } catch { return false; }
}
