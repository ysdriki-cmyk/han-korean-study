import test from 'node:test';
import assert from 'node:assert/strict';
import { readingAssessment, speakReadingQuestion } from '../dist/assets/reading.js';
import { getRecord } from '../dist/assets/learning.js';
import { recordAssessment } from '../dist/assets/assessment.js';
import { applyReviewSchedule, nextReviewFor } from '../dist/assets/review.js';

const card = { id:'vocabulary:1', han:'집', kanji:'家、住宅', english:'house / home', notes:'建物', exampleJp:'家に帰ります' };
const NOW = '2026-10-28T00:00:00.000Z';

test('blank Korean-first answers default to unsure without marking them right or wrong', () => {
  for (const input of ['', '　 \n', null, undefined]) {
    assert.deepEqual(readingAssessment(card,input,'vocabulary'),{correct:null,rating:'unsure'});
  }
  const record=applyReviewSchedule(recordAssessment(getRecord(card),'read','unsure',{correct:null,now:NOW}),'read','unsure',NOW);
  assert.equal(record.assessments.read.attempts,1);
  assert.equal(record.assessments.read.correct,0);
  assert.equal(record.assessments.read.wrong,0);
  assert.equal(nextReviewFor(record,'read',NOW).intervalDays,1);
});

test('explicit Japanese and English translations produce good without guessed synonyms or substrings', () => {
  for(const answer of ['家','住宅','家、住宅','house','home','house / home']) {
    assert.deepEqual(readingAssessment(card,answer,'vocabulary'),{correct:true,rating:'good'},answer);
  }
  for(const answer of ['建物','家に帰ります','ho','帰宅','집','.']) {
    assert.deepEqual(readingAssessment(card,answer,'vocabulary'),{correct:false,rating:'again'},answer);
  }
});

test('grading ignores width, case, whitespace, final punctuation and optional qualifiers', () => {
  assert.equal(readingAssessment(card,' ＨＯＭＥ。 ','vocabulary').correct,true);
  assert.equal(readingAssessment({...card,kanji:'（人を）呼ぶ、計る（寸法・長さなど）'},'呼ぶ','vocabulary').correct,true);
  assert.equal(readingAssessment({...card,kanji:'（人を）呼ぶ、計る（寸法・長さなど）'},'計る','vocabulary').correct,true);
  assert.equal(readingAssessment({...card,kanji:'（口笛、楽器などを）吹く'},'楽器','vocabulary').correct,false);
  assert.equal(readingAssessment({...card,kanji:'学校に 行く'},'学校に行く','vocabulary').correct,true);
});

test('kanji recognition accepts the source characters and meaning alternatives without Korean annotations', () => {
  const kanji={han:'불',kanji:'不、火〔（風が）吹く、（口笛、楽器などを）吹く 다〕',hanja:'弗',meaning:'補足の意味'};
  const before=JSON.stringify(kanji);
  for(const answer of ['不','火','吹く','（風が）吹く','弗','補足の意味'])assert.equal(readingAssessment(kanji,answer,'kanji').correct,true,answer);
  for(const answer of ['風','口笛','다','불'])assert.equal(readingAssessment(kanji,answer,'kanji').correct,false,answer);
  assert.equal(JSON.stringify(kanji),before);
});

test('changing a default recognition grade does not count another attempt or lose its objective result', () => {
  for(const input of ['家','違う答え','']) {
    const grade=readingAssessment(card,input,'vocabulary');
    const graded=applyReviewSchedule(recordAssessment(getRecord(card),'read',grade.rating,{correct:grade.correct,now:NOW}),'read',grade.rating,NOW);
    const adjusted=applyReviewSchedule(recordAssessment(graded,'read','solid',{countAttempt:false,now:NOW}),'read','solid',NOW);
    const saved=JSON.parse(JSON.stringify(adjusted));
    assert.equal(saved.assessments.read.attempts,1);
    assert.equal(saved.assessments.read.history.length,1);
    assert.equal(saved.assessments.read.history[0].correct,grade.correct);
    assert.equal(saved.assessments.read.correct,Number(grade.correct===true));
    assert.equal(saved.assessments.read.wrong,Number(grade.correct===false));
    assert.equal(saved.assessments.read.rating,'solid');
    assert.equal(saved.assessments.write,undefined);
    assert.equal(graded.assessments.read.rating,grade.rating);
  }
});

test('question audio is synchronous and limited to Korean-first study cards in the visible view', () => {
  const spoken=[];
  let insideAction=true;
  const speaker={toggle(text){assert.equal(insideAction,true);spoken.push(text);return true;}};
  assert.equal(speakReadingQuestion({speaker,card,mode:'read',view:'study'}),true);
  assert.equal(speakReadingQuestion({speaker,card:{...card,han:'나'},mode:'read',view:'study'}),true);
  insideAction=false;
  for(const overrides of [{mode:'write'},{view:'library'},{view:'progress'},{visible:false},{card:undefined},{card:{han:''}}]) {
    assert.equal(speakReadingQuestion({speaker,card,mode:'read',view:'study',...overrides}),false);
  }
  assert.deepEqual(spoken,['집','나']);
});
