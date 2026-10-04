// 섯다 규칙과 AI: 화투 20장(1~10월 두 장씩), 3장 섯다 — 2장 받고 첫 베팅 → 1장 더 받아 3장 중 1장을 버리고(고르기) → 마지막 베팅 → 승부
// 2장 섯다(G.sdCards === 2, 방장·혼자 하기에서 고른다) — 1장 받고 첫 베팅 → 1장 더 받고 마지막 베팅 → 승부 (고르기 없음)
// 한국식 팟 리밋(삥·따당·쿼터·하프·풀)과 앤티는 바둑이와 같다 (engine.js의 krBets·krDecide). engine.js 다음에 불러온다
// 카드 c: 월 = (c >> 1) + 1, c & 1 = 0이면 특수 카드(1·3·8월은 광, 나머지는 열끗), 1이면 일반 카드(띠, 8월은 기러기)
const sdMonth = c => (c >> 1) + 1, sdSpecial = c => (c & 1) === 0;
const sdGwang = c => sdSpecial(c) && [1, 3, 8].includes(sdMonth(c));
const sdTwo = () => G?.sdCards === 2;
const sdCardText = c => `${sdMonth(c)}${sdGwang(c) ? '광' : sdSpecial(c) ? '열끗' : ''}`;
// 기본 족보 점수 (클수록 강함): 38광땡 1000 > 18광땡 990 > 13광땡 980 > 장땡 910 … 1땡 901 > 알리 806 … 세륙 801 > 갑오 9 … 망통 0
const SD_MIDDLE = { 102: 806, 104: 805, 109: 804, 110: 803, 410: 802, 406: 801 }; // 알리·독사·구삥·장삥·장사·세륙 (작은 월 × 100 + 큰 월)
function sdBase(a, b) {
  const lo = Math.min(sdMonth(a), sdMonth(b)), hi = Math.max(sdMonth(a), sdMonth(b));
  if (sdGwang(a) && sdGwang(b)) return lo === 3 ? 1000 : hi === 8 ? 990 : 980; // 3·8 / 1·8 / 1·3
  if (lo === hi) return 900 + lo;
  return SD_MIDDLE[lo * 100 + hi] ?? (lo + hi) % 10;
}
// 특수패: 땡잡이(3·7), 암행어사(4열끗·7열끗), 구사(4·9), 멍텅구리구사(4열끗·9열끗)
function sdKind(a, b) {
  const lo = Math.min(sdMonth(a), sdMonth(b)), hi = Math.max(sdMonth(a), sdMonth(b)), both = sdSpecial(a) && sdSpecial(b);
  if (lo === 3 && hi === 7) return 'catch';
  if (lo === 4 && hi === 7 && both) return 'inspector';
  if (lo === 4 && hi === 9) return both ? 'dumb49' : 'g49';
  return null;
}
const SD_NAMES = { 1000: '38광땡', 990: '18광땡', 980: '13광땡', 910: '장땡', 806: '알리', 805: '독사', 804: '구삥', 803: '장삥', 802: '장사', 801: '세륙', 9: '갑오', 0: '망통' };
const SD_KIND_NAMES = { catch: '땡잡이', inspector: '암행어사', g49: '구사', dumb49: '멍텅구리구사' };
function sdName(a, b) {
  const k = sdKind(a, b), s = sdBase(a, b);
  return k ? SD_KIND_NAMES[k] : SD_NAMES[s] ?? (s > 900 ? `${s - 900}땡` : `${s}끗`);
}
// 승부 판정: 남은 사람들의 2장(hs)을 함께 보고 특수패를 정한다 → { scores, redeal }
// 땡잡이: 남 중 가장 높은 패가 1~9땡이면 그 땡을 이긴다 / 암행어사: 13·18광땡을 이긴다 / 구사: 남이 알리 이하면 재경기 / 멍텅구리구사: 남이 9땡 이하면 재경기
function sdJudge(hs) {
  const base = hs.map(([a, b]) => sdBase(a, b)), kind = hs.map(([a, b]) => sdKind(a, b));
  const top = i => Math.max(-1, ...base.filter((_, j) => j !== i)); // 나를 뺀 가장 높은 기본 점수
  const redeal = kind.some((k, i) => (k === 'dumb49' && top(i) < 910) || (k === 'g49' && top(i) <= 806));
  const scores = base.map((s, i) => kind[i] === 'catch' && top(i) >= 901 && top(i) <= 909 ? 909.5 : kind[i] === 'inspector' && (top(i) === 980 || top(i) === 990) ? 995 : s);
  return { scores, redeal };
}
// 3장 중 가장 높은 기본 족보가 되게 버릴 카드 자리
function sdBestDiscard(cs) {
  let best = 0, bs = -1;
  cs.forEach((_, i) => { const r = cs.filter((__, j) => j !== i), s = sdBase(r[0], r[1]); if (s > bs) { bs = s; best = i; } });
  return best;
}
const sdBestPair = cs => cs.length < 3 ? cs : cs.filter((_, j) => j !== sdBestDiscard(cs));
// 한 장씩 버튼 왼쪽부터 (접은 사람 빼고)
function sdDealRound() { for (let k = 1; k <= G.n; k++) { const i = (G.button + k) % G.n; if (!H.folded[i]) H.hole[i].push(H.deck.pop()); } }
// 고르기: 첫 베팅이 끝나면 3번째 카드를 나누고('deal'), 버튼 왼쪽부터 한 명씩 'pick', 모두 골랐으면 마지막 베팅('deal')
function sdPickStep() {
  if (!H.picking) { H.picking = true; H.picked = Array(G.n).fill(null); sdDealRound(); H.lastDeal = 'third'; return 'deal'; }
  const p = nextOf(G.button, i => !H.folded[i] && H.picked[i] == null);
  if (p >= 0) { H.toAct = p; return 'pick'; }
  H.picking = false; H.stage = 1; nextStreet(); H.lastDeal = 'round';
  return 'deal';
}
// 2장 섯다: 첫 베팅이 끝나면 2번째 카드를 나누고 바로 마지막 베팅
function sdSecond() { sdDealRound(); H.stage = 1; nextStreet(); H.lastDeal = 'second'; return 'deal'; }
function sdPick(p, idx) {
  const [out] = H.hole[p].splice(idx, 1);
  H.muck.push(out); H.gone[p] = out; H.picked[p] = true; // gone: 내가 버린 카드 (AI가 자기 것만 안다)
  return '고름';
}
// 재경기: 팟은 그대로, 남은 사람에게 새 덱에서 2장씩(2장 섯다는 1장씩), 첫 베팅부터 (앤티는 다시 안 낸다)
function sdRedeal() {
  H.redeals++; H.deck = mix([...Array(20).keys()]); H.muck = []; H.gone = Array(G.n).fill(null);
  H.hole = H.hole.map(() => []); // 접은 사람 카드도 비운다 (새 덱이라 같은 카드가 또 나올 수 있다)
  sdDealRound(); if (!sdTwo()) sdDealRound();
  H.stage = 0; H.picked = null; nextStreet(); H.lastDeal = 'redeal';
}
// ===== 섯다 AI: 승률(몬테카를로) → 한국식 베팅(krDecide). 고르기는 가장 높은 족보로 =====
// 상대 패의 강도 분포: 무작위 3장 중 가장 좋은 2장(2장 섯다는 무작위 2장)의 기본 점수 (4,000판으로 한 번씩)
const SD_DIST = {};
function sdPct(sc) {
  const k = sdTwo() ? 2 : 3;
  const D = SD_DIST[k] ??= Array.from({ length: 4000 }, () => { const h = new Set(); while (h.size < k) h.add(Math.floor(Math.random() * 20)); const [a, b] = sdBestPair([...h]); return sdBase(a, b); }).sort((a, b) => a - b);
  let lo = 0, hi = D.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (D[m] < sc) lo = m + 1; else hi = m; }
  return lo / D.length;
}
// 승률: 모르는 카드(내 카드·내가 버린 카드 빼고)에서 상대마다 3장을 뽑아 가장 좋은 2장을 고르게 하고(2장 섯다는 2장), 첫 베팅이면 내 다음 카드도 뽑는다
// 이번 핸드에 올린 상대는 바둑이처럼 레이즈 빈도만큼 위쪽 패로 좁힌다. 재경기는 나눠 가진 것으로 친다
function sdEquity(p, iters) {
  const mine = H.hole[p], opps = live().filter(i => i !== p), pool = [], k = sdTwo() ? 2 : 3;
  for (let c = 0; c < 20; c++) if (!mine.includes(c) && H.gone?.[p] !== c) pool.push(c);
  const cut = Object.fromEntries(opps.map(q => [q, H.aggro[q] ? rangeCut(H.aggro[q], (G.stats[q].raises + 3) / (G.stats[q].chances + 4)) : 0]));
  let won = 0;
  for (let it = 0; it < iters; it++) {
    let n = pool.length;
    const take = () => { const j = Math.floor(Math.random() * n), c = pool[j]; pool[j] = pool[n - 1]; pool[n - 1] = c; n--; return c; };
    const me = H.stage === 0 && mine.length < 3 ? sdBestPair([...mine, take()]) : sdBestPair(mine), hands = [me];
    for (const q of opps) {
      let h;
      for (let t = 0; t < 40; t++) { h = sdBestPair(Array.from({ length: k }, take)); if (!cut[q] || sdPct(sdBase(h[0], h[1])) >= cut[q]) break; if (t < 39) n += k; }
      hands.push(h);
    }
    const J = sdJudge(hands), top = Math.max(...J.scores);
    if (J.redeal) won += 1 / hands.length;
    else if (J.scores[0] === top) won += 1 / J.scores.filter(x => x === top).length;
  }
  return won / iters;
}
function decideSutda(p) {
  const iters = Math.max(100, Math.round(ITERS / 4)), eq = sdEquity(p, iters);
  return krDecide(p, eq, 1, 'sutda', iters);
}

