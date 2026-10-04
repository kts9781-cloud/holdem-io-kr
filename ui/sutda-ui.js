// 섯다 화면 (혼자 하기·친구와 치기 공통, 3장·2장 섯다): 화투 카드 그림(그림체 2가지), 바둑이와 같은 9칸 베팅 버튼, 3장 중 1장을 버리는 고르기(2장 섯다는 없음),
// 가운데 '첫 베팅 · 고르기 · 마지막 베팅' 표시, 재경기 안내. DOM(#sdStages·#sdHelp)과 CSS(body[data-game="sutda"])는 index.html
// 9칸 버튼(#bdActions·#bdBets)과 고르기 칸(#bdDraw)은 바둑이와 같이 쓴다 (krBetButtons·krBind는 ui/badugi-ui.js)
const SD_STAGE = ['첫 베팅', '고르기', '마지막 베팅'];
let sdDiscard = null; // 고르기에서 버리려고 고른 내 카드 자리
const sdTheme = () => G?.cardTheme ?? store.get('holdem.hwatu', 'classic'); // 친구와 치기는 방장이 정한 그림체, 혼자 하기는 설정
const sdLabel = c => `${sdMonth(c)}월 ${sdGwang(c) ? '광' : sdSpecial(c) ? '열끗' : sdMonth(c) === 8 ? '열끗' : '띠'}`;
function sdFace(c, d) { // 화투 앞면: 그림 + 작은 월 숫자 (작게 보여도 몇 월인지 알게)
  d.className = 'card hw'; d.dataset.c = c; d.setAttribute('aria-label', sdLabel(c));
  d.innerHTML = `<img src="assets/hwatu/${sdTheme()}/${sdMonth(c)}-${c & 1}.webp" alt="" draggable="false"><span class="hw-n">${sdMonth(c)}</span>`;
  return d;
}
function sdControls() { // renderControls()가 섯다일 때 부른다
  const on = phase === 'player', pickTurn = on && !!H.picking;
  $('bdBets').hidden = pickTurn; $('bdDraw').hidden = !pickTurn;
  if (!pickTurn) return krBetButtons(on);
  const keep = sdDiscard == null ? null : H.hole[0].filter((_, i) => i !== sdDiscard);
  $('bdHint').textContent = '버릴 카드 1장을 누르세요';
  $('bdDrawBtn').textContent = keep ? `이 2장으로 · ${sdName(keep[0], keep[1])}` : '버릴 카드를 골라 주세요';
  $('bdDrawBtn').disabled = !keep;
}
function sdRender() { // render()가 섯다일 때 부른다
  const mine = H.hole[0] ?? [], picking = phase === 'player' && !!H.picking;
  $('cards0').classList.toggle('picking', picking);
  [...$('cards0').children].forEach((el, i) => el.classList.toggle('discard', picking && sdDiscard === i));
  $('bdMine').textContent = mine.length && mine[0] >= 0 && !dealing && !H.folded[0]
    ? `내 패 · ${mine.length === 2 ? sdName(mine[0], mine[1]) : mine.length === 1 ? sdLabel(mine[0]) + ' · 1장 더 받아요' : '3장 중 2장을 남겨요'}` : '';
  $('sdStages').children[1].hidden = sdTwo(); // 2장 섯다는 고르기가 없다
  const cur = H.picking ? 1 : H.stage === 1 ? 2 : 0;
  [...$('sdStages').children].forEach((el, i) => { el.classList.toggle('done', i < cur); el.classList.toggle('on', i === cur && !H.result); });
}
// 새로 받은 카드에만 딜 연출 (3번째 카드면 마지막 장, 재경기면 전부)
function sdDealAnim(all) {
  render();
  for (const i of live()) [...$('cards' + i).children].forEach((el, k, a) => { if (all || k === a.length - 1) { el.classList.remove('deal'); void el.offsetWidth; el.classList.add('deal'); } });
  sfx('deal', live().length * (all ? 2 : 1));
}
function sdPicked(p, note = '') { say(p, '고름', 'draw'); log(`${who(p)}: 2장 고름${note}`); sfx('tick'); }
// 내 고르기: 친구와 치기는 서버로, 혼자 하기는 바로
async function playerPick() {
  if (mode === 'mp') return mpPick();
  if (phase !== 'player' || !H.picking || PAUSED || sdDiscard == null) return;
  const me = run, i = sdDiscard;
  sdDiscard = null; stopClock(); phase = 'busy';
  RULES().steps.pick.apply(0, i); sdPicked(0); render();
  await sleep(250);
  if (me !== run) return;
  phase = 'deal'; advance();
}
async function mpPick() {
  if (MP.paused) return log('일시정지 중이에요', 'level');
  if (phase !== 'player' || !H.picking || sdDiscard == null) return;
  stopClock(); phase = 'busy'; render();
  try { await mpCall('pick', { id: MP.id, card: sdDiscard }); sdDiscard = null; mpPoll(); }
  catch (e) { log(e.message, 'level'); phase = 'player'; render(); mpClock(); }
}
async function sdRoundStart(kind) { // 'deal' 단계·이벤트: 3번째 카드 / 마지막 베팅 / 재경기
  if (kind === 'second') { log('2번째 카드 · 마지막 베팅', 'street'); for (const i of live()) if (!G.sitOut?.[i]) say(i, ''); sdDealAnim(false); await sleep(500); }
  else if (kind === 'third') { log('3번째 카드 · 3장 중 2장을 골라요', 'street'); for (const i of live()) say(i, ''); sdDealAnim(false); await sleep(500); }
  else if (kind === 'redeal') { log(`구사 · 재경기 (${H.redeals}번째) · 팟은 그대로`, 'level'); flashBanner('재경기', '구사 · 팟은 그대로'); for (const i of live()) say(i, ''); sdDealAnim(true); await sleep(900); }
  else { log('마지막 베팅', 'street'); for (const i of live()) if (!G.sitOut?.[i]) say(i, ''); render(); await sleep(350); }
}

