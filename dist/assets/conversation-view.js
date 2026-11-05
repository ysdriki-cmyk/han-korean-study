import { speechButton } from './speech-view.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Show only the preceding turn; upcoming lines must not reveal the next answer. */
export function renderConversationPrompt(lesson, position) {
  const card = lesson?.cards?.[position];
  if (!card) return '';
  const previous = lesson.cards[position - 1];
  const context = previous ? `<aside class="conversation-context" aria-label="直前の発話"><span class="conversation-context-speaker">話者 ${esc(previous.conversation?.speaker || '—')}</span><div><p lang="ko">${esc(previous.han)}${speechButton(previous.han)}</p><p lang="ja">${esc(previous.kanji)}</p></div></aside>` : '';
  return `<div class="conversation-heading"><span>${esc(lesson.label)}</span><strong>話者 ${esc(card.conversation?.speaker || '—')}</strong></div>${context}`;
}

export function renderConversationNotes(card) {
  const meta = card?.conversation;
  if (!meta) return '';
  const labels = [meta.role, meta.speechStyle].filter(Boolean);
  if (!labels.length && !meta.usageNote) return '';
  return `<div class="conversation-notes">${labels.length ? `<div>${labels.map(label => `<span>${esc(label)}</span>`).join('')}</div>` : ''}${meta.usageNote ? `<p>${esc(meta.usageNote)}</p>` : ''}</div>`;
}
