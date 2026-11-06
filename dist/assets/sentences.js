import { normalizeVocabulary, acceptedVocabularyAnswers } from './vocabulary.js';
import { parseCSV } from './core.js';
import { categoryLabels, sheetHeader } from './sheet-fields.js';
import { normalizeConversationMetadata } from './conversations.js?v=2';

const clean = value => String(value ?? '').normalize('NFC').trim();
const normalizeAnswer = value => clean(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replace(/[。.!！?？]+$/u, '');
const dictionaries=new WeakMap();
function dictionaryFor(words) {
  if (dictionaries.has(words)) return dictionaries.get(words);
  const ids=new Map(), terms=new Map();
  for (const word of words) {
    const id=String(word.sourceId ?? word.id).replace(/^vocabulary:/u,'');
    if (!ids.has(id)) ids.set(id,[]); ids.get(id).push(word);
    for (const term of new Set([clean(word.han),...acceptedVocabularyAnswers(word)])) {
      if (!terms.has(term)) terms.set(term,[]); terms.get(term).push(word);
    }
  }
  const result={ids,terms}; dictionaries.set(words,result); return result;
}

/** One complete example pair per source word; vocabulary ranks never become sentence progress. */
export function sentencesFromVocabulary(words) {
  return words.filter(word => clean(word.exampleKo) && clean(word.exampleJp)).map(word => ({
    ...word,
    id: `sentence:${word.sourceId ?? word.id}`,
    sourceId: word.sourceId ?? word.id,
    deckId: 'sentence', kind: 'sentence',
    han: clean(word.exampleKo), kanji: clean(word.exampleJp),
    hanja: '', meaning: '', english: '', state: '', flagged: false,
    exampleKo: '', exampleJp: '', answerVariants: [], synonyms: '', notes: '', translation2: '',
    sourceWord: word.deckId === 'vocabulary' ? word : { ...word, id: `vocabulary:${word.id}`, sourceId: word.id, deckId: 'vocabulary' },
  }));
}

export function normalizeSentences(text) {
  const rows = parseCSV(text), headers = (rows[0] || []).map(value => sheetHeader(value).normalize('NFKC'));
  if (!headers.includes('id_sentence') && headers.includes('韓国語')) {
    const source = normalizeVocabulary(text);
    return { ...source, cards: sentencesFromVocabulary(source.cards).map(card => ({ ...card, id: card.sourceId,
      mainKorean: card.sourceWord.han, mainWordId: String(card.sourceWord.sourceId ?? card.sourceWord.id).replace(/^vocabulary:/u,''),
      sentenceRefs: [{position:1,korean:card.sourceWord.han,wordId:String(card.sourceWord.sourceId ?? card.sourceWord.id).replace(/^vocabulary:/u,''),surface:'',translation:''}],
    })) };
  }
  for (const header of ['id_sentence','例文_韓国語','例文_日本語']) {
    if (headers.filter(value => value === header).length !== 1) throw new Error(`sentence CSVに一意の「${header}」列が必要です。`);
  }
  const numbered = headers.map((header,index) => ({match:/^使用韓国語_([1-9][0-9]*)$/u.exec(header),index})).filter(item=>item.match)
    .map(item=>({position:Number(item.match[1]),column:item.index})).sort((a,b)=>a.position-b.position);
  if (new Set(numbered.map(item=>item.position)).size !== numbered.length) throw new Error('使用韓国語の番号列が重複しています。');
  const cards = [], warnings = [], ids = new Set(); let excludedRows = 0;
  for (let index=1;index<rows.length;index++) {
    const row=rows[index]; if (row.every(value=>!clean(value))) continue;
    const value = header => clean(row[headers.indexOf(sheetHeader(header).normalize('NFKC'))]);
    const id=value('id_sentence'), han=value('例文_韓国語'), kanji=value('例文_日本語');
    if (!id || !han || !kanji) { excludedRows++; warnings.push(`${index+1}行目: ID・韓国語例文・日本語例文が必要です。`); continue; }
    if (ids.has(id)) throw new Error(`${index+1}行目: id_sentence「${id}」が重複しています。`);
    ids.add(id);
    const sentenceRefs=numbered.map(({position,column})=>({position,korean:clean(row[column]),wordId:value(`使用単語ID_${position}`),surface:value(`文中表記_${position}`),translation:value(`文中訳_${position}`)}))
      .filter(ref=>ref.korean || ref.wordId);
    const tags=value('ジャンル') || value('カテゴリ');
    const conversation=normalizeConversationMetadata({lessonId:value('セットID'),situation:value('シチュエーション'),
      category:value('会話カテゴリ') || value('カテゴリ'),categoryNo:value('カテゴリ番号'),turn:value('ターン'),speaker:value('話者'),
      role:value('会話の役割'),speechStyle:value('話し方'),audience:value('距離感・対象'),priority:value('学習優先度'),usageNote:value('使い方メモ'),wordTags:value('単語由来タグ')});
    cards.push({id,han,kanji,hanja:'',meaning:'',english:'',state:'',flagged:false,kind:'sentence',exampleKo:'',exampleJp:'',answerVariants:[],synonyms:'',
      notes:value('備考'),translation2:value('訳2'),tags,categories:categoryLabels(tags),mainKorean:value('使用韓国語_main'),mainWordId:value('使用単語ID_main'),sentenceRefs,
      ...(Object.keys(conversation).length ? {conversation} : {})});
  }
  return {cards,warnings,excludedRows};
}

/** Exact dictionary lookup. Inflected forms are supplied separately, never guessed. */
export function resolveSentenceWords(card, words = []) {
  const warnings=[],issues=[],dictionary=dictionaryFor(words);
  const resolve = ref => {
    const korean=clean(ref.korean), wordId=clean(ref.wordId).replace(/^vocabulary:/u,'');
    const termMatches=word=>clean(word.han)===korean || acceptedVocabularyAnswers(word).includes(korean);
    const matches=(wordId ? dictionary.ids.get(wordId) : dictionary.terms.get(korean)) || [];
    const valid=wordId && korean && matches.some(word=>!termMatches(word)) ? [] : matches;
    const issue=reason=>issues.push({sentenceId:String(card.sourceId ?? card.id).replace(/^sentence:/u,''),column:ref.position?`使用韓国語_${ref.position}`:'使用韓国語_main',korean,wordId,surface:clean(ref.surface),reason});
    if (!valid.length) { warnings.push(`sentence:${card.sourceId ?? card.id}: 単語「${korean || wordId}」がhan_wordsと一致しません。`); issue(matches.length?'韓国語とIDが不一致':wordId?'IDが未登録':'単語が未登録'); }
    if (valid.length>1) { warnings.push(`sentence:${card.sourceId ?? card.id}: 単語「${korean}」に複数候補があります。使用単語IDで指定できます。`); issue('同じ表記に複数候補'); }
    const unique = values => [...new Set(values.map(clean).filter(Boolean))].join('／');
    return {...ref,korean,surface:clean(ref.surface) || korean || valid[0]?.han || '',lemma:valid[0]?.han || korean,
      japanese:clean(ref.translation) || unique(valid.map(word=>word.kanji)),english:unique(valid.map(word=>word.english || word.meaning)),words:valid};
  };
  const refs=card.sentenceRefs || (card.sourceWord ? [{position:1,korean:card.sourceWord.han,wordId:card.sourceWord.sourceId ?? card.sourceWord.id,surface:'',translation:''}] : []);
  const rows=refs.map(resolve);
  const mainTerm=clean(card.mainKorean) || (!card.sentenceRefs && card.sourceWord?.han) || '';
  const mainId=clean(card.mainWordId) || (!card.sentenceRefs && card.sourceWord?.sourceId) || '';
  const main=mainTerm || mainId ? resolve({korean:mainTerm,wordId:mainId,surface:'',translation:''}) : null;
  for (const row of rows) row.main=Boolean(main && (row.words.some(word=>main.words.some(item=>item.id===word.id)) || (!row.wordId && !main.wordId && row.korean===main.korean)));
  return {rows:rows.length ? rows : main ? [{...main,main:true}] : [],main,warnings:[...new Set(warnings)],issues};
}

export function sentenceWordIssues(cards,words) {
  const groups=new Map();
  for (const card of cards) for (const issue of resolveSentenceWords(card,words).issues) {
    const key=JSON.stringify([issue.korean,issue.wordId,issue.reason]);
    if (!groups.has(key)) groups.set(key,{korean:issue.korean,wordId:issue.wordId,reason:issue.reason,surfaces:[],references:[]});
    const group=groups.get(key);
    if (issue.surface && !group.surfaces.includes(issue.surface)) group.surfaces.push(issue.surface);
    const reference=`${issue.sentenceId}:${issue.column}`;
    if (!group.references.includes(reference)) group.references.push(reference);
  }
  return [...groups.values()];
}

export function linkSentenceWords(cards, words) {
  const warnings=[];
  const linked=cards.map(card=>{
    const result=resolveSentenceWords(card,words); warnings.push(...result.warnings);
    const sourceWords=[...new Map([...result.rows.flatMap(row=>row.words),...(result.main?.words || [])].map(word=>[word.id,word])).values()];
    const mainWord=result.main?.words[0] || null;
    return {...card,sourceWords,mainWord,sourceWord:mainWord || sourceWords[0] || null};
  });
  return {cards:linked,warnings:[...new Set(warnings)]};
}

/** Grade a whole source sentence. Word fragments, synonyms and word-level alternatives do not pass. */
export function matchSentenceAnswer(input, answer) {
  const expected = normalizeAnswer(answer), submitted = normalizeAnswer(input);
  return Boolean(expected && submitted && expected === submitted);
}
