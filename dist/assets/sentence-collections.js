import { categoryLabels } from './sheet-fields.js';

/** Subtitle examples are opt-in; their records retain ordinary sentence IDs. */
export function isExtraSentence(card) {
  return card?.deckId === 'sentence' && categoryLabels(card.tags).some(tag => tag.normalize('NFKC').toLowerCase() === 'subtitle');
}

export function sentenceCollectionCards(cards, collection = 'core') {
  if (!['core', 'extra'].includes(collection)) return [];
  return cards.filter(card => card?.deckId === 'sentence' && isExtraSentence(card) === (collection === 'extra'));
}
