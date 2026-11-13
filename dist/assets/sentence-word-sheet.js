import { sentenceWordEntries, renderSentenceWordSheet } from './sentence-view.js?v=7';

/** Native modal focus trapping, scoped rating edits and example paging. */
export function createSentenceWordSheet({dialog,getContext,onMode,onRating,stopSpeech}) {
  let selected=null;
  const content=dialog.querySelector('#sentence-word-sheet');

  function current() {
    const context=getContext();
    if(!selected || !context.card || context.card.id!==selected.cardId)return null;
    const entry=sentenceWordEntries(context.card,context.words).find(row=>row.key===selected.key);
    return entry?{...context,entry}:null;
  }
  function refresh({focus,resetScroll=false}={}) {
    if(!dialog.open)return;
    const context=current();
    if(!context){close();return;}
    const scroll=content.querySelector('.word-sheet-body')?.scrollTop||0;
    content.innerHTML=renderSentenceWordSheet(context.entry,context.words,context.sentences,context.card,context.records,context.mode,selected.page);
    const body=content.querySelector('.word-sheet-body');
    body.scrollTop=resetScroll?0:scroll;
    if(focus)content.querySelector(focus)?.focus({preventScroll:true});
  }
  function open(index,{status=false}={}) {
    const context=getContext();
    if(!context.card)return;
    const entry=sentenceWordEntries(context.card,context.words)[index];
    if(!entry || status && !entry.word)return;
    stopSpeech();
    selected={cardId:context.card.id,key:entry.key,index,page:0,status};
    // Build the title before showModal so its accessible name is available immediately.
    content.innerHTML=renderSentenceWordSheet(entry,context.words,context.sentences,context.card,context.records,context.mode);
    document.body.classList.add('word-sheet-open');
    dialog.showModal();
    content.querySelector(status?'[data-word-sheet-rating][aria-pressed=true]':'[data-word-sheet-close]')?.focus({preventScroll:true});
  }
  function close(){if(dialog.open)dialog.close();}
  dialog.addEventListener('click',event=>{
    if(event.target===dialog){close();return;}
    const button=event.target.closest('button');
    if(!button)return;
    // Speech buttons use the application's single shared player.
    if(button.hasAttribute('data-speak'))return;
    event.stopPropagation();
    if(button.hasAttribute('data-word-sheet-close')){close();return;}
    const context=current();
    if(!context){close();return;}
    if(button.dataset.wordSheetMode){
      stopSpeech();onMode(button.dataset.wordSheetMode);
      refresh({focus:`[data-word-sheet-mode="${button.dataset.wordSheetMode}"]`});
    } else if(button.hasAttribute('data-word-sheet-page')) {
      stopSpeech();selected.page=Number(button.dataset.wordSheetPage);
      const label=button.getAttribute('aria-label');
      refresh({resetScroll:true});
      (content.querySelector(`.word-sheet-pages button[aria-label="${label}"]:not(:disabled)`)||content.querySelector('.word-sheet-pages button:not(:disabled)'))?.focus({preventScroll:true});
    } else if(button.dataset.wordSheetRating && context.entry.word) {
      const rating=button.dataset.wordSheetRating;
      if(onRating(context.entry.word.id,context.mode,rating)) {
        refresh({focus:`[data-word-sheet-rating="${rating}"]`});
        content.querySelector('.word-sheet-feedback').textContent='保存しました';
      } else {
        content.querySelector('.word-sheet-feedback').textContent='保存できませんでした。もう一度お試しください。';
      }
    }
  });
  dialog.addEventListener('close',()=>{
    const previous=selected;selected=null;
    document.body.classList.remove('word-sheet-open');stopSpeech();
    const context=getContext();
    if(previous && context.card?.id===previous.cardId) {
      const entries=sentenceWordEntries(context.card,context.words);
      const index=entries.findIndex(entry=>entry.key===previous.key);
      if(index>=0)document.querySelector(`[data-sentence-word-${previous.status?'status':'open'}="${index}"]`)?.focus({preventScroll:true});
    }
  });
  return {open,close,refresh,isOpen:()=>dialog.open};
}
