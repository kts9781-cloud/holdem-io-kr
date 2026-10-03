// 바둑이 화면 (혼자 하기·친구와 치기 공통): 9칸 베팅 버튼, 카드를 눌러 고르는 교환, 내 족보와 아침·점심·저녁 진행 표시
// index.html의 공통 스크립트보다 먼저 불러온다. 여기서는 정의만 하고, 버튼 연결은 bind()에서 (공통 스크립트가 시작할 때 부른다)
// DOM(#bdRounds·#bdActions·#bdHelp …)과 CSS(.table[data-game="badugi"])는 index.html에 있다
const BD_ROUND = ['아침', '점심', '저녁'], bdSel = new Set(); // bdSel: 바꾸려고 고른 내 카드 자리
function bdDrawHead(draws) { // 교환 단계가 시작될 때 한 번
  H.draws = draws;
  if (H.drawing && H.drawHead === draws) return;
  H.drawing = true; H.drawHead = draws; log(`${BD_ROUND[draws]} · 카드 바꾸기`, 'street');
  for (const i of live()) if (!G.sitOut?.[i]) say(i, ''); // 베팅 말풍선을 지운다 (이제 '2장'·'스테이'가 뜬다). 혼자 하기에는 sitOut이 없다
}
function bdControls() { // renderControls()가 바둑이일 때 부른다
  const on = phase === 'player', drawTurn = on && !!H.drawing, Lg = legal(0), bets = on && !H.drawing ? badugiBets(0) : {};
  $('bdBets').hidden = drawTurn; $('bdDraw').hidden = !drawTurn;
  if (drawTurn) { $('bdHint').textContent = `${BD_ROUND[H.draws]} · 바꿀 카드를 눌러 고르세요`; $('bdDrawBtn').textContent = bdSel.size ? `${bdSel.size}장 바꾸기` : '스테이 (안 바꾸기)'; return; }
  for (const b of $('bdBets').children) {
    const k = b.dataset.k, ok = on && (k === '체크' ? Lg.canCheck : k === '다이' || k === '콜' ? !Lg.canCheck : k in bets);
    b.disabled = !ok; b.dataset.to = bets[k] ?? '';
    b.lastElementChild.textContent = !ok ? '' : k === '콜' ? fmt(Lg.toCall) : k in bets ? fmt(bets[k]) : '';
  }
}
function bdRender() { // render()가 바둑이일 때 부른다
  const mine = H.hole[0] ?? [], pick = phase === 'player' && !!H.drawing;
  $('cards0').classList.toggle('picking', pick);
  [...$('cards0').children].forEach((el, i) => el.classList.toggle('sel', pick && bdSel.has(i)));
  $('bdMine').textContent = mine.length === 4 && mine[0] >= 0 && !dealing && !H.folded[0] ? `내 패 · ${badugiName(badugi(mine))}` : ''; // 지금 내 족보
  [...$('bdRounds').children].forEach((el, i) => { el.classList.toggle('done', i < H.draws); el.classList.toggle('on', !!H.drawing && i === H.draws); });
}
// 교환 연출: 말풍선·기록·소리, 바뀐 자리(idxs)의 카드만 새로 받는 딜 연출
async function showDraw(p, n, idxs, note = '') {
  say(p, n ? `${n}장` : '스테이', n ? 'draw' : 'draw stay'); log(`${who(p)}: ${n ? n + '장 바꿈' : '스테이'}${note}`); sfx(n ? 'deal' : 'stay', n); // 스테이는 체크(똑똑)와 다른 소리
  render();
  for (const i of idxs) { const el = $('cards' + p).children[i]; if (el) { el.classList.remove('deal'); void el.offsetWidth; el.classList.add('deal'); } }
  await sleep(n ? 600 : 300);
}
// 내 교환: 친구와 치기는 서버로, 혼자 하기는 바로 바꾸고 이어서 진행
async function playerDraw() {
  if (mode === 'mp') return mpDraw();
  if (phase !== 'player' || !H.drawing || PAUSED) return;
  const me = run, sel = [...bdSel].sort((a, b) => a - b);
  bdSel.clear(); stopClock(); phase = 'busy';
  draw(0, sel);
  await showDraw(0, sel.length, sel);
  if (me !== run) return;
  phase = 'deal'; advance();
}

