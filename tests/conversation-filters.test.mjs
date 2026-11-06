import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeck } from '../dist/assets/decks.js';
import { enrichConversationCards, buildConversationLessons } from '../dist/assets/conversations.js';
import { conversationFilterOptions, conversationLessonSearchText, normalizeConversationFilters, filterConversationLessons, unpracticedConversationLessons, randomConversationLesson } from '../dist/assets/conversation-filters.js';

const card = (id, meta) => ({id:`sentence:${id}`,sourceId:id,deckId:'sentence',tags:'#conversation',han:id,kanji:id,conversation:meta});
const lessons = buildConversationLessons([
  card('a2',{lessonId:'01',turn:2,speaker:'B',role:'返答',speechStyle:'丁寧',audience:'初対面',priority:'A',wordTags:'#shop #travel',usageNote:'ゆっくり答える'}),
  card('a1',{lessonId:'01',turn:1,speaker:'A',role:'質問',speechStyle:'丁寧',audience:'初対面',priority:'A',wordTags:'#shop',situation:'買い物の誘い'}),
  card('b1',{lessonId:'02',turn:1,speaker:'A',role:'返答',speechStyle:'タメ口',audience:'友達',priority:'B',wordTags:'＃ＳＨＯＰＰＩＮＧ',situation:'友達とご飯',usageNote:'相槌の練習'}),
  card('b2',{lessonId:'02',turn:2,speaker:'B',role:'質問',speechStyle:'タメ口',audience:'友達',priority:'B',wordTags:'#food'}),
  card('c1',{lessonId:'03',turn:1,speaker:'C',wordTags:'#shop\n#shop #Travel',situation:'次の予定'}),
]);
const ids = value => value.map(lesson=>lesson.id);

