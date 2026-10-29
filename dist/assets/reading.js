import { answerFields } from './decks.js';
import { splitKanjiHints } from './kanji.js';
import { matchSentenceAnswer } from './sentences.js';

const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, '').replace(/[〜～]/gu, '~').replace(/[。.!！?？]+$/u, '');

/** Match the displayed source translations and explicit alternatives, never guessed synonyms. */
export function readingAssessment(card, input, deckId) {
  if (!String(input ?? '').trim()) return { correct: null, rating: 'unsure' };
  if (deckId === 'sentence') {
    const correct = matchSentenceAnswer(input, card.kanji);
    return { correct, rating: correct ? 'good' : 'again' };
  }
  const candidates = answerFields(card, deckId).flatMap(field => [field.text, ...splitKanjiHints(field.text)])
    .flatMap(text => [text, text.replace(/（[^（）]*）|\([^()]*\)|【[^【】]*】/gu, '')])
    .map(normalize).filter(Boolean);
  const correct = candidates.includes(normalize(input));
  return { correct, rating: correct ? 'good' : 'again' };
}

/** Call only from the final synchronous step of a start/navigation user action. */
export function speakReadingQuestion({ speaker, card, mode, view, visible = true }) {
  if (mode !== 'read' || view !== 'study' || !visible || !card?.han) return false;
  return speaker.toggle(card.han);
}
