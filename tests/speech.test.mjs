import test from 'node:test';
import assert from 'node:assert/strict';
import {createKoreanSpeaker, koreanVoice} from '../dist/assets/speech.js';
import {speechButton} from '../dist/assets/speech-view.js';

const KO = {name:'Korean',lang:'ko-KR',localService:true};
const EN = {name:'English',lang:'en-US',localService:true};
function platform({initialVoices = [KO],autoStart = true,...options} = {}) {
  let available = initialVoices;
  const queued = [], states = [], errors = [], listeners = new Set();
  const synthesis = {
    canceled:0, getVoices:()=>available,
    cancel() { this.canceled += 1; },
    speak(utterance) { queued.push(utterance); if (autoStart) utterance.onstart?.(); },
    addEventListener(type,handler) { if (type === 'voiceschanged') listeners.add(handler); },
    removeEventListener(type,handler) { if (type === 'voiceschanged') listeners.delete(handler); },
  };
  const speaker = createKoreanSpeaker({synthesis,Utterance:class {constructor(text) {this.text=text;}},onState:state=>states.push(state),onError:error=>errors.push(error),...options});
  return {speaker,synthesis,queued,states,errors,listeners,setVoices(voices) {available=voices;for (const handler of [...listeners]) handler();}};
}

test('Korean selection prefers a local ko-KR voice and never falls back to another language', () => {
  const input = [EN,{lang:'ja-JP'},{lang:'ko',localService:true},{lang:'ko_KR',localService:false},KO];
  assert.equal(koreanVoice(input),KO);
  assert.deepEqual(input.map(voice=>voice.lang),['en-US','ja-JP','ko','ko_KR','ko-KR']);
  assert.equal(koreanVoice([EN,{lang:'ja-JP'}]),null);
});

test('one character or word is normalized and sent to an explicitly Korean utterance', async () => {
  const p = platform();
  assert.equal(await p.speaker.toggle(' 가 '),true);
  assert.equal(p.queued.length,1);
  assert.equal(p.queued[0].text,'가');
  assert.equal(p.queued[0].lang,'ko-KR');
  assert.equal(p.queued[0].voice,KO);
  assert.equal(p.queued[0].rate,0.9);
  assert.deepEqual(p.states.at(-1),{text:'가',phase:'speaking'});
  p.queued[0].onend();
  assert.deepEqual(p.states.at(-1),{text:'',phase:'idle'});
  assert.deepEqual(p.errors,[]);
});

test('tapping the same word stops it rather than queuing another reading', async () => {
  const p = platform();
  await p.speaker.toggle('한국어');
  assert.equal(await p.speaker.toggle('한국어'),false);
  assert.equal(p.queued.length,1);
  assert.equal(p.queued[0].onerror,null);
  assert.equal(p.states.at(-1).phase,'idle');
});

test('switching words cancels the first, and stale callbacks cannot stop the replacement', async () => {
  const p = platform();
  await p.speaker.toggle('가');
  const lateEnd = p.queued[0].onend, lateError = p.queued[0].onerror;
  await p.speaker.toggle('가격');
  lateEnd(); lateError({error:'interrupted'});
  assert.equal(p.queued.length,2);
  assert.deepEqual(p.states.at(-1),{text:'가격',phase:'speaking'});
  assert.deepEqual(p.errors,[]);
  p.speaker.stop();
});

test('asynchronously loaded Korean voices can be used and temporary listeners are removed', async () => {
  const p = platform({initialVoices:[]});
  const result = p.speaker.toggle('가족');
  assert.equal(p.states.at(-1).phase,'loading');
  p.setVoices([EN,KO]);
  assert.equal(await result,true);
  assert.equal(p.queued[0].voice,KO);
  assert.equal(p.listeners.size,0);
  p.speaker.stop();
});

test('navigation while waiting for voices prevents delayed speech from starting', async () => {
  const p = platform({initialVoices:[]});
  const result = p.speaker.toggle('가족');
  p.speaker.stop(); p.setVoices([KO]);
  assert.equal(await result,false);
  assert.equal(p.queued.length,0);
  assert.equal(p.listeners.size,0);
  assert.deepEqual(p.errors,[]);
});

test('unsupported or Korean-less devices report failure without speaking in English', async () => {
  const p = platform({initialVoices:[EN],voiceWaitMs:0});
  assert.equal(await p.speaker.toggle('가'),false);
  assert.equal(p.queued.length,0);
  assert.deepEqual(p.errors,['no-korean-voice']);
  const errors = [];
  assert.equal(await createKoreanSpeaker({onError:error=>errors.push(error)}).toggle('가'),false);
  assert.deepEqual(errors,['unsupported']);
});

test('engine errors and silently refused starts both clear the active state', async () => {
  const p = platform();
  await p.speaker.toggle('가다'); p.queued[0].onerror({error:'not-allowed'});
  assert.equal(p.states.at(-1).phase,'idle');
  assert.deepEqual(p.errors,['not-allowed']);
  const silent = platform({autoStart:false,startWaitMs:0});
  await silent.speaker.toggle('가다');
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(silent.states.at(-1).phase,'idle');
  assert.deepEqual(silent.errors,['start-timeout']);
});

test('speech controls escape source text in attributes and accessible labels', () => {
  const html = speechButton('가"><img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('data-speak="가&quot;&gt;&lt;img'));
  assert.ok(html.includes('aria-pressed="false"'));
  assert.equal(speechButton(' '),'');
});