test('optional sentence source tags are kept as explicit metadata through enrichment and grouping', () => {
  const csv='id_sentence,例文_韓国語,例文_日本語,ジャンル,セットID,ターン,話者,単語由来タグ\none,가요,行きます,#conversation,lesson,1,A,#食事 #travel';
  const parsed=parseDeck('sentence',csv).cards;
  assert.equal(parsed[0].conversation.wordTags,'#食事 #travel');
  const enriched=enrichConversationCards(parsed,{});
  assert.equal(enriched[0].conversation.wordTags,'#食事 #travel');
  assert.equal(buildConversationLessons(enriched)[0].wordTags,'#食事 #travel');
  assert.equal(Object.hasOwn(parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語\nold,가요,行きます').cards[0],'conversation'),false);
});

test('filter options contain actual metadata and exact normalized tags without duplicates', () => {
  const options=conversationFilterOptions(lessons);
  assert.deepEqual(options.speaker,['A','B','C']);
  assert.deepEqual(options.speechStyle,['タメ口','丁寧']);
  assert.deepEqual(options.priority,['A','B']);
  assert.deepEqual(options.role,['質問','返答']);
  assert.deepEqual(options.wordTag,['food','shop','SHOPPING','travel']);
  assert.deepEqual(conversationFilterOptions(null),{speechStyle:[],audience:[],priority:[],role:[],speaker:[],wordTag:[]});
});

test('normalization only accepts bounded own string fields and a single tag stays canonical', () => {
  assert.deepEqual(normalizeConversationFilters({speechStyle:' 丁寧 ',priority:'Ａ',wordTag:'＃ＳＨＯＰ',speaker:2,unknown:'bad'}),
    {speechStyle:'丁寧',audience:'',priority:'A',role:'',speaker:'',wordTag:'SHOP'});
  assert.equal(normalizeConversationFilters({audience:'a'.repeat(201)}).audience,'');
  assert.equal(normalizeConversationFilters(Object.create({speaker:'B'})).speaker,'');
  assert.deepEqual(normalizeConversationFilters(null),normalizeConversationFilters([]));
  assert.deepEqual(filterConversationLessons(lessons,{filters:{wordTag:'#shop #travel'}}),[]);
});

test('all metadata filters match on the same utterance and return the whole ordered dialogue', () => {
  const before=JSON.stringify(lessons);
  const selected=filterConversationLessons(lessons,{filters:{speaker:'B',role:'返答',speechStyle:'丁寧',audience:'初対面',priority:'Ａ',wordTag:'#SHOP'}});
  assert.deepEqual(ids(selected),['conversation:01']);
  assert.equal(selected[0],lessons[0]);
  assert.equal(selected[0].cards,lessons[0].cards);
  assert.deepEqual(selected[0].cards.map(card=>card.sourceId),['a1','a2']);
  assert.equal(JSON.stringify(lessons),before);
  assert.deepEqual(ids(filterConversationLessons(lessons,{filters:{speaker:'B',role:'返答',speechStyle:'タメ口'}})),[]);
  assert.deepEqual(ids(filterConversationLessons(lessons,{filters:{wordTag:'shop'}})),['conversation:01','conversation:03']);
  assert.deepEqual(ids(filterConversationLessons(lessons,{filters:{wordTag:'shopping'}})),['conversation:02']);
});

test('text search includes situation, category, notes and tags while respecting the selected group', () => {
  const categorized=lessons.map((lesson,index)=>({...lesson,category:index===1?'日常':'交流'}));
  assert.deepEqual(ids(filterConversationLessons(categorized,{query:'相槌'})),['conversation:02']);
  assert.deepEqual(ids(filterConversationLessons(categorized,{query:'予定'})),['conversation:03']);
  assert.deepEqual(ids(filterConversationLessons(categorized,{query:'ＳＨＯＰ'})),['conversation:01','conversation:02','conversation:03']);
  assert.deepEqual(ids(filterConversationLessons(categorized,{query:'交流'})),['conversation:01','conversation:03']);
  assert.deepEqual(ids(filterConversationLessons(categorized,{query:'相槌',group:'交流'})),[]);
  assert.deepEqual(ids(filterConversationLessons(categorized,{group:'日常'})),['conversation:02']);
  assert.deepEqual(ids(filterConversationLessons(lessons,{group:'会話'})),ids(lessons));
  assert.deepEqual(filterConversationLessons(lessons,{group:'日常'}),[]);
  assert.deepEqual(filterConversationLessons(null),[]);
  assert.deepEqual(filterConversationLessons([{cards:[]},null,{}]),[]);
});

test('shared search text matches field boundaries and utterance-level categories consistently', () => {
  const first={...lessons[0],category:'交流',cards:lessons[0].cards.map((card,index)=>index?card:{...card,conversation:{...card.conversation,category:'発話側カテゴリ'}})};
  const source=[first,...lessons.slice(1)];
  const text=conversationLessonSearchText(first);
  assert.ok(text.includes('買い物の誘い 交流'));
  assert.ok(text.includes('発話側カテゴリ'));
  assert.deepEqual(ids(filterConversationLessons(source,{query:'誘い 交流'})),['conversation:01']);
  assert.deepEqual(ids(filterConversationLessons(source,{query:'発話側カテゴリ'})),['conversation:01']);
  assert.equal(conversationLessonSearchText(null),'');
});

test('unpracticed scenes exclude any attempted turn, including unanswered attempts, independently by direction', () => {
  const records = {
    [lessons[0].cards[0].id]: { assessments: { read: { rating: 'unseen', attempts: 1 } } },
    [lessons[1].cards[0].id]: { assessments: { write: { rating: 'good', history: [{correct:true}] } } },
  };
  const before = JSON.stringify({lessons,records});
  assert.deepEqual(ids(unpracticedConversationLessons(lessons, records, 'read')), ['conversation:02','conversation:03']);
  assert.deepEqual(ids(unpracticedConversationLessons(lessons, records, 'write')), ['conversation:01','conversation:03']);
  assert.deepEqual(ids(unpracticedConversationLessons(lessons)), ids(lessons));
  assert.equal(JSON.stringify({lessons,records}), before);
  const matches = filterConversationLessons(lessons,{filters:{speechStyle:'丁寧'}});
  assert.equal(randomConversationLesson(unpracticedConversationLessons(matches,records,'read')), null);
  assert.deepEqual(unpracticedConversationLessons(null), []);
});

test('random selection is over complete lessons, excludes the current lesson when possible, and never mutates', () => {
  const before=JSON.stringify(lessons);
  assert.equal(randomConversationLesson(lessons,{random:()=>0}),lessons[0]);
  assert.equal(randomConversationLesson(lessons,{random:()=>.34}),lessons[1]);
  assert.equal(randomConversationLesson(lessons,{random:()=>.99}),lessons[2]);
  assert.equal(randomConversationLesson(lessons,{excludeId:lessons[0].id,random:()=>0}),lessons[1]);
  assert.equal(randomConversationLesson(lessons,{excludeId:lessons[0].id,random:()=>.99}),lessons[2]);
  assert.equal(randomConversationLesson([lessons[0]],{excludeId:lessons[0].id,random:()=>0}),lessons[0]);
  assert.equal(randomConversationLesson([]),null);
  assert.equal(randomConversationLesson(null),null);
  assert.equal(randomConversationLesson(lessons,{random:()=>-1}),lessons[0]);
  assert.equal(randomConversationLesson(lessons,{random:()=>1}),lessons[2]);
  assert.equal(randomConversationLesson(lessons,{random:()=>NaN}),lessons[0]);
  assert.equal(JSON.stringify(lessons),before);
});

test('the shipped 158 lessons retain all seven ordered turns after filtering and random selection', () => {
  const source=readFileSync(new URL('../dist/data/startup/sentence.csv',import.meta.url),'utf8');
  const all=buildConversationLessons(enrichConversationCards(parseDeck('sentence',source).cards));
  assert.equal(all.length,158);
  const selected=filterConversationLessons(all,{filters:{speaker:'B',role:'返答',priority:'A'}});
  assert.ok(selected.length>0 && selected.length<all.length);
  for(const lesson of selected) {
    assert.equal(lesson,all.find(item=>item.id===lesson.id));
    assert.deepEqual(lesson.cards.map(card=>card.conversation.turn),[1,2,3,4,5,6,7]);
  }
  const excluded=selected[0].id;
  for(const sample of [0,.25,.5,.999]) {
    const lesson=randomConversationLesson(selected,{excludeId:excluded,random:()=>sample});
    assert.ok(selected.includes(lesson));
    assert.notEqual(lesson.id,excluded);
    assert.deepEqual(lesson.cards.map(card=>card.conversation.turn),[1,2,3,4,5,6,7]);
  }
  assert.deepEqual(filterConversationLessons(all,{filters:{speaker:'B',role:'話題開始・質問'}}),[]);
});
