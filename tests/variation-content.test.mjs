import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVariationContent, combineSentenceSources } from '../dist/assets/variation-content.js';
import { parseDeck, restoreLearningRecords } from '../dist/assets/decks.js';
import { sentenceCollectionCards } from '../dist/assets/sentence-collections.js';
import { buildVariationLessons, matchVariationAnswer } from '../dist/assets/variations.js';
import { getRecord } from '../dist/assets/learning.js';
import { recordAssessment, ratingFor } from '../dist/assets/assessment.js';
import { validContentCSV } from '../functions/_lib/content-cache.js';
import { resolveSentenceWords, linkSentenceWords } from '../dist/assets/sentences.js';

const required = ['id_sentence','例文_韓国語','例文_日本語','セットID','順番'];
const cell = value => `"${String(value ?? '').replace(/"/gu, '""')}"`;
const csv = (rows, headers = required) => [headers,...rows.map(row => headers.map(header => row[header] ?? ''))].map(row => row.map(cell).join(',')).join('\n');
const sample = (overrides = {}) => ({id_sentence:'var_eat_001',例文_韓国語:'김밥을 먹었어.',例文_日本語:'キンパを食べた。',セットID:'eat-1',順番:'1',...overrides});
const ordinary = () => parseDeck('sentence', 'id_sentence,例文_韓国語,例文_日本語\nregular,집에 가요.,家に帰ります。').cards;

test('a dedicated variation sheet needs no reserved genre tag and retains existing sentence record IDs', () => {
  const text = csv([sample({id_sentence:'a-plain-ID'})]);
  const parsed = parseVariationContent(text);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].id, 'sentence:a-plain-ID');
  assert.equal(parsed.cards[0].sourceId, 'a-plain-ID');
  assert.equal(parsed.cards[0].tags, '#variation');
  assert.equal(parsed.cards[0].variation.groupId, 'eat-1');
  assert.equal(parsed.cards[0].variation.order, 1);
  assert.deepEqual([parsed.warnings,parsed.excludedRows], [[],0]);
  assert.equal(sentenceCollectionCards(parsed.cards, 'variation').length, 1);
  for (const collection of ['core','extra','conversation']) assert.equal(sentenceCollectionCards(parsed.cards, collection).length, 0);
  assert.equal(sentenceCollectionCards(parseDeck('sentence', text).cards, 'core').length, 1);
});

test('ordinary tags and optional metadata survive dedicated parsing and headers may be reordered', () => {
  const headers = ['別解_韓国語','順番','例文_日本語','id_sentence','変化ポイント','セット名','練習指示','セットID','例文_韓国語','ジャンル','変形タイプ','訳2','使用韓国語_main','使用韓国語_1','話し方','距離感・対象','使い方メモ'];
  const row = sample({順番:'２',例文_韓国語:'김밥을 안 먹었어.'.normalize('NFD'),例文_日本語:'キンパを食べなかった。',
    別解_韓国語:'김밥을 먹지 않았어.\n김밥은 안 먹었어.',ジャンル:'#食事 #variations',セット名:'食べたことを話す',
    変形タイプ:'否定',練習指示:'食べなかったことにして',変化ポイント:'안 を加える',訳2:'食べなかったよ。',
    使用韓国語_main:'먹다',使用韓国語_1:'김밥',話し方:'タメ口','距離感・対象':'友達',使い方メモ:'自分のことを話す'});
  const {cards:[card]} = parseVariationContent(csv([row], headers));
  assert.equal(card.han, '김밥을 안 먹었어.');
  assert.equal(card.tags, '#食事 #variations #variation');
  assert.equal(card.translation2, '食べなかったよ。');
  assert.equal(card.mainKorean, '먹다');
  assert.equal(card.sentenceRefs[0].korean, '김밥');
  assert.equal(card.variation.title, '食べたことを話す');
  assert.equal(card.variation.order, 2);
  assert.equal(card.variation.speechStyle, 'タメ口');
  assert.equal(card.variation.audience, '友達');
  assert.equal(card.variation.usageNote, '自分のことを話す');
  assert.equal(matchVariationAnswer('김밥을 먹지 않았어.', card), true);
  assert.equal(matchVariationAnswer('김밥을 안 먹었어요.', card), false);
  const tagged = parseVariationContent(csv([sample({ジャンル:'＃ＶＡＲＩＡＴＩＯＮ ＃食事'})], [...required,'ジャンル']));
  assert.equal(tagged.cards[0].tags, '＃ＶＡＲＩＡＴＩＯＮ ＃食事');
});

