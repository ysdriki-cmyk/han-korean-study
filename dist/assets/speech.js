export const speechText = value => String(value ?? '').normalize('NFC').trim();

/** Never substitute a Japanese or English voice for Korean. */
export function koreanVoice(voices = []) {
  const locale = voice => String(voice.lang || '').replaceAll('_', '-').toLowerCase();
  return [...voices].filter(voice => /^ko(?:-|$)/.test(locale(voice)))
    .sort((a, b) => Number(locale(b) === 'ko-kr') - Number(locale(a) === 'ko-kr') || Number(b.localService === true) - Number(a.localService === true))[0] || null;
}

/** One user-triggered utterance at a time; injected APIs keep lifecycle tests deterministic. */
export function createKoreanSpeaker({ synthesis, Utterance, onState = () => {}, onError = () => {}, startWaitMs = 10000 } = {}) {
  const supported = !!synthesis && typeof synthesis.speak === 'function' && typeof synthesis.cancel === 'function' && typeof synthesis.getVoices === 'function' && typeof Utterance === 'function';
  let token = 0, activeText = '', current = null, voice = null, watchdog = null;
  function refreshVoices() {
    try { voice = koreanVoice(synthesis.getVoices() || []); } catch { voice = null; }
    return voice;
  }
  const state = (text = '', phase = 'idle') => { activeText = text; onState({ text, phase }); };
  function stop() {
    token += 1;
    clearTimeout(watchdog); watchdog = null;
    const wasActive = !!current;
    if (current) current.onstart = current.onend = current.onerror = null;
    current = null;
    if (supported && wasActive) { try { synthesis.cancel(); } catch {} }
    state();
  }
  function fail(code, request, error) {
    if (request !== token) return;
    const details = { lang: current?.lang || 'ko-KR', voice: current?.voice?.name || null, voiceLang: current?.voice?.lang || null, error };
    stop(); onError(code, details);
  }
  function toggle(value) {
    const text = speechText(value);
    if (!text) return false;
    if (activeText === text) { stop(); return false; }
    stop();
    const request = ++token;
    if (!supported) { fail('unsupported', request); return false; }
    state(text, 'loading');
    const selectedVoice = refreshVoices();
    try {
      const utterance = new Utterance(text); current = utterance;
      // Android may expose no voices even when its TTS engine can speak Korean.
      utterance.lang = 'ko-KR';
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = 0.9; utterance.pitch = 1; utterance.volume = 1;
      utterance.onstart = () => {
        if (request !== token) return;
        clearTimeout(watchdog); watchdog = null; state(text, 'speaking');
      };
      utterance.onend = () => {
        if (request !== token) return;
        token += 1; clearTimeout(watchdog); watchdog = null; current = null; state();
      };
      utterance.onerror = event => fail(event?.error || 'synthesis-failed', request, event);
      watchdog = setTimeout(() => fail('start-timeout', request), startWaitMs);
      if (synthesis.paused) synthesis.resume?.();
      // Stay in the speaker-button click stack: never await voiceschanged here.
      synthesis.speak(utterance);
      return true;
    } catch (error) { fail(error?.name || 'synthesis-failed', request, error); return false; }
  }
  // Update selection before future taps; a late voice list must not start speech.
  if (supported) {
    synthesis.addEventListener?.('voiceschanged', refreshVoices);
    refreshVoices();
  }
  return { toggle, stop, supported };
}
