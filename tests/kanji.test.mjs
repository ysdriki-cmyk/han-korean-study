import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCards, parseCSV } from '../dist/assets/core.js';
import { essentialKanji, splitKanjiHints, kanjiHints, kanjiPrompt, kanjiPromptChoices, kanjiAnswersForPrompt } from '../dist/assets/kanji.js';

const source = readFileSync(new URL('../dist/data/cards.csv', import.meta.url), 'utf8');
const cards = normalizeCards(source).cards;
const card = id => cards.find(item => item.id === String(id));

test('first pass uses exactly the 442 populated F cells, not I or J columns', () => {
  const rows = parseCSV(source);
  assert.equal(rows[0][5], '漢字');
  assert.equal(cards.length, 650);
  assert.equal(cards.filter(essentialKanji).length, 442);
  assert.deepEqual(cards.filter(essentialKanji).map(item => item.id), rows.slice(1).filter(row => row[5].trim()).map(row => row[1]));
  assert.equal(essentialKanji({ kanji: ' ', hanja: '甲', meaning: '説明' }), false);
  assert.deepEqual(kanjiHints({ kanji: '', hanja: '甲', meaning: '説明' }), []);
  assert.equal(kanjiPrompt({ kanji: '', hanja: '甲' }), '');
});

test('all required cards produce a usable hint without revealing Hangul', () => {
  const before = JSON.stringify(cards);
  for (const item of cards.filter(essentialKanji)) {
    const hints = kanjiHints(item);
    assert.ok(hints.length, `card ${item.id}`);
    assert.equal(hints.length, new Set(hints).size);
    assert.ok(hints.every(hint => !/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7ff]/u.test(hint)), `card ${item.id}`);
    assert.ok(hints.includes(kanjiPrompt(item)), `card ${item.id}`);
  }
  assert.equal(JSON.stringify(cards), before);
});

test('F alternatives split while bracketed qualifiers stay attached to their verb', () => {
  assert.deepEqual(kanjiHints(card(2)), ['各', '覚']);
  assert.deepEqual(kanjiHints(card(4)), ['柿', '（目を）閉じる']);
  assert.deepEqual(kanjiHints(card(7)), ['～個', '犬', '晴れる', 'たたむ']);
  assert.deepEqual(kanjiHints(card(57)), ['僕の', '出す', '起こす', '来']);
  assert.deepEqual(kanjiHints(card(166)), ['不', '火', '（風が）吹く', '（口笛、楽器などを）吹く']);
  assert.deepEqual(kanjiHints(card(272)), ['計る（寸法·長さ·高さなど）']);
});

test('Korean grammar annotations and adjacent quoted examples do not leak answers', () => {
  assert.deepEqual(kanjiHints(card(1)), ['行く']);
  assert.deepEqual(kanjiHints(card(518)), ['〜ない']);
  assert.deepEqual(kanjiHints(card(645)), ['食事を抜く', '絶食する', '飢える']);
  assert.deepEqual(kanjiHints(card(646)), ['ちぎる', '引きちぎる']);
  assert.deepEqual(kanjiHints(card(588)), ['塩辛い', '組み立てる', '（計画を）立てる', '塩っぱい']);
});

test('fallback hint splitting accepts CSV commas, slash and newlines without breaking parentheses', () => {
  assert.deepEqual(splitKanjiHints('家、歌, 加／街/価\n可\r\n暇'), ['家', '歌', '加', '街', '価', '可', '暇']);
  assert.deepEqual(splitKanjiHints('（a、b）を使う、c'), ['（a、b）を使う', 'c']);
  assert.deepEqual(splitKanjiHints('(a) foo (b)、c'), ['(a) foo (b)', 'c']);
  assert.deepEqual(splitKanjiHints(null), []);
});

test('one-hint prompts rotate deterministically without changing the full source answer', () => {
  const item = card(2), original = item.kanji;
  assert.equal(kanjiPrompt(item), '各');
  assert.equal(kanjiPrompt(item, 1), '覚');
  assert.equal(kanjiPrompt(item, 2), '各');
  assert.equal(kanjiPrompt(item, -1), '覚');
  assert.equal(kanjiPrompt(item, Infinity), '各');
  assert.equal(item.kanji, original);
});

test('full-set clues use I or J only when no usable F clue exists', () => {
  assert.deepEqual(kanjiPromptChoices({ kanji: '水', hanja: '木、火', meaning: '説明' }), ['水']);
  assert.deepEqual(kanjiPromptChoices(card(5)), ['甲']);
  assert.deepEqual(kanjiPromptChoices({ kanji: '', hanja: '家、歌' }), ['家', '歌']);
  assert.deepEqual(kanjiPromptChoices({ kanji: '', hanja: ' ', meaning: '石、いし' }), ['石', 'いし']);
});

test('one visible clue accepts every exact source correspondence without substring matching', () => {
  assert.deepEqual(kanjiAnswersForPrompt(cards, '女'), ['녀', '여']);
  assert.deepEqual(kanjiAnswersForPrompt(cards, '水'), ['물', '수']);
  assert.deepEqual(kanjiAnswersForPrompt(cards, '行'), ['항', '행']);
  assert.ok(!kanjiAnswersForPrompt(cards, '行').includes('가'));
  assert.deepEqual(kanjiAnswersForPrompt(cards, '存在しないヒント'), []);
  assert.deepEqual(kanjiAnswersForPrompt(cards, ''), []);
});

test('accepted answers compose Hangul, trim whitespace and remove duplicates', () => {
  const shared = [
    { han: ' \u1102\u1167 ', kanji: ' 女 ' },
    { han: '녀', kanji: '女、女性' },
    { han: '여', kanji: '女' },
    { han: '아', kanji: '女性' },
    { han: ' ', kanji: '女' },
  ];
  assert.deepEqual(kanjiAnswersForPrompt(shared, ' 女 '), ['녀', '여']);
  assert.deepEqual(kanjiAnswersForPrompt(shared, '女性'), ['녀', '아']);
});