const managedSheetHeaders = ['id_sentence','remember','','☆方角way☆数字number☆日付date☆季節season★趣味運動hobby',
  'ジャンル','練習指示','例文_日本語','例文_韓国語','別解_韓国語','変化ポイント','セットID','セット名','順番','変形タイプ',
  '話し方','距離感・対象','使い方メモ','使用韓国語_main',...Array.from({length:10}, (_,index) => `使用韓国語_${index+1}`),''];
const managedSheetRows = [
  sample({id_sentence:'var_layout_003',remember:'FALSE',順番:'3',ジャンル:'#食事',セット名:'食べたことを話す',
    練習指示:'知人に丁寧に伝える',例文_日本語:'キンパを食べました。',例文_韓国語:'김밥을 먹었어요.',変形タイプ:'相手に合わせる',話し方:'丁寧'}),
  sample({id_sentence:'var_layout_001',remember:'TRUE',順番:'1',ジャンル:'#食事',セット名:'食べたことを話す',
    練習指示:'友達に短く伝える',変形タイプ:'元の文',話し方:'タメ口'}),
  sample({id_sentence:'var_layout_002',remember:'FALSE',順番:'2',ジャンル:'#食事',セット名:'食べたことを話す',
    練習指示:'食べなかったことにする',例文_日本語:'キンパを食べなかった。',例文_韓国語:'김밥을 안 먹었어.',
    別解_韓国語:'김밥을 먹지 않았어.',変化ポイント:'안 を足す',変形タイプ:'食べなかった事情',話し方:'タメ口'}),
].map(row => ({...row,'☆方角way☆数字number☆日付date☆季節season★趣味運動hobby':'#数字number',
  '距離感・対象':'知人',使い方メモ:'同じセットを順番に練習する',使用韓国語_main:'먹다'}));

test('the managed sheet layout ignores management and empty columns while retaining both languages and numeric lesson order', () => {
  const parsed = parseVariationContent(csv(managedSheetRows, managedSheetHeaders));
  assert.deepEqual([parsed.warnings,parsed.excludedRows], [[],0]);
  assert.deepEqual(parsed.cards.map(card => card.id), ['sentence:var_layout_003','sentence:var_layout_001','sentence:var_layout_002']);
  const [lesson] = buildVariationLessons(parsed.cards);
  assert.equal(lesson.baseCard.id, 'sentence:var_layout_001');
  assert.deepEqual(lesson.cards.map(card => card.id), ['sentence:var_layout_001','sentence:var_layout_002','sentence:var_layout_003']);
  assert.deepEqual(lesson.cards.map(card => [card.kanji,card.han]), [
    ['キンパを食べた。','김밥을 먹었어.'],
    ['キンパを食べなかった。','김밥을 안 먹었어.'],
    ['キンパを食べました。','김밥을 먹었어요.'],
  ]);
  for (const card of parsed.cards) {
    assert.equal(card.tags, '#食事 #variation');
    assert.deepEqual(card.categories, ['食事','variation']);
    assert.equal(card.mainKorean, '먹다');
    assert.equal(ratingFor(card, {}, 'write'), 'unseen');
  }
  assert.equal(lesson.cards[1].variation.instruction, '食べなかったことにする');
  assert.equal(lesson.cards[1].variation.point, '안 を足す');
  assert.equal(matchVariationAnswer('김밥을 먹지 않았어.', lesson.cards[1]), true);
});

