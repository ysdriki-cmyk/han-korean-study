import { resolveSentenceWords } from './sentences.js?v=5';

const clean=value=>String(value??'').normalize('NFC').trim();
const sentenceKey=value=>clean(value).normalize('NFKC').replace(/\s+/gu,'').replace(/[。.!！?？]+$/u,'');
const indexes=new WeakMap();
const referenceKeys=row=>row.words.length
  ? row.words.map(word=>`id:${word.id}`)
  : !row.wordId && row.korean ? [`term:${clean(row.korean)}`] : [];

function exampleIndex(sentences,words) {
  let dictionaries=indexes.get(sentences);
  if (!dictionaries) { dictionaries=new WeakMap(); indexes.set(sentences,dictionaries); }
  if (dictionaries.has(words)) return dictionaries.get(words);
  const index=new Map();
  for (const card of sentences) {
    const resolved=resolveSentenceWords(card,words);
    const keys=new Set([...resolved.rows,...(resolved.main?[resolved.main]:[])].flatMap(referenceKeys));
    const example={korean:clean(card.han),japanese:clean(card.kanji),lessonId:clean(card.conversation?.lessonId)};
    for(const key of keys) {
      if(!index.has(key))index.set(key,[]);
      index.get(key).push(example);
    }
  }
  dictionaries.set(words,index);
  return index;
}

/** Match explicit word references and senses, never a Hangul substring in a sentence. */
export function findSentenceWordExamples(row,words=[],sentences=[],current={}) {
  if(!row)return [];
  const index=exampleIndex(sentences,words);
  const candidates=[
    ...row.words.map(word=>({korean:clean(word.exampleKo),japanese:clean(word.exampleJp),lessonId:''})),
    ...referenceKeys(row).flatMap(key=>index.get(key)||[]),
  ];
  const currentText=sentenceKey(current.han),lessonId=clean(current.conversation?.lessonId);
  const seen=new Set(),result=[];
  for(const example of candidates) {
    if(!example.korean && !example.japanese)continue;
    if(example.korean && currentText && sentenceKey(example.korean)===currentText)continue;
    if(lessonId && example.lessonId===lessonId)continue;
    const key=JSON.stringify([sentenceKey(example.korean),clean(example.japanese)]);
    if(seen.has(key))continue;
    seen.add(key);result.push({korean:example.korean,japanese:example.japanese});
  }
  return result;
}
