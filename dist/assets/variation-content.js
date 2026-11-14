import { normalizeSentences } from './sentences.js?v=7';
import { namespaceCards } from './decks.js?v=9';
import { isVariationSentence } from './sentence-collections.js?v=3';

/** A dedicated sheet supplies membership; IDs and optional genre cells do not. */
export function parseVariationContent(text) {
  const parsed = normalizeSentences(text, {collection:'variation'});
  return {...parsed, cards:namespaceCards(parsed.cards, 'sentence')};
}

/**
 * The independent variation source owns every variation sentence. Retiring an
 * old tagged row is a migration; colliding with a regular sentence is an error.
 * Validate before returning so callers can retain their last complete snapshot.
 */
export function combineSentenceSources(sentenceCards = [], variationCards = []) {
  if (!Array.isArray(sentenceCards) || !Array.isArray(variationCards)) throw new Error('sentenceとvariationの教材を確認してください。');
  const ordinary = sentenceCards.filter(card => !isVariationSentence(card));
  const ids = new Set();
  const orders = new Map();
  for (const card of ordinary) {
    if (card?.deckId !== 'sentence' || typeof card.id !== 'string' || !card.id.startsWith('sentence:') || card.id === 'sentence:') {
      throw new Error('sentenceの固定IDを確認してください。');
    }
    if (ids.has(card.id)) throw new Error(`sentenceの固定ID「${card.id}」が重複しています。`);
    ids.add(card.id);
  }
  for (const card of variationCards) {
    const {groupId,order} = card?.variation || {};
    if (!isVariationSentence(card) || typeof card.id !== 'string' || !card.id.startsWith('sentence:') || card.id === 'sentence:'
      || typeof groupId !== 'string' || !groupId.trim() || !Number.isSafeInteger(order) || order <= 0) {
      throw new Error('variation専用教材の固定ID・セットID・順番を確認してください。');
    }
    if (ids.has(card.id)) throw new Error(`sentenceとvariationの固定ID「${card.id}」が重複しています。`);
    ids.add(card.id);
    if (!orders.has(groupId)) orders.set(groupId, new Set());
    if (orders.get(groupId).has(order)) throw new Error(`variationのセット「${groupId}」の順番「${order}」が重複しています。`);
    orders.get(groupId).add(order);
  }
  return [...ordinary,...variationCards];
}
