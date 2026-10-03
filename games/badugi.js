// 바둑이 규칙과 AI: 4장, 아침·점심·저녁 세 번 교환, 무늬·숫자가 모두 다른 낮은 패가 이긴다. 한국식 팟 리밋(삥·따당·쿼터·하프·풀)
// engine.js 다음에 불러온다 (서버는 scripts/build-server-engine.sh가 이어 붙인다)
const lowRank = c => (rankOf(c) + 1) % 13; // A = 0(가장 낮다) … K = 12
const lowLabel = r => r === 0 ? 'A' : r < 10 ? String(r + 1) : 'JQK'[r - 10];
// 족보: 무늬·숫자가 모두 다른 카드로 만든 가장 좋은 조합. 장수가 많을수록, 그다음은 높은 카드가 낮을수록 강하다 → { score(클수록 강함), cards }
// (AI가 한 번 판단할 때 수만 번 부르므로 비트마스크로: 숫자·무늬가 겹치면 그 조합은 건너뛴다. score = 장수 × 14⁴ + 높은 카드부터 (13 − 숫자))
function badugi(cs) {
  let best = -1, bm = 0;
  for (let m = 1; m < 1 << cs.length; m++) {
    let rm = 0, sm = 0, cnt = 0, ok = true;
    for (let i = 0; i < cs.length; i++) if (m >> i & 1) {
      const r = 1 << lowRank(cs[i]), su = 1 << suitOf(cs[i]);
      if (rm & r || sm & su) { ok = false; break; }
      rm |= r; sm |= su; cnt++;
    }
    if (!ok) continue;
    let score = cnt, k = 0;
    for (let r = 12; r >= 0; r--) if (rm >> r & 1) { score = score * 14 + 13 - r; k++; }
    for (; k < 4; k++) score *= 14;
    if (score > best) { best = score; bm = m; }
  }
  return { score: best, cards: cs.filter((_, i) => bm >> i & 1) };
}
function badugiName(b) {
  const ks = b.cards.map(lowRank).sort((x, y) => y - x), top = lowLabel(ks[0]);
  if (ks.length === 4) return { '3,2,1,0': '골프', '4,2,1,0': '세컨드', '4,3,1,0': '써드' }[ks.join()] ?? `${top} 탑 메이드`;
  return `${['', '한 장', '투베이스', '베이스'][ks.length]} · ${top} 탑`;
}
// 베팅 버튼의 금액(이 라운드에 내가 낸 총액). 삥: 앤티만큼(첫 베팅) / 따당: 앞 베팅의 2배 / 쿼터·하프·풀: 콜한 뒤 팟의 1/4·1/2·전부만큼 더 / 올인: 남은 칩이 풀 이하일 때
function badugiBets(p) {
  const L = legal(p), out = {};
  if (!L.canRaise) return out;
  const mb = maxBet(), pot = sum(H.committed) + mb - H.bets[p], low = mb ? Math.min(L.maxTo, 2 * mb) : L.minTo; // 가장 작은 버튼: 첫 베팅은 삥, 레이즈는 따당
  const fit = x => Math.max(low, Math.min(L.maxTo, Math.ceil(x / CHIP) * CHIP));
  if (mb) out['따당'] = fit(2 * mb); else out['삥'] = fit(H.ante);
  out['쿼터'] = fit(mb + pot / 4); out['하프'] = fit(mb + pot / 2); out['풀'] = fit(mb + pot);
  if (H.bets[p] + G.stacks[p] === L.maxTo) out['올인'] = L.maxTo;
  return out;
}
// ===== 바둑이 AI: 교환은 규칙대로, 베팅은 몬테카를로 승률 + 팟 오즈 + 성격(홀덤과 같은 STYLES) =====
// 바꿀 자리: 가장 좋은 조합에 안 든 카드. 교환이 2번 이상 남았는데 조합(3장 이상)의 탑이 J 이상이고 다음 카드가 7 이하면 탑도 깬다
function drawPlan(cs, left) {
  const keep = badugi(cs).cards.sort((a, b) => lowRank(b) - lowRank(a));
  if (left >= 2 && keep.length >= 3 && lowRank(keep[0]) >= 10 && lowRank(keep[1]) <= 6) keep.shift();
  return cs.map((c, i) => keep.includes(c) ? -1 : i).filter(i => i >= 0);
}
// 지금 4장 족보가 무작위 4장 중 위에서 몇 %인지 (0 = 최약, 1 = 최강). 무작위 4,000판으로 한 번 만들어 둔다
let BD_DIST = null;
function bdPct(sc) {
  if (!BD_DIST) BD_DIST = Array.from({ length: 4000 }, () => { const h = new Set(); while (h.size < 4) h.add(Math.floor(Math.random() * 52)); return badugi([...h]).score; }).sort((a, b) => a - b);
  let lo = 0, hi = BD_DIST.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (BD_DIST[m] < sc) lo = m + 1; else hi = m; }
  return lo / BD_DIST.length;
}
// 승률: 상대 패는 직전 교환에서 바꾼 장수에 맞게 뽑고(스테이 → 메이드, 1장 → 3장 조합 이상, 2장 → 2장 이상),
// 이번 핸드에 올린 상대는 홀덤처럼 레이즈 빈도만큼 위쪽 패로 좁힌다. 남은 교환까지 모두 drawPlan대로 바꾼 뒤 비교한다. 동점은 나눈다
// ponytail: 버린 카드는 다시 쓰지 않는다(덱이 모자라면 안 바꾼다). 6명이 세 번 다 바꿀 때만 모자라다
function badugiEquity(p, iters) {
  const opps = live().filter(i => i !== p), left = 3 - H.draws, mine = H.hole[p], pool = [];
  for (let c = 0; c < 52; c++) if (!mine.includes(c)) pool.push(c);
  const need = q => H.drew?.[q] == null ? 0 : (4 - H.drew[q]) * 14 ** 4; // 이 점수(장수) 이상의 조합을 들고 있다고 본다
  const cut = Object.fromEntries(opps.map(q => [q, H.aggro[q] ? rangeCut(H.aggro[q], (G.stats[q].raises + 3) / (G.stats[q].chances + 4)) : 0]));
  let won = 0;
  for (let it = 0; it < iters; it++) {
    let n = pool.length;
    const take = () => { const j = Math.floor(Math.random() * n), c = pool[j]; pool[j] = pool[n - 1]; pool[n - 1] = c; n--; return c; }; // 뽑은 카드는 뒤로 (n을 되돌리면 다시 넣은 것)
    const hands = [mine.slice()];
    for (const q of opps) {
      let h;
      const tries = need(q) >= 4 * 14 ** 4 ? 200 : 40; // 스테이한 상대(메이드)는 무작위 4장 중 6%뿐이라 더 뽑는다
      for (let t = 0; t < tries; t++) { h = [take(), take(), take(), take()]; const sc = badugi(h).score; if (sc >= need(q) && (!cut[q] || bdPct(sc) >= cut[q])) break; if (t < tries - 1) n += 4; }
      hands.push(h);
    }
    for (let r = left; r > 0; r--) for (const h of hands) for (const i of drawPlan(h, r)) if (n) h[i] = take();
    const sc = hands.map(h => badugi(h).score), top = Math.max(...sc);
    if (sc[0] === top) won += 1 / sc.filter(x => x === top).length;
  }
  return won / iters;
}
// 베팅: 강하면 하프·풀, 중간이면 가끔 삥·쿼터, 약하면 가끔 블러프. 받을 베팅이 있으면 팟 오즈와 비교해 콜·다이
function decideBadugi(p) {
  const s0 = G.styles[p], S = styleOf(typeof s0 === 'object' && s0 ? s0 : STYLES[s0] || STYLES.pro), L = legal(p), opts = badugiBets(p);
  const iters = Math.max(100, Math.round(ITERS / 4)), eq = badugiEquity(p, iters), r = Math.random();
  const po = L.toCall / (sum(H.committed) + L.toCall || 1), opps = live().filter(i => i !== p);
  const drewMore = H.draws > 0 && opps.every(q => (H.drew[q] ?? 0) > (H.drew[p] ?? 0)); // 상대가 모두 나보다 많이 바꿨다 → 블러프가 잘 통한다
  // 홀덤처럼 상대가 베팅에 얼마나 접는지 보고(사전값 40%): 잘 접으면 블러프를 더, 안 접으면 덜 하고 밸류는 얇게
  const foldRate = sum(opps.map(q => (G.stats[q].folded + 2) / (G.stats[q].faced + 5))) / opps.length, A = Math.min(1.5, Math.max(0.1, foldRate / 0.4));
  const vthr = foldRate < 0.25 ? Math.min(0.62, S.vthr) : S.vthr;
  const pick = (...ks) => { for (const k of ks) if (opts[k] != null) return opts[k]; return opts['올인'] ?? null; };
  let type, to, tag;
  if (eq >= vthr && L.canRaise && !(L.canCheck && r < S.slow)) { type = 'raise'; to = eq >= 0.85 || S.size > 1.2 ? pick('풀', '하프') : pick('하프', '풀'); tag = '밸류'; }
  else if (L.canCheck) {
    if (eq >= 0.5 && L.canRaise && r < 0.5 * S.cbet) { type = 'raise'; to = pick('삥', '쿼터'); tag = '찔러보기'; }
    else if (eq < 0.5 && L.canRaise && r < S.bluff * 0.5 * A * (drewMore ? 2 : 1)) { type = 'raise'; to = pick('하프', '풀'); tag = '블러프'; }
    else { type = 'check'; tag = eq >= vthr ? '슬로플레이' : '체크'; }
  } else if (eq >= 0.5 ? eq >= po : eq * S.stick >= po * (1 + S.risk * 5)) { type = 'call'; tag = '콜'; }
  else { type = 'fold'; tag = '다이'; }
  if (type === 'raise' && to == null) type = L.canCheck ? 'check' : 'call';
  return { type, to, info: { who: p, eq, tag, iters, potOdds: po, game: 'badugi' } };
}
// 교환 단계: 버튼 다음 사람부터 한 명씩 'draw'. 모두 바꾸면 다음 베팅 라운드를 연다('deal')
function drawStep() {
  if (!H.drawing) { H.drawing = true; H.drew = Array(G.n).fill(null); }
  const p = nextOf(G.button, i => !H.folded[i] && H.drew[i] == null);
  if (p >= 0) { H.toAct = p; return 'draw'; }
  H.drawing = false; H.draws++;
  nextStreet();
  return 'deal';
}
// 교환: 고른 자리(idxs)의 카드를 덱에서 새로 받는다 (자리는 그대로). 버린 카드는 모아 두었다가(H.muck) 덱이 떨어지면 섞어서 덱으로 쓴다
function draw(p, idxs) {
  const out = [];
  for (const i of idxs) {
    if (!H.deck.length) { H.deck = mix(H.muck); H.muck = []; }
    if (!H.deck.length) break; // 쓸 카드가 없으면 그대로 둔다 (6명 이하에서는 일어나지 않는다)
    out.push(H.hole[p][i]); H.hole[p][i] = H.deck.pop();
  }
  H.muck.push(...out); // 방금 버린 카드는 이 사람이 다 받은 뒤에야 다시 쓰일 수 있다
  H.drew[p] = out.length;
  return out.length ? `${out.length}장` : '스테이';
}

