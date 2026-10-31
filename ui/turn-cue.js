// 차례 알림은 실제 행동 기회가 바뀔 때만 울린다. 시계·타임칩 갱신은 같은 차례다.
const TurnCue = (() => {
  const observed = new Set();
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => entries.forEach(({target,isIntersecting}) => target.classList.toggle('turn-offscreen', !isIntersecting))) : null;
  function watch(el) {
    if (!observer) return;
    for (const old of observed) if (!old.isConnected) { observer.unobserve(old); observed.delete(old); }
    if (!observed.has(el)) { observed.add(el); observer.observe(el); }
  }
  function create(id) {
    const el = document.createElement('div');
    el.id = id; el.className = 'turn-cue'; el.hidden = true;
    el.innerHTML = '<div class="turn-copy"><strong role="status" aria-live="polite"></strong><small></small></div><div class="turn-count" aria-live="off" hidden><b></b><span>초 남음</span></div>';
    return el;
  }
  function update(el, { key = null, mine = false, label = '', detail = '', paused = false, visible = true, notify = true }) {
    watch(el);
    const fresh = mine && key !== el._turnKey;
    el._turnKey = mine ? key : null;
    el.hidden = !visible;
    el.classList.toggle('is-mine', mine && !paused);
    el.classList.toggle('is-paused', paused);
    const text = paused ? '일시정지 중이에요' : label;
    const title = el.querySelector('strong');
    if (title.textContent !== text) title.textContent = text;
    el.querySelector('small').textContent = paused ? '다시 시작하면 시간이 이어져요' : detail;
    if (fresh && notify && !paused && visible && !document.hidden) sfx('turn');
  }
  function time(el, seconds, paused = false) {
    const count = el.querySelector('.turn-count');
    count.hidden = seconds == null || paused;
    if (seconds != null) count.querySelector('b').textContent = seconds;
    el.classList.toggle('is-hurry', seconds != null && seconds <= 5 && !paused);
  }
  const visibility = () => document.body.classList.toggle('turn-hidden', document.hidden);
  document.addEventListener('visibilitychange', visibility);
  visibility();
  return { create, update, time, watch };
})();