test('the production edge validator accepts managed-sheet exports and fixed IDs retain records through layout and row changes', () => {
  const text = csv(managedSheetRows, managedSheetHeaders);
  assert.equal(validContentCSV('variation', text), true);
  const oldHeaders = managedSheetHeaders.filter(Boolean).filter(header => !['remember','☆方角way☆数字number☆日付date☆季節season★趣味運動hobby'].includes(header)).reverse();
  const before = parseVariationContent(csv([...managedSheetRows].reverse(), oldHeaders)).cards;
  const previous = before.find(card => card.sourceId === 'var_layout_002');
  const records = {[previous.id]:recordAssessment(getRecord(previous), 'write', 'good', {correct:true,now:Date.parse('2026-11-15T00:00:00Z')})};
  const moved = parseVariationContent(text).cards.find(card => card.id === previous.id);
  assert.equal(moved.sourceId, 'var_layout_002');
  assert.equal(moved.kanji, previous.kanji);
  assert.equal(moved.han, previous.han);
  assert.equal(ratingFor(moved, records, 'write'), 'good');
  assert.equal(ratingFor(moved, records, 'read'), 'unseen');
  assert.equal(records[moved.id].assessments.write.attempts, 1);
  const duplicateId = managedSheetRows.map((row,index) => index === 0 ? {...row,id_sentence:'var_layout_001'} : row);
  const duplicateOrder = managedSheetRows.map((row,index) => index === 0 ? {...row,順番:'1'} : row);
  assert.equal(validContentCSV('variation', csv(duplicateId, managedSheetHeaders)), false);
  assert.equal(validContentCSV('variation', csv(duplicateOrder, managedSheetHeaders)), false);
});

test('numbered vocabulary can grow from one word to ten without renumbering gaps or changing the independent main word', () => {
  const lemmas = ['어제','저','친구','작다','카페','따뜻하다','커피','천천히','마시다','이야기하다'];
  const meanings = ['昨日','私','友達','小さい','カフェ','温かい','コーヒー','ゆっくり','飲む','話す'];
  const words = parseDeck('vocabulary', csv(lemmas.map((lemma,index) => ({id:`word_${index+1}`,韓国語:lemma,日本語:meanings[index]})), ['id','韓国語','日本語'])).cards;
  const row = sample({id_sentence:'var_words_001',セットID:'words-family',remember:'FALSE',ジャンル:'#食事',使用韓国語_main:'마시다',
    例文_韓国語:'어제 저는 친구랑 작은 카페에서 따뜻한 커피를 천천히 마시면서 이야기했어요.',
    例文_日本語:'昨日、私は友達と小さなカフェで温かいコーヒーをゆっくり飲みながら話しました。'});
  const stages = [[1],[1,3,9,10],Array.from({length:10}, (_,index) => index+1)];
  const cards = stages.map(positions => {
    const numbered = Object.fromEntries(positions.map(position => [`使用韓国語_${position}`,lemmas[position-1]]));
    const text = csv([{...row,...numbered}], managedSheetHeaders);
    assert.equal(validContentCSV('variation', text), true);
    const [card] = parseVariationContent(text).cards;
    assert.deepEqual(card.sentenceRefs.map(ref => ref.position), positions);
    assert.deepEqual(card.sentenceRefs.map(ref => ref.korean), positions.map(position => lemmas[position-1]));
    const resolved = resolveSentenceWords(card, words);
    assert.deepEqual(resolved.warnings, []);
    assert.deepEqual(resolved.rows.map(ref => ref.position), positions);
    assert.deepEqual(resolved.rows.map(ref => ref.japanese), positions.map(position => meanings[position-1]));
    assert.equal(resolved.main.words[0].id, 'vocabulary:word_9');
    assert.deepEqual(resolved.rows.filter(ref => ref.main).map(ref => ref.position), positions.includes(9) ? [9] : []);
    const linked = linkSentenceWords([card], words);
    assert.deepEqual(linked.warnings, []);
    assert.equal(linked.cards[0].mainWord.id, 'vocabulary:word_9');
    assert.equal(linked.cards[0].sourceWord.id, 'vocabulary:word_9');
    assert.deepEqual(new Set(linked.cards[0].sourceWords.map(word => word.id)), new Set([...positions,9].map(position => `vocabulary:word_${position}`)));
    return card;
  });
  assert.deepEqual(cards.map(card => card.id), ['sentence:var_words_001','sentence:var_words_001','sentence:var_words_001']);
  assert.deepEqual(cards.map(card => card.mainKorean), ['마시다','마시다','마시다']);
  assert.equal(cards[1].sentenceRefs.at(-1).position, 10);
  assert.equal(cards[2].sentenceRefs.length, 10);
});

