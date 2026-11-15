/** Choose whole families uniformly, keeping their original-to-variation order intact. */
export function randomVariationLesson(lessons, {excludeId='',random=Math.random}={}) {
  const available=Array.isArray(lessons) ? lessons.filter(lesson=>Array.isArray(lesson?.cards) && lesson.cards.length) : [];
  if(!available.length)return null;
  const alternatives=available.filter(lesson=>lesson.id!==excludeId);
  const candidates=alternatives.length ? alternatives : available;
  const sample=Number((typeof random==='function'?random:Math.random)());
  const unit=Number.isFinite(sample)?Math.max(0,Math.min(sample,1-Number.EPSILON)):0;
  return candidates[Math.floor(unit*candidates.length)];
}
