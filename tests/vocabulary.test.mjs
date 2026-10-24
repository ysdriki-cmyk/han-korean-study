import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeVocabulary, acceptedVocabularyAnswers, matchVocabularyAnswer } from '../dist/assets/vocabulary.js';
import { parseCSV, getAnswer } from '../dist/assets/core.js';

const bytes = await fs.readFile(new URL('../dist/data/vocabulary.csv', import.meta.url));
const source = bytes.toString('utf8');

test('bundled vocabulary is the exact original file and selects all 4559 valid rows', () => {
  assert.equal(bytes.length, 564441);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '9b8ec82a3d5290bcbb7d1b7e72bc7cf3c79bacefb94a952aeb37f43f090a76f6');
  const { cards, warnings, excludedRows } = normalizeVocabulary(source);
  assert.equal(parseCSV(source).length, 5006);
  assert.equal(cards.length, 4559);
  assert.equal(excludedRows, 446);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /446行/);
  assert.equal(cards.filter((card) => card.english).length, 4337);
  assert.ok(cards.every((card) => card.kanji));
  assert.ok(cards.every((card) => card.kind === 'vocabulary' && card.hanja === ''));
  assert.equal(new Set(cards.map((card) => card.id)).size, 4559);
  assert.equal(cards.filter((card) => card.flagged).length, 190);
});

test('primary No and Korean columns take precedence over duplicated older columns', () => {
  const { cards } = normalizeVocabulary(source);
  const first = cards[0];
  assert.equal(first.id, '277');
  assert.equal(first.han, '날');
  assert.equal(first.kanji, '日');
  assert.equal(first.meaning, 'day');
  assert.equal(first.state, '卍行け');
  assert.equal(first.tags, '#date');
  assert.equal(first.sourceRemember, 'FALSE');
  const different = cards.filter((card) => card.alternateHan && card.han !== card.alternateHan);
  assert.equal(different.length, 12);
  assert.equal(cards.find((card) => card.id === '51712').han, '완전히, 온전히');
  assert.equal(cards.find((card) => card.id === '51712').alternateHan, '완전히');
  assert.equal(cards.find((card) => card.id === '51596').han, '엄청');
  const japaneseOnly = cards.find((card) => card.id === '60001');
  assert.equal(japaneseOnly.han, '못생겼다');
  assert.equal(japaneseOnly.english, '');
  assert.equal(getAnswer(japaneseOnly), '不細工だ');
});

