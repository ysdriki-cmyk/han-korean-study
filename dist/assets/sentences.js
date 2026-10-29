import { normalizeVocabulary } from './vocabulary.js';

const clean = value => String(value ?? '').normalize('NFC').trim();
const normalizeAnswer = value => clean(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replace(/[。.!！?？]+$/u, '');

/** One complete example pair per source word; vocabulary ranks never become sentence progress. */
export function sentencesFromVocabulary(words) {
  return words.filter(word => clean(word.exampleKo) && clean(word.exampleJp)).map(word => ({
    ...word,
    id: `sentence:${word.sourceId ?? word.id}`,
    sourceId: word.sourceId ?? word.id,
    deckId: 'sentence', kind: 'sentence',
    han: clean(word.exampleKo), kanji: clean(word.exampleJp),
    hanja: '', meaning: '', english: '', state: '', flagged: false,
    exampleKo: '', exampleJp: '', answerVariants: [], synonyms: '', notes: '',
    sourceWord: word.deckId === 'vocabulary' ? word : { ...word, id: `vocabulary:${word.id}`, sourceId: word.id, deckId: 'vocabulary' },
  }));
}

export function normalizeSentences(text) {
  const source = normalizeVocabulary(text);
  const cards = sentencesFromVocabulary(source.cards).map(card => ({ ...card, id: card.sourceId }));
  return { ...source, cards };
}

/** Grade a whole source sentence. Word fragments, synonyms and word-level alternatives do not pass. */
export function matchSentenceAnswer(input, answer) {
  const expected = normalizeAnswer(answer), submitted = normalizeAnswer(input);
  return Boolean(expected && submitted && expected === submitted);
}
