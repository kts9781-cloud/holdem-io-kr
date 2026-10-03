// 게임별 화면 목록과 홀덤 화면: 레이즈 슬라이더·프리셋, 보드 깔기, SB/BB 표시, EV 계기판·전적(공통 스크립트에서 evGauge·ranked로 켠다)
// index.html의 공통 스크립트보다 먼저 불러온다 (ui/*.js 중 맨 앞: 화면 목록 UI_GAMES를 여기서 만든다). 여기서는 정의만 한다
// 공통 코드는 GUI()로 지금 게임의 화면을 찾는다. 규칙(engine 쪽)은 RULES()
const UI_GAMES = {};
const GUI = () => UI_GAMES[G?.game ?? 'holdem'];
const soloGame = m => Object.keys(UI_GAMES).find(id => m in UI_GAMES[id].solo); // 혼자 하기 모드(hu·ft6·bd2 …) → 게임

function holdemControls() { // renderControls()가 홀덤일 때 부른다
  const on = phase === 'player', L = legal(0);
  $('bFold').disabled = !on || L.canCheck;
  $('bCall').disabled = !on;
  for (const el of [$('bRaise'), $('slider'), $('bMinus'), $('bPlus'), ...$('presets').children]) el.disabled = !on || !L.canRaise;
  if (!on) { $('bCall').textContent = H.folded[0] ? '폴드함' : '체크 · 콜'; $('bRaise').textContent = '레이즈'; return; }
  $('bCall').textContent = L.canCheck ? '체크' : `콜 ${fmt(L.toCall)}`;
  raiseLabel();
}
const inBB = v => `${+(v / H.bb).toFixed(1)}BB`;
function raiseLabel() {
  if (phase !== 'player' || !legal(0).canRaise) return;
  const v = +$('slider').value;
  $('bRaise').innerHTML = (v - H.bets[0] === G.stacks[0] ? '올인 ' : maxBet() ? '레이즈 ' : '베팅 ') + fmt(v) + `<small>${inBB(v)}</small>`;
  for (const b of $('presets').children) b.classList.toggle('on', +b.dataset.to === v);
}
// 레이즈 프리셋: 프리플랍 첫 레이즈는 BB 배수, 누가 레이즈했으면 그 금액의 배수(BB로 표시), 플랍부터는 팟 비율
function buildPresets() {
  const L = legal(0), mb = maxBet(), potCall = H.committed.reduce((s, c, i) => s + Math.min(i ? c : c + L.toCall, H.committed[0] + L.toCall), 0);
  const list = !H.board.length && mb <= H.bb ? [2, 2.5, 3, 4].map(x => [null, x * H.bb])
    : !H.board.length ? [2.5, 3, 4].map(x => [null, x * mb])
    : [['1/3팟', 1 / 3], ['1/2팟', 0.5], ['3/4팟', 0.75], ['팟', 1]].map(([n, x]) => [n, mb + x * potCall]);
  const seen = new Set();
  $('presets').textContent = '';
  for (const [name, v] of [...list, ['올인', L.maxTo]]) {
    const r = Math.round(v / CHIP) * CHIP, to = Math.max(L.minTo, Math.min(L.maxTo, r));
    // 최소 레이즈보다 작거나 올인에 닿는 프리셋은 이름과 실제 금액이 달라지므로 뺀다
    if (seen.has(to) || (name !== '올인' && (r < L.minTo || to === L.maxTo))) continue;
    seen.add(to);
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.to = to; b.textContent = name || inBB(to);
    b.onclick = () => { $('slider').value = to; raiseLabel(); if (name === '올인') $('bRaise').click(); }; // 올인은 누르면 바로
    $('presets').append(b);
  }
}

const sbBb = x => `${fmt(x)}/${fmt(2 * x)}`; // 100/200
UI_GAMES.holdem = {
  actions: 'actions', center: 'board', panels: ['#gauge', '.record'], // 내 차례 버튼 칸 · 접은 패가 날아갈 곳 · 오른쪽 EV 계기판과 전적·스타일 기억
  evGauge: true, duel: '헤즈업', tag: '', mpTitle: '친구와 치기', showdownWord: '쇼다운', solo: { hu: 2, ft6: 6, ft9: 9 },
  stakeAmt: sbBb, stakeText: sbBb, stakeHint: sbBb, handStake: () => H.sb, // 스몰/빅(빅은 늘 2배)
  soloName: n => n === 2 ? '헤즈업 홀덤' : `파이널 테이블 ${n}인`, soloSub: n => n === 2 ? '노리밋 · vs EV 컴퓨터' : '노리밋 토너먼트 · 우승을 노려라',
  soloIntro: n => n === 2 ? '' : `파이널 테이블 ${n}인 · 블라인드는 ${LEVEL_MIN}분마다 올라요`,
  bind() {}, // 슬라이더·버튼은 index.html이 연결한다
  controls: holdemControls,
  onHandStart() { say(H.sbSeat, 'SB ' + fmt(H.bets[H.sbSeat])); say(H.bbSeat, 'BB ' + fmt(H.bets[H.bbSeat])); },
  onMyTurn() { // 레이즈 슬라이더와 프리셋
    const L = legal(0), sl = $('slider');
    sl.max = L.maxTo; sl.min = L.minTo; sl.value = L.minTo;
    buildPresets();
  },
  async onStep() { // 'deal': 보드를 깐다
    await collectAnim();
    phase = 'deal';
    if (!H.shown && allInRunout()) await revealRunout(); // 올인: 남은 카드를 깔기 전에 패부터 모두 공개
    const k = H.board.length;
    log(`${STREET[k]}  ${H.board.slice(k === 3 ? 0 : -1).map(cardText).join(' ')}`, 'street');
    for (const i of live()) if (G.stacks[i]) say(i, '');
    render();
    await sleep(live().filter(i => G.stacks[i]).length > 1 ? 650 : 1100); // 올인 런아웃은 한 장씩 천천히
    return 'next';
  },
};