test('management-only rows between lessons and after the final sentence do not invalidate a managed-sheet export', () => {
  const controls = {remember:'FALSE','☆方角way☆数字number☆日付date☆季節season★趣味運動hobby':'TRUE'};
  const rows = [controls,managedSheetRows[0],{...controls,remember:'TRUE'},...managedSheetRows.slice(1),
    ...Array.from({length:30}, (_,index) => ({...controls,remember:index % 2 ? 'TRUE' : 'FALSE'}))];
  const text = csv(rows, managedSheetHeaders);
  const parsed = parseVariationContent(text);
  assert.deepEqual(parsed.cards.map(card => card.sourceId), ['var_layout_003','var_layout_001','var_layout_002']);
  assert.deepEqual([parsed.warnings,parsed.excludedRows], [[],0]);
  assert.deepEqual(buildVariationLessons(parsed.cards)[0].cards.map(card => card.variation.order), [1,2,3]);
  assert.equal(validContentCSV('variation', text), true);
  const onlyManagement = csv([controls,{...controls,remember:'TRUE'}], managedSheetHeaders);
  assert.throws(() => parseVariationContent(onlyManagement), /学習できる文章がありません/u);
  assert.equal(validContentCSV('variation', onlyManagement), false);
});

test('management columns cannot hide partially entered sentence rows from validation', () => {
  for (const partial of [
    {id_sentence:'unfinished'},
    {例文_日本語:'あとで韓国語を書く文章'},
    {例文_韓国語:'나중에 완성할 문장'},
    {ジャンル:'#食事'},
    {練習指示:'あとで例文を追加する'},
    {セットID:'unfinished-family'},
    {順番:'1'},
    {別解_韓国語:'김밥을 먹지 않았어.'},
    {使用韓国語_main:'먹다'},
    {使用韓国語_1:'김밥'},
    {使用韓国語_10:'먹다'},
  ]) {
    const row = {...partial,remember:'FALSE','☆方角way☆数字number☆日付date☆季節season★趣味運動hobby':'TRUE'};
    const text = csv([managedSheetRows[0],row], managedSheetHeaders);
    assert.throws(() => parseVariationContent(text), /ID・韓国語例文・日本語例文が必要/u, JSON.stringify(partial));
    assert.equal(validContentCSV('variation', text), false, JSON.stringify(partial));
  }
});

test('header-only, transient, incomplete and structurally invalid dedicated snapshots are rejected', () => {
  for (const text of ['', 'Loading…', csv([]), csv([{}]), csv([sample({id_sentence:''})]), csv([sample({例文_韓国語:''})]),
    csv([sample({例文_日本語:''})]), csv([sample({セットID:''})]), csv([sample({順番:''})]), csv([sample({順番:'0'})]),
    csv([sample({順番:'1.5'})]), csv([sample()],required.filter(header => header !== 'セットID')),
    csv([sample()],required.filter(header => header !== '順番')), csv([sample()],[...required,'順番']),
    'id,韓国語,日本語,例文_韓国語,例文_日本語\n1,먹다,食べる,먹어요.,食べます。']) {
    assert.throws(() => parseVariationContent(text));
  }
  assert.equal(parseVariationContent(csv([sample()]) + '\n\n,,,,\n').cards.length, 1);
  assert.throws(() => parseVariationContent(csv([sample(),sample({順番:'2'})])), /id_sentence.*重複/u);
  assert.throws(() => parseVariationContent(csv([sample(),sample({id_sentence:'other',順番:'１'})])), /順番.*重複/u);
  assert.throws(() => parseVariationContent(csv([sample(),sample({id_sentence:'incomplete',例文_日本語:''})])), /日本語例文/u);
});

