import { icon } from './icons.js?v=3';
import { speechText } from './speech.js';

const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function speechButton(value) {
  const text = speechText(value);
  if (!text) return '';
  return `<button type="button" class="speech-button" data-speak="${esc(text)}" aria-label="${esc(text)}を読み上げ" aria-pressed="false" title="読み上げ"><span class="speech-play">${icon('volume')}</span><span class="speech-stop">${icon('stop')}</span></button>`;
}
