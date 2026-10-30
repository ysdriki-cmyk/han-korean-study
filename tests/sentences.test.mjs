import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck, answerFields, restoreLearningRecords } from '../dist/assets/decks.js';
import { sentencesFromVocabulary, matchSentenceAnswer } from '../dist/assets/sentences.js';
import { readingAssessment } from '../dist/assets/reading.js';
import { projectSentenceSets, cardsForStudySet, setProgress } from '../dist/assets/study-sets.js';
import { parseCategorySheet } from '../dist/assets/category-sheet.js';
import { getRecord } from '../dist/assets/learning.js';
import { recordAssessment, writingAssessment, ratingFor } from '../dist/assets/assessment.js';
import { applyReviewSchedule } from '../dist/assets/review.js';
import { practicePool, practiceSettings, restorePracticePreferences } from '../dist/assets/practice.js';

const csv = 'id,韓国語,英語,日本語,例文_韓国語,例文_日本語,カテゴリ,TOPIK1,state,別解\n1,집,house,家,집에 가요.,家に帰ります。,#暮らし,#初級,read2,댁\n2,가다,go,行く,집에 가요.,家に帰ります。,#移動,,mastered,\n3,차,tea,お茶,차를 마셔요.,,#暮らし,,,\n4,말,word,言葉,,話します,#会話,,,';

test('sentence cards require both example languages and retain separate source word identities', () => {
  const words = parseDeck('vocabulary', csv).cards;
  const before = JSON.stringify(words);
  const cards = sentencesFromVocabulary(words);
  assert.deepEqual(cards.map(card => card.id), ['sentence:1', 'sentence:2']);
  assert.equal(cards[0].han, '집에 가요.');
  assert.equal(cards[0].kanji, '家に帰ります。');
  assert.equal(cards[0].sourceWord.id, 'vocabulary:1');
  assert.deepEqual([cards[0].sourceWord.han, cards[0].sourceWord.english, cards[0].sourceWord.kanji], ['집', 'house', '家']);
  assert.equal(ratingFor(cards[0], {}, 'write'), 'unseen');
  assert.equal(ratingFor(cards[0], {}, 'read'), 'unseen');
  assert.deepEqual(cards[0].answerVariants, []);
  assert.equal(JSON.stringify(words), before);
  assert.deepEqual(answerFields(cards[0], 'sentence'), [{label:'日本語',text:'家に帰ります。',lang:'ja'}]);
  assert.deepEqual(parseDeck('sentence', csv).cards.map(card => card.id), cards.map(card => card.id));
  assert.equal(parseDeck('sentence', 'id,韓国語,日本語\n1,집,家').cards.length, 0);
});

test('whole-sentence grading ignores whitespace and final punctuation, but rejects word answers and fragments', () => {
  assert.equal(matchSentenceAnswer(' 집 에 가요！ ', '집에 가요.'), true);
  assert.equal(matchSentenceAnswer('집에 가요'.normalize('NFD'), '집에 가요.'), true);
  for (const input of ['집', '댁', '가요', '', '집에 와요.', '집에 가요. 다른 문장']) assert.equal(matchSentenceAnswer(input, '집에 가요.'), false);
  const card = {kanji:'今日は、家に帰ります。'};
  assert.deepEqual(readingAssessment(card, '今日は', 'sentence'), {correct:false,rating:'again'});
  assert.deepEqual(readingAssessment(card, ' 今日は、家に帰ります！ ', 'sentence'), {correct:true,rating:'good'});
  assert.deepEqual(readingAssessment(card, '', 'sentence'), {correct:null,rating:'unsure'});
});

test('word-sheet sets select original word columns and retain only their complete sentence pairs', () => {
  const words = parseDeck('vocabulary', csv).cards;
  const cards = sentencesFromVocabulary(words);
  const header = 'category_id,カテゴリ名,教材,対象列,条件,値,条件の結合,表示順';
  const {sets, warnings} = parseCategorySheet(header + '\nall,すべて,word,,全件,,AND,1\nliving,暮らし,word,カテゴリ,タグ一致,#暮らし,AND,2\nword,家という単語,word,韓国語,等しい,집,AND,3\nmissing,例文なし,word,日本語,等しい,お茶,AND,4');
  assert.deepEqual(warnings, []);
  const projected = projectSentenceSets(sets);
  assert.deepEqual(projected.map(set => cardsForStudySet(cards, set).map(card => card.id)), [['sentence:1','sentence:2'], ['sentence:1'], ['sentence:1'], []]);
  const reordered = sentencesFromVocabulary([...words].reverse().map(word => ({...word,exampleKo:word.exampleKo ? word.exampleKo + '!' : ''})));
  assert.deepEqual(cardsForStudySet(reordered, projected[1]).map(card => card.id), ['sentence:1']);
  assert.equal(cardsForStudySet(cards, {...projected[0],sourceSet:{deckId:'kanji'}}).length, 0);
});

test('sentence learning, saved preferences and review dates remain independent from words and direction', () => {
  const [card] = sentencesFromVocabulary(parseDeck('vocabulary', csv).cards);
  const now = Date.parse('2026-10-30T00:00:00Z'), day = 86400000;
  let record = applyReviewSchedule(recordAssessment(getRecord(card), 'write', writingAssessment('unseen', true), {correct:true,now}), 'write', 'good', now);
  const saved = restoreLearningRecords(JSON.parse(JSON.stringify({version:3,records:{[card.id]:record,'vocabulary:1':{rank:'fair'}}})));
  assert.equal(saved[card.id].assessments.write.attempts, 1);
  assert.equal(ratingFor(card,saved,'write'),'good');
  assert.equal(ratingFor(card,saved,'read'),'unseen');
  assert.equal(saved['vocabulary:1'].rank,'fair');
  assert.equal(practicePool([card],saved,{...practiceSettings(),scope:'all'},now+4*day).length,0);
  assert.equal(practicePool([card],saved,{...practiceSettings(),scope:'all'},now+5*day).length,1);
  assert.equal(setProgress([card],saved,'write').masteredPercent,100);
  const prefs=restorePracticePreferences({version:4,modeDefaultsVersion:1,deckId:'sentence',courses:{sentence:{mode:'read',limit:'20'},vocabulary:{mode:'write'}}});
  assert.equal(prefs.deckId,'sentence');
  assert.equal(prefs.courses.sentence.mode,'read');
  assert.equal(prefs.courses.sentence.limit,'20');
  assert.equal(prefs.courses.vocabulary.mode,'write');
  record=applyReviewSchedule(recordAssessment(record,'write','again',{correct:false,now:now+6*day}),'write','again',now+6*day);
  assert.equal(practicePool([card],{[card.id]:record},{...practiceSettings(),scope:'all'},now+7*day).length,0);
  assert.equal(practicePool([card],{[card.id]:record},{...practiceSettings(),scope:'all',sessionType:'review'},now+7*day).length,1);
});
