window.APP_CONFIG = {
  defaultDeck: 'kanji',
  decks: {
    vocabulary: {csvUrl: '/api/content/vocabulary', fallbackCsvUrl: './data/vocabulary.csv'},
    kanji: {csvUrl: '/api/content/kanji', fallbackCsvUrl: './data/cards.csv'}
  },
  referencesFromVocabulary: true,
  refreshIntervalMs: 60000,
  fetchTimeoutMs: 20000
};
