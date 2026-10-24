import {normalizeCards} from './core.js';
import {normalizeVocabulary} from './vocabulary.js';
import {getRecord, migrateLegacy} from './learning.js';

export const DECKS = Object.freeze([
  Object.freeze({id:'vocabulary',label:'単語',subtitle:'韓国語 ↔ 日本語・英語',answerLabel:'日本語・英語',answerShort:'訳',answerKicker:'JAPANESE / ENGLISH',path:'./data/vocabulary.csv',parse:normalizeVocabulary}),
  Object.freeze({id:'kanji',label:'漢字',subtitle:'ハングル ↔ 漢字・意味',answerLabel:'漢字・意味',answerShort:'漢',answerKicker:'KANJI / MEANING',path:'./data/cards.csv',parse:normalizeCards})
]);
export function getDeck(id){return DECKS.find(deck=>deck.id===id)||DECKS[0];}
export function namespaceCards(cards,deckId){
  if(!DECKS.some(deck=>deck.id===deckId))throw new Error('学習コースを確認してください。');
  return cards.map(card=>({...card,sourceId:card.id,id:`${deckId}:${card.id}`,deckId}));
}
export function parseDeck(deckId,text){
  const deck=getDeck(deckId);
  const result=deck.parse(text);
  if(!result.cards.length)throw new Error('学習できることばがありません。');
  return {...result,cards:namespaceCards(result.cards,deck.id)};
}

/** Only the old kanji course existed before namespaced records were introduced. */
export function restoreLearningRecords(current,previous,legacy){
  const output=Object.create(null);
  const map=current?.version===3?current.records:previous?.version===2?previous.records:null;
  if(map&&typeof map==='object'&&!Array.isArray(map)){
    for(const [oldId,value] of Object.entries(map)){
      if(!value||typeof value!=='object'||Array.isArray(value))continue;
      const id=current?.version===3?oldId:`kanji:${oldId}`;
      if(!/^(kanji|vocabulary):.+$/.test(id))continue;
      output[id]=getRecord({id,state:'',flagged:false},{[id]:value});
    }
    return output;
  }
  const oldIds=new Set();
  if(legacy&&typeof legacy==='object'&&!Array.isArray(legacy)){
    for(const key of Object.keys(legacy)){const match=/^(?:ko-han|han-ko):(.+)$/.exec(key);if(match)oldIds.add(match[1]);}
  }
  const migrated=migrateLegacy([...oldIds].map(id=>({id,state:'',flagged:false})),legacy);
  for(const [id,value] of Object.entries(migrated))output[`kanji:${id}`]=value;
  return output;
}

/** Question/answer content never includes a Korean example as a reverse hint. */
export function answerFields(card,deckId){
  const fields=deckId==='vocabulary'
    ? [{label:'日本語',text:card.kanji,lang:'ja'},{label:'英語',text:card.english||card.meaning,lang:'en'}]
    : [{label:'漢字・意味',text:card.kanji,lang:'ja'},{label:'漢字候補',text:card.hanja,lang:'ja'},{label:'補足',text:card.meaning,lang:'ja'}];
  const seen=new Set();
  return fields.filter(field=>field.text&&!seen.has(field.text)&&seen.add(field.text));
}
