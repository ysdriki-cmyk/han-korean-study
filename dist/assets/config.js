window.APP_CONFIG = {
  defaultDeck: 'kanji',
  decks: {
    vocabulary: {csvUrl: '/api/content/vocabulary', fallbackCsvUrl: './data/startup/vocabulary.csv'},
    kanji: {csvUrl: '/api/content/kanji', fallbackCsvUrl: './data/startup/kanji.csv'},
    sentence: {csvUrl: '/api/content/sentence', fallbackCsvUrl: './data/startup/sentence.csv'}
  },
  referencesFromVocabulary: true,
  variation: {csvUrl: '/api/content/variation', fallbackCsvUrl: './data/variation.csv'},
  categorySetsCsvUrl: '/api/category-sets',
  categorySetsFallbackCsvUrl: './data/startup/category_enshu.csv',
  refreshIntervalMs: 60000,
  fetchTimeoutMs: 20000
};
