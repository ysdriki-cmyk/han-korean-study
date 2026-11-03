import test from 'node:test';
import assert from 'node:assert/strict';
import { assessmentForAttempt } from '../dist/assets/practice.js';
import { recordAssessment, filterAssessments } from '../dist/assets/assessment.js';
import { getRecord } from '../dist/assets/learning.js';
import { applyReviewSchedule, nextReviewFor, mistakeCoolingDown } from '../dist/assets/review.js';
import { applyBulkRating } from '../dist/assets/bulk-rating.js';

const OLD = '2026-10-20T00:00:00.000Z';
const NOW = '2026-11-03T00:00:00.000Z';
const ratings = ['hard','again','unsure','good','solid','unseen'];

test('fresh attempts retain the existing first-attempt defaults', () => {
  const card = {id:'vocabulary:1',han:'가'};
  for (const mode of ['read','write']) {
    assert.deepEqual(assessmentForAttempt(card,{},mode,true), {rating:'good',ratingRetained:false});
    assert.deepEqual(assessmentForAttempt(card,{},mode,false), {rating:'again',ratingRetained:false});
    assert.deepEqual(assessmentForAttempt(card,{},mode,null), {rating:mode==='read'?'unsure':'unseen',ratingRetained:false});
  }
});

test('repeat attempts keep all six prior statuses on wrong/blank and use good on correct', () => {
  for (const deck of ['kanji','vocabulary','sentence']) for (const mode of ['read','write']) for (const previous of ratings) {
    const card = {id:`${deck}:1`,han:'가'};
    const other = mode === 'read' ? 'write' : 'read';
    let source = recordAssessment(getRecord(card),mode,previous,{correct:true,now:OLD});
    source = recordAssessment(source,other,'solid',{correct:true,now:OLD});
    const records = {[card.id]:source};
    const before = JSON.stringify(records);
    for (const correct of [true,false,null]) {
      const result = assessmentForAttempt(card,records,mode,correct);
      assert.equal(result.rating,correct===true?'good':previous);
      assert.equal(result.ratingRetained,correct!==true);
      const saved = JSON.parse(JSON.stringify(recordAssessment(source,mode,result.rating,{correct,ratingRetained:result.ratingRetained,now:NOW})));
      assert.equal(saved.assessments[mode].attempts,2);
      assert.equal(saved.assessments[mode].correct,1+Number(correct===true));
      assert.equal(saved.assessments[mode].wrong,Number(correct===false));
      assert.equal(saved.assessments[mode].history.at(-1).correct,correct);
      assert.equal(saved.assessments[mode].history[0].rating,previous);
      assert.deepEqual(saved.assessments[other],source.assessments[other]);
      assert.equal(JSON.stringify(records),before);
    }
  }
});

test('list edits establish a default even with no attempts, while other directions stay fresh', () => {
  const card = {id:'vocabulary:1',han:'가'};
  for (const rating of ratings) {
    const {records} = applyBulkRating([card],{},[card.id],'read',rating,OLD);
    assert.equal(assessmentForAttempt(card,records,'read',null).rating,rating);
    assert.equal(assessmentForAttempt(card,records,'read',false).rating,rating);
    assert.equal(assessmentForAttempt(card,records,'write',false).rating,'again');
  }
});

test('retained confidence never conceals an objective mistake or creates a false success streak', () => {
  const card = {id:'sentence:1',han:'가'};
  let record = getRecord(card);
  for (let i=0;i<4;i++) record = recordAssessment(record,'read','solid',{correct:true,now:OLD});
  const retained = recordAssessment(record,'read','solid',{correct:null,ratingRetained:true,now:NOW});
  const blank = applyReviewSchedule(retained,'read','solid',NOW);
  assert.equal(nextReviewFor(blank,'read',NOW).intervalDays,5);
  const wrong = applyReviewSchedule(recordAssessment(record,'read','solid',{correct:false,ratingRetained:true,now:NOW}),'read','solid',NOW);
  assert.equal(nextReviewFor(wrong,'read',NOW).intervalDays,2);
  assert.equal(mistakeCoolingDown(card,{[card.id]:wrong},'read',NOW),true);
  assert.equal(filterAssessments([card],{[card.id]:wrong},{mode:'read',recentMistakesDays:7},NOW).length,1);
  const manuallyRated = recordAssessment(blank,'read','solid',{countAttempt:false,now:NOW});
  assert.equal(manuallyRated.assessments.read.history.at(-1).ratingRetained,undefined);
  assert.equal(manuallyRated.assessments.read.attempts,5);
});

test('a blank preserved cross does not invent a newly dated mistake', () => {
  const card = {id:'vocabulary:1',han:'가'};
  const {records} = applyBulkRating([card],{},[card.id],'read','again',OLD);
  const blank = recordAssessment(records[card.id],'read','again',{correct:null,ratingRetained:true,now:NOW});
  assert.equal(blank.assessments.read.wrong,0);
  assert.equal(filterAssessments([card],{[card.id]:blank},{mode:'read',recentMistakesDays:7},NOW).length,0);
  assert.equal(mistakeCoolingDown(card,{[card.id]:blank},'read',NOW),false);
});
