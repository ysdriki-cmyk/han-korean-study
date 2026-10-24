import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseCSV, normalizeCards, getAnswer, filterCards, makeSession, progressKey } from '../dist/assets/core.js';

const source = await fs.readFile(new URL('../dist/data/cards.csv', import.meta.url), 'utf8');

test('supplied ten-column sheet preserves all 650 cards and notes', () => {
  const { cards, warnings } = normalizeCards(source);
  assert.equal(cards.length, 650);
  assert.deepEqual(warnings, []);
  assert.equal(new Set(cards.map((card) => card.id)).size, 650);
  assert.equal(cards.filter((card) => card.flagged).length, 434);
  assert.deepEqual(cards[0], { id: '1', han: '가', kanji: '〔行く다〕', hanja: '家、歌、加、街、仮、価、可、暇、佳、嫁、架', meaning: '', state: '', flagged: true });
  assert.equal(cards.find((card) => card.id === '2').meaning, '各、おのおの');
  assert.equal(cards.find((card) => card.id === '146').state, '卍マジ');
  assert.equal(cards.at(-1).han, '올');
  assert.equal(cards.at(-1).kanji, '今年の');
  assert.ok(cards.every((card) => card.han === card.han.normalize('NFC')));
});

test('CSV parser handles BOM, escaped quotes, commas, CRLF and multiline cells', () => {
  assert.deepEqual(parseCSV('\uFEFFid,Han,漢字\r\n1,"가","家,歌\n""いえ"""\r\n2,각,角\r\n'), [
    ['id', 'Han', '漢字'], ['1', '가', '家,歌\n"いえ"'], ['2', '각', '角'],
  ]);
  assert.deepEqual(parseCSV('a,b,'), [['a', 'b', '']]);
  assert.deepEqual(parseCSV(''), []);
  assert.throws(() => parseCSV('a,"unclosed'), /引用符/);
  assert.throws(() => parseCSV('a,"closed"text'), /引用符/);
});

test('named schema and NFC normalization produce stable IDs after reordering', () => {
  const header = 'id,Han,漢字,一覧,意味,state,flagged\n';
  const rowA = 'abc,가,家,,いえ,元の状態,true';
  const rowB = 'def,각,角,,,,false';
  const first = normalizeCards(`${header}${rowA}\n${rowB}`).cards;
  const reordered = normalizeCards(`${header}${rowB}\n${rowA}`).cards;
  assert.deepEqual(first[0], reordered[1]);
  assert.equal(first[0].han, '가');
  assert.equal(first[0].state, '元の状態');
  assert.equal(first[0].flagged, true);
  const noIdA = normalizeCards('Han,漢字\n가,家\n각,角').cards;
  const noIdB = normalizeCards('Han,漢字\n각,角\n가,家').cards;
  assert.equal(noIdA[0].id, noIdB[1].id);
  const sameHan = normalizeCards('state,Han,漢字\n,가,家\n,가,歌').cards;
  const reversedHan = normalizeCards('state,Han,漢字\n,가,歌\n,가,家').cards;
  assert.notEqual(sameHan[0].id, sameHan[1].id);
  assert.equal(sameHan[0].id, reversedHan[1].id);
  const oldMetadata = normalizeCards('state,Han,漢字,flagged\n,가,家,false').cards[0];
  const newMetadata = normalizeCards('state,Han,漢字,flagged\n確認済み,가,家,true').cards[0];
  assert.equal(oldMetadata.id, newMetadata.id);
  assert.notEqual(oldMetadata.state, newMetadata.state);
  assert.notEqual(oldMetadata.flagged, newMetadata.flagged);
});

test('missing answer is excluded with warning, while valid empty-kanji rows remain', () => {
  const { cards, warnings } = normalizeCards('No.,Han,漢字,一覧,意味\n1,가,,家,\n2,각,,,\n3,,犬,,\n4,개,,,犬\n,,,,');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].hanja, '家');
  assert.equal(cards[1].meaning, '犬');
  assert.equal(warnings.length, 2);
  assert.throws(() => normalizeCards('id,漢字\n1,家'), /Han/);
  assert.throws(() => normalizeCards('id,Han\n1,가'), /漢字/);
  assert.throws(() => normalizeCards('id,Han,漢字\nx,가,家\nx,각,角'), /重複/);
});

test('answer combines unique nonempty source fields', () => {
  assert.equal(getAnswer({ kanji: ' 家 ', hanja: '家', meaning: 'いえ' }), '家\nいえ');
});

test('search, flags and recall status filter independently for both directions', () => {
  const { cards } = normalizeCards('id,Han,漢字,一覧,意味,flagged\n1,가,家,家,,true\n2,각,,角,,false\n3,개,,,犬,false');
  const progress = { [progressKey('1', 'ko-han')]: { status: 'mastered' }, [progressKey('2', 'ko-han')]: { status: 'review' } };
  assert.deepEqual(filterCards(cards, { query: '가' }).map((card) => card.id), ['1']);
  assert.deepEqual(filterCards(cards, { query: '犬' }).map((card) => card.id), ['3']);
  assert.equal(filterCards(cards, { category: 'flagged' }).length, 1);
  assert.equal(filterCards(cards, { category: 'hanja' }).length, 2);
  assert.equal(filterCards(cards, { category: 'meaning' }).length, 2);
  assert.deepEqual(filterCards(cards, { status: 'mastered', progress }).map((card) => card.id), ['1']);
  assert.deepEqual(filterCards(cards, { status: 'review', progress }).map((card) => card.id), ['2']);
  assert.deepEqual(filterCards(cards, { status: 'new', progress }).map((card) => card.id), ['3']);
  assert.equal(filterCards(cards, { status: 'new', progress, direction: 'han-ko' }).length, 3);
  assert.notEqual(progressKey('1', 'ko-han'), progressKey('1', 'han-ko'));
});

test('session shuffles before selection and does not mutate source', () => {
  const cards = ['a', 'b', 'c', 'd'];
  assert.deepEqual(makeSession(cards, { shuffle: false, limit: 2 }), ['a', 'b']);
  assert.deepEqual(makeSession(cards, { random: () => 0, limit: 2 }), ['b', 'c']);
  assert.deepEqual(cards, ['a', 'b', 'c', 'd']);
  assert.equal(new Set(makeSession(cards, { limit: 'all' })).size, 4);
  assert.deepEqual(makeSession(cards, { limit: 0 }), []);
  assert.deepEqual(makeSession([], { limit: 20 }), []);
  assert.throws(() => makeSession(cards, { limit: -1 }), /学習枚数/);
});