test('preserves examples, notes and source states as literal data', () => {
  const { cards } = normalizeVocabulary(source);
  const card = cards.find((card) => card.id === '1016');
  assert.equal(card.exampleKo, '이거 얼마예요?');
  assert.equal(card.exampleJp, 'これ、いくらですか？');
  assert.equal(card.notes, '거기까지 얼마나 걸려? そこまでどれくらいかかる？');
  const distribution = cards.reduce((counts, card) => {
    counts[card.state] = (counts[card.state] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(distribution, {
    '卍行け': 15, '卍マジ': 105, '卍GO': 118, '必須！': 190, '次': 314,
    'あとで': 362, 'パス': 154, 'まあまあ': 127, '覚えた': 176, 'remember': 35,
    'read': 39, 'read2': 76, 'read3': 24, '書ける': 65, '': 2759,
  });
});

test('clean future schema accepts reordered fields, BOM, composed Korean and optional fields', () => {
  const text = '\uFEFFEnglish,state,No,Korean,Japanese,exampleKo,exampleJp,notes,tags,alternateHan,remember\r\n'
    + 'home,必須！,x,가,家,"가, 가요",行きます,"引用""符",#basic,가요,TRUE\r\n';
  const { cards, warnings, excludedRows } = normalizeVocabulary(text);
  assert.equal(cards.length, 1);
  assert.equal(excludedRows, 0);
  assert.deepEqual(warnings, []);
  assert.deepEqual(cards[0], {
    id: 'x', han: '가', kanji: '家', hanja: '', meaning: 'home', state: '必須！',
    flagged: true, kind: 'vocabulary', english: 'home', exampleKo: '가, 가요',
    exampleJp: '行きます', notes: '引用"符', tags: '#basic', alternateHan: '가요', sourceRemember: 'TRUE',
  });
  const reversed = normalizeVocabulary('No,Korean,Japanese,English,state\n2,나,私,I,次\n1,가,家,home,あとで').cards;
  const ordered = normalizeVocabulary('No,Korean,Japanese,English,state\n1,가,家,home,あとで\n2,나,私,I,次').cards;
  assert.equal(reversed[1].id, ordered[0].id);
  assert.equal(reversed[1].han, ordered[0].han);
});

test('skips missing question/answer, auxiliary rows and repeated headers in one summary', () => {
  const text = 'No,Korean,Japanese,English,state\n1,가,家,,\n2,각,,,\n3,,角,,\nNo,Korean,Japanese,English,state\n,,,,TRUE\n4,나,,I,次';
  const { cards, excludedRows, warnings } = normalizeVocabulary(text);
  assert.equal(cards.length, 2);
  assert.equal(excludedRows, 4);
  assert.equal(warnings.length, 1);
  assert.deepEqual(cards.map((card) => card.id), ['1', '4']);
  assert.equal(getAnswer(cards[1]), 'I');
  assert.throws(() => normalizeVocabulary('No,Korean,Japanese\n1,가,家\n1,나,私'), /重複/);
  assert.throws(() => normalizeVocabulary('No,Japanese\n1,家'), /韓国語/);
  assert.throws(() => normalizeVocabulary('No,Korean\n1,가'), /訳/);
  assert.throws(() => normalizeVocabulary('No,Korean,Japanese\n1,가,"家'), /引用符/);
});

test('generated fallback identity stays stable on reorder and metadata edits', () => {
  const a = normalizeVocabulary('Korean,Japanese,English,state\n가,家,home,必須！\n가,歌,song,次').cards;
  const b = normalizeVocabulary('Korean,Japanese,English,state\n가,歌,song,あとで\n가,家,home,覚えた').cards;
  assert.notEqual(a[0].id, a[1].id);
  assert.equal(a[0].id, b[1].id);
  assert.equal(a[1].id, b[0].id);
});

test('formula-like text and URLs remain plain values without execution', () => {
  const input = 'No,Korean,Japanese,English,notes\n1,가,=1+1,https://example.com/,"=HYPERLINK(""https://example.com"",""click"")"';
  const { cards } = normalizeVocabulary(input);
  assert.equal(cards[0].kanji, '=1+1');
  assert.equal(cards[0].english, 'https://example.com/');
  assert.equal(cards[0].notes, '=HYPERLINK("https://example.com","click")');
});

test('explicit alternative words each pass, as does the whole original prompt', () => {
  const alternatives = [
    ['완전히, 온전히', ['완전히', '온전히']],
    ['서투르다. 서툴다', ['서투르다', '서툴다']],
    ['요새／요즘', ['요새', '요즘']],
    ['쟤、그애', ['쟤', '그애']],
    ['부모/부모님', ['부모', '부모님']],
    ['-고, -서', ['-고', '-서']],
  ];
  for (const [han, candidates] of alternatives) {
    const card = { han };
    assert.deepEqual(acceptedVocabularyAnswers(card), candidates);
    assert.ok(candidates.every((candidate) => matchVocabularyAnswer(candidate, card)));
    assert.equal(matchVocabularyAnswer(han, card), true);
  }
  assert.equal(matchVocabularyAnswer('요즘', { han: '요새／요즘' }), true);
  assert.equal(matchVocabularyAnswer('완전이', { han: '완전히, 온전히' }), false);
});

test('ordinary punctuated sentences and older alternate forms are not split or accepted', () => {
  for (const han of ['안녕, 잘 지내?', '안녕하세요. 반갑습니다.', '집에 가요/학교에 가요', '딱..딱히', '가,']) {
    const card = { han };
    assert.deepEqual(acceptedVocabularyAnswers(card), [han]);
    assert.equal(matchVocabularyAnswer(han, card), true);
  }
  assert.equal(matchVocabularyAnswer('안녕', { han: '안녕, 잘 지내?' }), false);
  assert.equal(matchVocabularyAnswer('엄청나다', { han: '엄청', alternateHan: '엄청나다' }), false);
  assert.equal(matchVocabularyAnswer('고마웠습니다', { han: '고마워', alternateHan: '고마웠습니다' }), false);
  assert.deepEqual(acceptedVocabularyAnswers({ han: '' }), []);
  assert.equal(matchVocabularyAnswer('', { han: '' }), false);
});