UI_GAMES.sutda = {
  actions: 'bdActions', center: 'sdStages', panels: ['#sdHelp'],
  evGauge: false, duel: '맞대결', tag: '섯다', mpTitle: '섯다', showdownWord: '승부', solo: { sd2: 2, sd6: 6 },
  stakeAmt: x => fmt(x), stakeText: x => `앤티 ${fmt(x)}`, stakeHint: () => '', handStake: () => H.ante,
  soloName: n => `섯다 ${n === 2 ? '1:1' : n + '인'}`, soloSub: () => `${sdTwo() ? 2 : 3}장 섯다 · 팟 리밋`,
  soloIntro: n => `섯다 ${n === 2 ? '1:1' : n + '인'} · 앤티는 ${LEVEL_MIN}분마다 올라요`,
  cardFace: sdFace,
  bind() {
    krBind();
    $('bdDrawBtn').addEventListener('click', () => { if (G?.game === 'sutda') playerPick(); }); // 바둑이도 같은 버튼(교환)을 쓴다
    $('seats').addEventListener('click', e => { // 고르기 차례에 내 카드를 누르면 버릴 카드로, 다시 누르면 취소
      const c = e.target.closest('#cards0 .card');
      if (!c || phase !== 'player' || !H.picking) return;
      const i = [...c.parentElement.children].indexOf(c);
      sdDiscard = sdDiscard === i ? null : i;
      sfx('tick'); render();
    });
  },
  reset: () => { sdDiscard = null; },
  render: sdRender,
  controls: sdControls,
  onHandStart() { sdDiscard = null; log(`모두 앤티 ${fmt(H.ante)}`, 'street'); },
  timeout() { // 혼자 하기 고르기 차례에 시간이 다 되면 가장 좋은 2장으로
    if (!H.picking) return false;
    stopClock(); log('시간 초과 · 가장 좋은 2장으로', 'level'); sdDiscard = sdBestDiscard(H.hole[0]); playerPick(); return true;
  },
  async onStep(s, me) { // 혼자 하기: 'deal'(3번째 카드·마지막 베팅·재경기), 'pick'(AI는 바로, 내 차례면 고르게)
    if (s === 'deal') {
      await collectAnim();
      phase = 'deal';
      await sdRoundStart(H.lastDeal);
      return me !== run ? 'stop' : 'next';
    }
    const p = H.toAct;
    if (p === 0) { sdDiscard = null; phase = 'player'; render(); startClock(); return 'stop'; }
    phase = 'ai'; render();
    await sleep(H.folded[0] || G.out[0] ? 150 : G.n > 2 ? 300 : 500);
    if (me !== run) return 'stop';
    RULES().steps.pick.ai(p); sdPicked(p); render();
    await sleep(250);
    if (me !== run) return 'stop';
    phase = 'deal';
    return 'next';
  },
  onTurn(e) { if (!e.pick) return false; H.picking = true; return true; }, // 친구와 치기 turn 이벤트: 고르기 차례
  restore() { // 다시 들어왔다. 2장 섯다: 첫 베팅 중이면 남들도 1장 / 고르기 중: 아직 안 고른 사람은 3장, 고른 사람은 '고름'
    if (sdTwo() && H.stage === 0) { for (const i of live()) if (i) H.hole[i] = [-1]; render(); }
    if (!H.picking) return;
    for (const i of live()) { if (H.picked?.[i]) say(i, '고름', 'draw'); else if (i) H.hole[i] = Array(3).fill(-1); }
    render();
  },
  async onEvent(e, { s, me, snap }) { // 친구와 치기의 섯다 이벤트 (카드는 오지 않는다. 내 카드는 내 홀카드에서 받아 온다)
    if (e.t === 'pick') {
      stopClock(); H.picked ??= []; H.picked[s] = true;
      if (s === 0) { const nw = await mpMyCards(G.hand); if (nw.length) H.hole[0] = nw; sdDiscard = null; } else H.hole[s] = Array(2).fill(-1);
      if (me !== run) return;
      snap(); sdPicked(s, e.timeout ? ' (시간 초과)' : e.auto ? ' (자리 비움)' : ''); render();
      return sleep(250);
    }
    if (e.t === 'third' || e.t === 'second' || e.t === 'redeal' || e.t === 'round') {
      await collectAnim();
      snap(); H.stage = e.stage; H.redeals = e.redeals ?? H.redeals;
      if (e.t === 'round') { H.picking = false; H.lastDeal = 'round'; }
      else {
        H.picking = e.t === 'third'; H.picked = Array(G.n).fill(null); sdDiscard = null;
        const n = e.t === 'third' ? 3 : e.t === 'redeal' && sdTwo() ? 1 : 2, nw = await mpMyCards(G.hand);
        if (me !== run) return;
        for (const i of live()) H.hole[i] = i === 0 && nw.length === n ? nw : Array(n).fill(-1);
      }
      phase = 'deal';
      return sdRoundStart(e.t);
    }
  },
};
