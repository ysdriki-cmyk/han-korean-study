import { categoryLabels } from './sheet-fields.js';

/** Exact tags or explicit turn/speaker cells decide membership; IDs never do. */
export function sentenceCollection(card) {
  if (card?.deckId !== 'sentence') return null;
  const tags = categoryLabels(card.tags).map(tag => tag.normalize('NFKC').toLowerCase());
  const turn = Number(String(card.conversation?.turn ?? '').normalize('NFKC').trim());
  const explicitDialogue = Number.isSafeInteger(turn) && turn > 0 && String(card.conversation?.speaker ?? '').trim();
  if (tags.includes('conversation') || explicitDialogue) return 'conversation';
  if (tags.includes('subtitle')) return 'extra';
  return 'core';
}

export function isConversationSentence(card) { return sentenceCollection(card) === 'conversation'; }

/** Subtitle examples are opt-in; their records retain ordinary sentence IDs. */
export function isExtraSentence(card) { return sentenceCollection(card) === 'extra'; }

export function sentenceCollectionCards(cards, collection = 'core') {
  if (!['core', 'extra', 'conversation'].includes(collection)) return [];
  return cards.filter(card => sentenceCollection(card) === collection);
}