test('dedicated membership rejects other reserved collections and dialogue rows instead of leaking them', () => {
  for (const genre of ['#conversation','#subtitle','#variation #subtitle','＃ＣＯＮＶＥＲＳＡＴＩＯＮ']) {
    assert.throws(() => parseVariationContent(csv([sample({ジャンル:genre})], [...required,'ジャンル'])), /会話・字幕/u);
  }
  for (const turn of ['1','not-a-turn']) {
    assert.throws(() => parseVariationContent(csv([sample({ターン:turn,話者:'A'})], [...required,'ターン','話者'])), /会話・字幕/u);
  }
  assert.throws(() => parseVariationContent(csv([sample({カテゴリ:'#subtitle'})], [...required,'カテゴリ'])), /会話・字幕/u);
});

test('the dedicated source owns variation while ordinary source objects and migrating IDs stay intact', () => {
  const regular = ordinary();
  const legacy = parseDeck('sentence', csv([sample({ジャンル:'#variation'})], [...required,'ジャンル'])).cards;
  const independent = parseVariationContent(csv([sample({例文_韓国語:'피자를 먹었어.',例文_日本語:'ピザを食べた。'})])).cards;
  const original = [...regular,...legacy];
  const before = JSON.stringify([original,independent]);
  const combined = combineSentenceSources(original, independent);
  assert.deepEqual(combined.map(card => card.id), ['sentence:regular','sentence:var_eat_001']);
  assert.equal(combined[0], regular[0]);
  assert.equal(combined[1], independent[0]);
  assert.equal(combined[1].han, '피자를 먹었어.');
  assert.deepEqual(combineSentenceSources(original, []), regular);
  assert.equal(JSON.stringify([original,independent]), before);
  assert.equal(buildVariationLessons(combined)[0].baseCard, independent[0]);
});

test('cross-source and dedicated ID collisions fail before a complete snapshot can be replaced', () => {
  const regular = ordinary();
  const dedicated = parseVariationContent(csv([sample()])).cards;
  const previous = combineSentenceSources(regular, dedicated);
  const collision = parseVariationContent(csv([sample({id_sentence:'regular'})])).cards;
  let current = previous;
  assert.throws(() => { current = combineSentenceSources(regular, collision); }, /固定ID.*重複/u);
  assert.equal(current, previous);
  assert.equal(regular[0].han, '집에 가요.');
  assert.throws(() => combineSentenceSources(regular, [dedicated[0],dedicated[0]]), /固定ID.*重複/u);
  assert.throws(() => combineSentenceSources([...regular,regular[0]], dedicated), /固定ID.*重複/u);
  assert.throws(() => combineSentenceSources(regular, [{...dedicated[0],id:'sentence:other',variation:{...dedicated[0].variation}},dedicated[0]]), /順番.*重複/u);
  for (const invalid of [{...dedicated[0],tags:'#ordinary'},{...dedicated[0],variation:{}},{...dedicated[0],deckId:'vocabulary'}]) {
    assert.throws(() => combineSentenceSources(regular, [invalid]));
  }
});

test('moving variation to its own source preserves mode-specific learning and leaves ordinary records independent', () => {
  const text = csv([sample({ジャンル:'#variation'})], [...required,'ジャンル']);
  const [legacy] = parseDeck('sentence', text).cards;
  const [moved] = parseVariationContent(csv([sample()])).cards;
  const records = restoreLearningRecords({version:3,records:{
    [legacy.id]:recordAssessment(getRecord(legacy), 'write', 'good', {correct:true,now:Date.parse('2026-11-14T00:00:00Z')}),
    'sentence:regular':recordAssessment(getRecord(ordinary()[0]), 'read', 'unsure', {correct:false}),
  }});
  assert.equal(moved.id, legacy.id);
  assert.equal(ratingFor(moved, records, 'write'), 'good');
  assert.equal(ratingFor(moved, records, 'read'), 'unseen');
  assert.equal(records[moved.id].assessments.write.attempts, 1);
  assert.equal(ratingFor(ordinary()[0], records, 'read'), 'unsure');
  const reordered = parseVariationContent(csv([sample({id_sentence:'second',順番:'2'}),sample()]));
  assert.equal(buildVariationLessons(reordered.cards)[0].baseCard.id, legacy.id);
});