GAMES.sutda = {
  id: 'sutda', name: '섯다', seats: [2, 6], fixedSeats: true, ranked: false, holeCards: 2, deckSize: 20, minV: 3, // 승점·전적에 안 넣는다 / 화면 버전 3부터 섯다를 그린다
  stakeName: '앤티', minChipsX: 10, foldLabel: '다이', stakeInput: '앤티', chipsBase: '앤티',
  themes: ['classic', 'gold'], // 화투 그림체 (방장이 고른다): 전통 · 검정 금박
  dealCards: () => sdTwo() ? 1 : 2, // 처음 나누는 장수 (2장 섯다는 1장부터)
  cardText: sdCardText,
  post(sb) { // 바둑이처럼 모두 앤티 (팟에만, 첫 라운드부터 체크 가능)
    const ante = sb;
    Object.assign(H, { ante, sb: 0, bb: ante, lastRaise: ante, stage: 0, picking: false, picked: null, redeals: 0, muck: [], gone: Array(G.n).fill(null), lastDeal: null });
    for (const i of alive()) { const x = Math.min(ante, G.stacks[i]); G.stacks[i] -= x; H.committed[i] += x; }
    H.toAct = nextOf(G.button, needsAction);
  },
  capRaise: potLimitCap, betNames: krBets,
  busy: () => H.picking, // 고르기 중에는 베팅 라운드를 보지 않는다
  afterRound() { // 첫 베팅 뒤 → 고르기, 마지막 베팅 뒤 → 재경기(구사, 한 핸드 2번까지) 아니면 승부
    if (H.stage === 0) return sdTwo() ? sdSecond() : sdPickStep();
    if (H.redeals < 2 && sdJudge(live().map(i => H.hole[i])).redeal) { sdRedeal(); return 'deal'; }
    return null;
  },
  score: i => sdBase(H.hole[i][0], H.hole[i][1]),
  scores: lv => { const { scores } = sdJudge(lv.map(i => H.hole[i])); return Object.fromEntries(lv.map((i, k) => [i, scores[k]])); },
  best: i => ({ score: sdBase(H.hole[i][0], H.hole[i][1]), cards: H.hole[i].slice() }),
  handName: b => sdName(b.cards[0], b.cards[1]),
  decide: p => decideSutda(p),
  steps: {
    pick: { // 고르기: 3장 중 1장을 버린다 (이벤트에는 고른 것만, 카드는 안 보낸다)
      ai: p => { const i = sdBestDiscard(H.hole[p]); return { idxs: [i], label: sdPick(p, i) }; },
      auto: p => { const i = sdBestDiscard(H.hole[p]); return { idxs: [i], label: sdPick(p, i) }; }, // 시간 초과·자리 비움: 가장 좋은 2장으로
      apply: (p, i) => sdPick(p, i),
      event: (p, label) => ({ t: 'pick', seat: p, label }),
      turn: () => ({ pick: true }),
      busyText: '지금은 카드를 고를 차례예요',
    },
  },
  pendingStep: () => H?.picking ? 'pick' : null,
  roundEvent: () => ({ t: H.lastDeal, stage: H.stage, redeals: H.redeals, ...(H.lastDeal !== 'round' ? { holes: true } : {}) }), // third·second·redeal: 서버가 새 홀카드를 저장한다
  tests: () => {
    const C = s => s.split(' ').map(x => { const m = parseInt(x), k = /[광열]/.test(x) ? 0 : 1; return (m - 1) * 2 + k; }); // '3광 8광', '4열 7열', '5 5'
    const B = s => sdBase(...C(s)), N = s => sdName(...C(s)), J = (...hs) => sdJudge(hs.map(C));
    return [
      ['섯다 족보: 38광땡 > 18광땡 > 13광땡 > 장땡 > 9땡 > 1땡 > 알리 > 독사 > 구삥 > 장삥 > 장사 > 세륙 > 갑오 > 망통', () => {
        const order = ['3광 8광', '1광 8광', '1광 3광', '10열 10', '9열 9', '1광 1', '1광 2', '1 4', '1 9', '1 10', '4 10', '4 6', '2 7', '5 6', '2 8'];
        return order.every((h, i) => i === 0 || B(order[i - 1]) > B(h)) && N('3광 8광') === '38광땡' && N('10열 10') === '장땡' && N('5열 5') === '5땡'
          && N('1 2') === '알리' && N('2 7') === '갑오' && N('5 6') === '1끗' && N('2 8') === '망통' && N('1광 3') === '4끗' && B('1광 8') === 9; }],
      ['섯다 특수패: 땡잡이·암행어사·구사·멍텅구리구사', () => {
        const a = J('3 7', '9열 9').scores, b = J('3 7', '10열 10').scores, c = J('4열 7열', '1광 8광').scores, d = J('4열 7열', '3광 8광').scores;
        return a[0] > a[1] && b[0] < b[1] && b[0] === 0 && c[0] > c[1] && d[0] < d[1] && d[0] === 1 && N('3 7') === '땡잡이' && N('4열 7열') === '암행어사'
          && J('4 9열', '1 2').redeal && !J('4 9열', '1광 1').redeal && J('4 9열', '1광 1').scores[0] === 3 && N('4 9') === '구사'
          && J('4열 9열', '9열 9').redeal && !J('4열 9열', '10열 10').redeal && N('4열 9열') === '멍텅구리구사'
          && !J('4 7', '1광 8광').scores.includes(995); }], // 열끗이 아닌 4·7은 그냥 1끗
      ['섯다 진행: 첫 베팅 → 3번째 카드·고르기 → 마지막 베팅 → 승부, 카드 20장 보존', () => {
        const saved = [G, H];
        newGame({ names: ['a', 'b'], styles: [null, null], stacks: [20000, 20000], game: 'sutda' }); newHand();
        const seen = [], counts = []; let ok = H.hole.every(h => h.length === 2) && sum(H.committed) === 200;
        for (let k = 0; k < 40; k++) {
          const s = step(); seen.push(s); counts.push(H.hole.map(h => h.length).join(''));
          if (s === 'end') break;
          if (s === 'act') act(H.toAct, 'check');
          if (s === 'pick') { const p = H.toAct, was = H.hole[p].slice(); GAMES.sutda.steps.pick.apply(p, 1); ok = ok && H.hole[p].join() === [was[0], was[2]].join(); }
          const all = [...H.hole.flat(), ...H.deck, ...H.muck]; ok = ok && all.length === 20 && new Set(all).size === 20;
        }
        const exp = H.redeals ? null : 'act,act,deal,pick,pick,deal,act,act,end'; // 드물게 구사로 재경기가 나오면 순서만 다르다
        const r = ok && (!exp || seen.join() === exp) && counts.includes('33') && sum(G.stacks) === 40000;
        [G, H] = saved; return r; }],
      ['섯다 재경기: 구사 vs 알리 이하 → 남은 사람에게 새 2장, 팟 그대로, 두 번까지', () => {
        const saved = [G, H];
        newGame({ names: ['a', 'b'], styles: [null, null], stacks: [20000, 20000], game: 'sutda' }); newHand();
        for (let k = 0; k < 40 && H.stage === 0; k++) { const s = step(); if (s === 'act') act(H.toAct, 'check'); if (s === 'pick') GAMES.sutda.steps.pick.apply(H.toAct, 0); }
        const rig = () => { H.hole[0] = C('4 9열'); H.hole[1] = C('1 2'); };
        rig(); let s = step(); // 마지막 베팅 라운드 'act'
        while (s === 'act') { act(H.toAct, 'check'); rig(); s = step(); }
        const a = s === 'deal' && H.lastDeal === 'redeal' && H.redeals === 1 && H.stage === 0 && H.hole.every(h => h.length === 2) && sum(H.committed) === 200 && GAMES.sutda.roundEvent().holes;
        for (let k = 0; k < 40 && H.stage === 0; k++) { const t = step(); if (t === 'act') act(H.toAct, 'check'); if (t === 'pick') GAMES.sutda.steps.pick.apply(H.toAct, 0); }
        rig(); s = step(); while (s === 'act') { act(H.toAct, 'check'); rig(); s = step(); }
        const b = s === 'deal' && H.redeals === 2;
        for (let k = 0; k < 40 && H.stage === 0; k++) { const t = step(); if (t === 'act') act(H.toAct, 'check'); if (t === 'pick') GAMES.sutda.steps.pick.apply(H.toAct, 0); }
        rig(); s = step(); while (s === 'act') { act(H.toAct, 'check'); rig(); s = step(); }
        const c = s === 'end' && H.redeals === 2 && G.stacks[1] === 20100; // 세 번째는 구사 = 3끗 → 알리가 이긴다
        [G, H] = saved; return a && b && c; }],
      ['2장 섯다 진행: 1장 → 첫 베팅 → 2번째 카드 → 마지막 베팅 → 승부 (고르기 없음), 재경기는 1장부터', () => {
        const saved = [G, H];
        newGame({ names: ['a', 'b'], styles: [null, null], stacks: [20000, 20000], game: 'sutda' }); G.sdCards = 2; newHand();
        const seen = []; let ok = H.hole.every(h => h.length === 1) && sum(H.committed) === 200 && H.deck.length === 18;
        for (let k = 0; k < 40; k++) {
          const s = step(); seen.push(s);
          if (s === 'end' || H.redeals) break;
          if (s === 'act') act(H.toAct, 'check');
          if (s === 'deal') ok = ok && H.lastDeal === 'second' && H.stage === 1 && H.hole.every(h => h.length === 2) && GAMES.sutda.roundEvent().holes;
          const all = [...H.hole.flat(), ...H.deck, ...H.muck]; ok = ok && all.length === 20 && new Set(all).size === 20;
        }
        const a = ok && (H.redeals || (seen.join() === 'act,act,deal,act,act,end' && sum(G.stacks) === 40000));
        newHand(); let s = step(); while (s === 'act') { act(H.toAct, 'check'); s = step(); } // 마지막 베팅까지 와서 구사 vs 알리로 바꿔 놓는다
        const rig = () => { H.hole[0] = C('4 9열'); H.hole[1] = C('1 2'); };
        rig(); s = step(); while (s === 'act') { act(H.toAct, 'check'); rig(); s = step(); }
        const b = s === 'deal' && H.lastDeal === 'redeal' && H.redeals === 1 && H.stage === 0 && H.hole.every(h => h.length === 1) && sum(H.committed) === 200;
        [G, H] = saved; return !!a && b; }],
      ['2장 섯다 AI: 6인 여러 핸드, 예외·멈춤 없이 칩·카드 보존, 고르기 없음', () => {
        const saved = [G, H], it = ITERS; ITERS = 60;
        newGame({ names: [...'abcdef'], styles: ['pro', 'rock', 'station', 'lag', 'pro', 'lag'], stacks: Array(6).fill(20000), game: 'sutda' }); G.sdCards = 2;
        let ok = true, acts = 0;
        for (let h = 0; h < 12 && alive().length > 1; h++) {
          newHand();
          for (let k = 0; k < 300; k++) {
            const s = step(); if (s === 'end') break;
            if (s === 'act') { const d = decide(H.toAct); act(H.toAct, d.type, d.to); acts++; }
            ok = ok && s !== 'pick' && H.hole.every(x => x.length <= 2);
            const all = [...H.hole.flat(), ...H.deck, ...H.muck]; ok = ok && all.length === 20 && new Set(all).size === 20;
          }
          ok = ok && sum(G.stacks) === 120000 && !!H.result;
        }
        ITERS = it; [G, H] = saved; return ok && acts > 20; }],
      ['섯다 AI: 6인 여러 핸드, 예외·멈춤 없이 칩·카드 보존, 고르기는 가장 좋은 2장', () => {
        const saved = [G, H], it = ITERS; ITERS = 60;
        newGame({ names: [...'abcdef'], styles: ['pro', 'rock', 'station', 'lag', 'pro', 'lag'], stacks: Array(6).fill(20000), game: 'sutda' });
        let ok = sdBestDiscard(C('3광 8광 2')) === 2 && sdBestDiscard(C('5 1 2')) === 0, acts = 0;
        for (let h = 0; h < 12 && alive().length > 1; h++) {
          newHand();
          for (let k = 0; k < 300; k++) {
            const s = step(); if (s === 'end') break;
            if (s === 'act') { const d = decide(H.toAct); act(H.toAct, d.type, d.to); acts++; }
            if (s === 'pick') GAMES.sutda.steps.pick.ai(H.toAct);
            const all = [...H.hole.flat(), ...H.deck, ...H.muck]; ok = ok && all.length === 20 && new Set(all).size === 20;
          }
          ok = ok && sum(G.stacks) === 120000 && !!H.result;
        }
        ITERS = it; [G, H] = saved; return ok && acts > 20; }],
    ];
  },
};