GAMES.badugi = {
  id: 'badugi', name: '바둑이', seats: [2, 6], ranked: false, holeCards: 4, minV: 2, // 승점·전적에 안 넣는다 / 화면 버전 2부터 바둑이를 그린다
  stakeName: '앤티', minChipsX: 10, foldLabel: '다이', // 시작 칩은 앤티의 10배 이상
  stakeInput: '앤티', chipsBase: '앤티', // 방 만들기 오류 문구
  fixedSeats: true, // seats에 있는 인원으로만 만든다 (홀덤은 2~9명 아무나)
  post(sb) { // 블라인드 대신 모두 앤티. 앤티는 팟에만 들어가고 이번 라운드 베팅(bets)에는 안 들어가서 첫 라운드부터 체크할 수 있다
    const ante = sb;
    Object.assign(H, { ante, sb: 0, bb: ante, lastRaise: ante, draws: 0, drawing: false, drew: Array(G.n).fill(null), muck: [] });
    for (const i of alive()) { const x = Math.min(ante, G.stacks[i]); G.stacks[i] -= x; H.committed[i] += x; }
    H.toAct = nextOf(G.button, needsAction); // 베팅도 교환도 버튼 다음 사람부터
  },
  capRaise: (p, maxTo, mb, owe) => Math.min(maxTo, mb + sum(H.committed) + owe), // 팟 리밋: 콜한 뒤의 팟만큼까지 올릴 수 있다
  betNames: p => badugiBets(p), // 금액이 버튼과 같으면 그 이름으로 부른다
  afterRound: () => H.drawing || H.draws < 3 ? drawStep() : null, // 베팅 라운드가 끝나면 교환, 세 번 다 바꿨으면 승부
  score: i => badugi(H.hole[i]).score,
  best: i => badugi(H.hole[i]),
  handName: b => badugiName(b),
  decide: p => decideBadugi(p),
  // 게임 고유 단계 'draw'(교환): 서버가 AI·자동 처리와 이벤트를 만들 때 쓴다 (이벤트에는 장수만, 카드는 안 보낸다)
  steps: {
    draw: {
      ai: p => { const idxs = drawPlan(H.hole[p], 3 - H.draws); return { idxs, label: draw(p, idxs) }; },
      auto: p => ({ idxs: [], label: draw(p, []) }), // 시간 초과·자리 비움·나가기 → 스테이
      event: (p, label) => ({ t: 'draw', seat: p, n: H.drew[p], label, draws: H.draws }),
      turn: () => ({ draw: true, draws: H.draws }), // 사람 차례(turn 이벤트)에 붙는다
    },
  },
  pendingStep: () => H?.drawing ? 'draw' : null, // 지금 교환 단계인가
  roundEvent: () => ({ t: 'round', draws: H.draws }), // 교환이 끝나 새 베팅 라운드 (보드가 없다)
  tests: () => [
      ['바둑이 족보: 골프 > 세컨드 > 써드 > 메이드 > 베이스 > 투베이스 > 한 장', () => {
        const B = s => badugi(s.split(' ').map(card)), S = s => B(s).score, N = s => badugiName(B(s));
        return S('As 2h 3d 4c') > S('As 2h 3d 5c') && S('As 2h 3d 5c') > S('As 2h 4d 5c') && S('As 2h 4d 5c') > S('2s 3h 4d 6c')
          && S('Ks Qh Jd Tc') > S('As 2h 3d 3c') && S('As 2h 3d Kd') > S('As 2s 3s 4h') && S('As 2s 3s 4h') > S('As 2s 3s 4s')
          && S('Ah Kh 2d 3c') === S('As 2d 3c 3h') // 같은 무늬 중 낮은 쪽을 쓴다 / 무늬만 다르면 동점
          && N('As 2h 3d 4c') === '골프' && N('As 2h 3d 5c') === '세컨드' && N('As 2h 4d 5c') === '써드' && N('2s 5h 6d 7c') === '7 탑 메이드'
          && N('Ts 2h 3d 4c') === '10 탑 메이드' && N('As 2h 3d 3c') === '베이스 · 3 탑' && N('As 2s 3s 4h') === '투베이스 · 4 탑' && N('As 2s 3s 4s') === '한 장 · A 탑'; }],
      ['바둑이 베팅: 앤티, 팟 리밋, 버튼 금액, 올릴 수 없으면 버튼 없음', () => {
        const saved = [G, H];
        newGame({ names: ['a', 'b', 'c'], styles: [null, null, null], stacks: [20000, 20000, 20000], game: 'badugi' }); G.button = 0; newHand();
        const p = H.toAct, L = legal(p), b = badugiBets(p);
        const a = p === 1 && H.hole.every(h => h.length === 4) && G.stacks.join() === '19900,19900,19900' && sum(H.committed) === 300 && sum(H.bets) === 0 && L.canCheck && L.minTo === 100 && L.maxTo === 300;
        const c = b['삥'] === 100 && b['쿼터'] === 100 && b['하프'] === 200 && b['풀'] === 300 && !('따당' in b) && !('올인' in b);
        const label = act(p, 'raise', 300), q = H.toAct, L2 = legal(q), b2 = badugiBets(q); // 풀 300 → 다음 사람: 팟 600 + 받을 300
        const d = label === '풀 300' && L2.toCall === 300 && L2.maxTo === 1200 && b2['따당'] === 600 && b2['쿼터'] === 600 && b2['하프'] === 800 && b2['풀'] === 1200 && !('삥' in b2);
        act(q, 'raise', 900); const b3 = badugiBets(p); // 다시 올린 뒤(300 → 900, 팟 1,500 + 받을 600): 최소 레이즈는 1,500이지만 버튼은 따당(1,800)보다 작아지지 않는다
        const f = legal(p).minTo === 1500 && b3['따당'] === 1800 && b3['쿼터'] === 1800 && b3['하프'] === 2000 && b3['풀'] === 3000;
        H.canRaise[p] = false; const e = Object.keys(badugiBets(p)).length === 0 && act(p, 'fold') === '다이';
        [G, H] = saved; return a && c && d && e && f; }],
      ['바둑이 진행: 베팅 → 교환 세 번 → 승부, 고른 자리 카드만 바뀐다', () => {
        const saved = [G, H];
        newGame({ names: ['a', 'b'], styles: [null, null], stacks: [20000, 20000], game: 'badugi' }); newHand();
        const seen = []; let ok = true;
        for (let k = 0; k < 40; k++) {
          const s = step(); seen.push(s);
          if (s === 'end') break;
          if (s === 'act') act(H.toAct, 'check');
          if (s === 'draw') { const p = H.toAct, was = H.hole[p].slice(), lab = draw(p, p === 0 ? [1, 3] : []);
            ok = ok && (p === 0 ? lab === '2장' && H.hole[p][0] === was[0] && H.hole[p][2] === was[2] && H.hole[p][1] !== was[1] && H.hole[p][3] !== was[3] : lab === '스테이' && H.hole[p].join() === was.join()); }
        }
        const all = [...H.hole[0], ...H.hole[1], ...H.deck, ...H.muck];
        const r = ok && seen.join() === 'act,act,draw,draw,deal,act,act,draw,draw,deal,act,act,draw,draw,deal,act,act,end' && all.length === 52 && new Set(all).size === 52 && sum(G.stacks) === 40000 && H.draws === 3;
        [G, H] = saved; return r; }],
      ['바둑이 덱: 6명이 세 번 모두 4장씩 바꿔도 카드가 모자라거나 겹치지 않는다', () => {
        const saved = [G, H];
        newGame({ names: [...'abcdef'], styles: Array(6).fill(null), stacks: Array(6).fill(20000), game: 'badugi' }); newHand();
        let ok = true;
        for (let k = 0; k < 200; k++) {
          const s = step(); if (s === 'end') break;
          if (s === 'act') act(H.toAct, 'check');
          if (s === 'draw') ok = ok && draw(H.toAct, [0, 1, 2, 3]) === '4장';
          const all = [...H.hole.flat(), ...H.deck, ...H.muck]; ok = ok && all.length === 52 && new Set(all).size === 52;
        }
        const r = ok && H.draws === 3 && sum(G.stacks) === 120000;
        [G, H] = saved; return r; }],
      ['바둑이 앤티 올인: 앤티도 모자란 사람은 낸 만큼만 걸고 승부까지 간다', () => {
        const saved = [G, H];
        newGame({ names: ['a', 'b', 'c'], styles: [null, null, null], stacks: [50, 20000, 20000], game: 'badugi' }); G.button = 0; newHand();
        const a = G.stacks[0] === 0 && H.committed.join() === '50,100,100' && H.toAct === 1;
        let draws0 = 0;
        for (let k = 0; k < 60; k++) { const s = step(); if (s === 'end') break; if (s === 'act') act(H.toAct, 'check'); if (s === 'draw') { if (H.toAct === 0) draws0++; draw(H.toAct, []); } }
        const main = H.result.pots[0], r = a && draws0 === 3 && H.result.pots.length === 2 && main.amt === 150 && main.elig.length === 3 && sum(G.stacks) === 40050;
        [G, H] = saved; return r; }],
      ['바둑이 앤티: 방장이 정한 시작 앤티의 배율로 오르거나 고정, 정하지 않으면 레벨표', () => {
        const saved = G, r = [];
        G = { ante0: 500, anteUp: true }; r.push(anteOf(0) === 500, anteOf(1) === 1000, anteOf(2) === 1500, anteOf(99) === 50000);
        G = { ante0: 500, anteUp: false }; r.push(anteOf(0) === 500, anteOf(7) === 500);
        G = {}; r.push(anteOf(0) === 100, anteOf(1) === 200);
        G = saved; return r.every(Boolean); }],
      ['바둑이 AI 교환: 메이드는 스테이, 겹친 카드는 바꾸고, 교환이 많이 남으면 높은 탑을 깬다', () => {
        const P = (s, left) => drawPlan(s.split(' ').map(card), left).join();
        return P('As 2h 3d 4c', 3) === '' && P('As 2h 3d 3c', 1) === '3' && P('As 2s 3s 4s', 2) === '1,2,3'
          && P('Ks 2h 3d 4c', 3) === '0' && P('Ks 2h 3d 4c', 1) === '' && P('Qs Jh 3d 4c', 3) === '' && P('Ks 7h 3d 4d', 2) === '0,3'; }],
      ['바둑이 AI: AI만으로 6인 바둑이 여러 핸드, 예외·멈춤 없이 칩·카드 보존', () => {
        const saved = [G, H], it = ITERS; ITERS = 60;
        newGame({ names: [...'abcdef'], styles: ['pro', 'rock', 'station', 'lag', 'pro', 'lag'], stacks: Array(6).fill(20000), game: 'badugi' });
        let ok = true, acts = 0;
        for (let h = 0; h < 12 && alive().length > 1; h++) {
          newHand();
          for (let k = 0; k < 300; k++) {
            const s = step(); if (s === 'end') break;
            if (s === 'act') { const d = decide(H.toAct); act(H.toAct, d.type, d.to); acts++; }
            if (s === 'draw') draw(H.toAct, drawPlan(H.hole[H.toAct], 3 - H.draws));
            const all = [...H.hole.flat(), ...H.deck, ...H.muck]; ok = ok && all.length === 52 && new Set(all).size === 52;
          }
          ok = ok && sum(G.stacks) === 120000 && !!H.result;
        }
        ITERS = it; [G, H] = saved; return ok && acts > 20; }],
  ],
};
