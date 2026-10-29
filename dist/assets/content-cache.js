const LIMIT = 3 * 1024 * 1024;
const cacheKey = deckId => `han-hanja:content:v1:${deckId}`;

/** Cache public content separately from personal learning records. Failures are harmless. */
export function readContentCache(storage, deckId, sourceUrl) {
  return readContentSnapshot(storage, deckId, sourceUrl)?.text ?? null;
}

export function readContentSnapshot(storage, deckId, sourceUrl) {
  try {
    const value = JSON.parse(storage.getItem(cacheKey(deckId)));
    if (value?.url !== sourceUrl || typeof value.text !== 'string' || value.text.length > LIMIT) return null;
    return { text: value.text, fetchedAt: typeof value.fetchedAt === 'string' && Number.isFinite(Date.parse(value.fetchedAt)) ? value.fetchedAt : null };
  } catch { return null; }
}

export function writeContentCache(storage, deckId, sourceUrl, text, fetchedAt = new Date().toISOString()) {
  if (typeof text !== 'string' || !text.trim() || text.length > LIMIT) return false;
  try {
    storage.setItem(cacheKey(deckId), JSON.stringify({ url: sourceUrl, text, fetchedAt }));
    return true;
  } catch { return false; }
}