UI_GAMES.badugi = {
  actions: 'bdActions', center: 'bdRounds', panels: ['#bdHelp'], // 내 차례 버튼 칸 · 접은 패가 날아갈 곳 · 오른쪽 설명(족보)
  evGauge: false, duel: '맞대결', tag: '바둑이', mpTitle: '바둑이', showdownWord: '승부', solo: { bd2: 2, bd6: 6 },
  stakeAmt: x => fmt(x), stakeText: x => `앤티 ${fmt(x)}`, stakeHint: () => '', handStake: () => H.ante, // 바둑이는 블라인드 대신 앤티
  soloName: n => `바둑이 ${n === 2 ? '1:1' : n + '인'}`, soloSub: () => '팟 리밋 · 아침·점심·저녁 교환',
  soloIntro: n => `바둑이 ${n === 2 ? '1:1' : n + '인'} · 앤티는 ${LEVEL_MIN}분마다 올라요`,
  bind() {
    for (const b of $('bdBets').children) b.onclick = () => { const k = b.dataset.k; playerAct(k === '다이' ? 'fold' : k === '체크' ? 'check' : k === '콜' ? 'call' : 'raise', +b.dataset.to); };
    $('bdDrawBtn').onclick = playerDraw;
    $('seats').addEventListener('click', e => { // 교환 차례에 내 카드를 누르면 고르고, 다시 누르면 취소
      const c = e.target.closest('#cards0 .card');
      if (!c || phase !== 'player' || !H.drawing) return;
      const i = [...c.parentElement.children].indexOf(c);
      bdSel.has(i) ? bdSel.delete(i) : bdSel.add(i);
      sfx('tick'); render();
    });
  },
  reset: () => bdSel.clear(),
  render: bdRender,
  controls: bdControls,
  onHandStart() { bdSel.clear(); log(`모두 앤티 ${fmt(H.ante)}`, 'street'); }, // 바둑이는 블라인드가 없다
  timeout() { // 혼자 하기 교환 차례에 시간이 다 되면 스테이
    if (!H.drawing) return false;
    stopClock(); log('시간 초과 · 자동 스테이', 'level'); bdSel.clear(); playerDraw(); return true;
  },
  // 혼자 하기 진행 중 게임 고유 단계: 'deal'(교환이 끝나 새 베팅 라운드), 'draw'(AI는 규칙대로 바로, 내 차례면 카드를 고르게) → 'stop'이면 멈춤
  async onStep(s, me) {
    if (s === 'deal') {
      await collectAnim();
      phase = 'deal'; log(`${BD_ROUND[H.draws - 1]} 끝 · ${H.draws + 1}번째 베팅`, 'street');
      for (const i of live()) say(i, '');
      render(); await sleep(350);
      return me !== run ? 'stop' : 'next';
    }
    bdDrawHead(H.draws);
    const p = H.toAct;
    if (p === 0) { phase = 'player'; render(); startClock(); return 'stop'; }
    phase = 'ai'; H.toAct = p; render();
    await sleep(H.folded[0] || G.out[0] ? 150 : G.n > 2 ? 300 : 500);
    if (me !== run) return 'stop';
    const idxs = drawPlan(H.hole[p], 3 - H.draws);
    draw(p, idxs);
    await showDraw(p, idxs.length, idxs);
    if (me !== run) return 'stop';
    phase = 'deal';
    return 'next';
  },
  onTurn(e) { if (!e.draw) return false; bdDrawHead(e.draws); return true; }, // 친구와 치기 turn 이벤트: 교환 차례
  restore() { if (H.drawing) H.drew.forEach((n, i) => { if (n != null) say(i, n ? `${n}장` : '스테이', n ? 'draw' : 'draw stay'); }); }, // 교환 중에 다시 들어왔다
  async onEvent(e, { s, me, snap }) { // 친구와 치기의 바둑이 이벤트
    if (e.t === 'draw') { // 교환: 몇 장 바꿨는지만 온다. 내 새 카드는 내 홀카드에서 받아 온다
      stopClock(); bdDrawHead(e.draws);
      H.drew[s] = e.n;
      const picked = (s === 0 ? [...bdSel] : [0, 1, 2, 3].slice(4 - e.n)).slice(0, e.n); bdSel.clear();
      if (s === 0 && e.n) { const nw = await mpMyCards(G.hand); if (nw.length === 4) H.hole[0] = nw; } // 못 받아 오면 그대로 둔다 (다음 핸드에 다시 받는다)
      if (me !== run) return;
      snap(); phase = 'deal';
      return showDraw(s, e.n, picked, e.timeout ? ' (시간 초과)' : e.auto ? ' (자리 비움)' : '');
    }
    if (e.t === 'round') { // 교환이 끝나고 다음 베팅 라운드
      await collectAnim();
      snap(); H.draws = e.draws; H.drawing = false; H.drew = [];
      log(`${BD_ROUND[e.draws - 1]} 끝 · ${e.draws + 1}번째 베팅`, 'street');
      for (const i of live()) if (!G.sitOut[i]) say(i, '');
      phase = 'deal'; render();
      await sleep(350);
    }
  },
};
