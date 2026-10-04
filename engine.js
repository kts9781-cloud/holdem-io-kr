// 홀덤 엔진: DOM 없음. 브라우저는 <script src="engine.js">로, 서버(Supabase Edge Function)는 이 파일에 export를 붙인 engine.mjs로 쓴다
// ===== 엔진: DOM 없음. 좌석 0 = 나, 나머지 = AI. 헤즈업은 2명인 경우 =====
let ITERS = 2000; // 몬테카를로 반복 횟수 (상대가 많으면 줄여 쓴다)
let RNG = Math.random; // 덱 셔플용 난수. 서버는 crypto 난수로 바꿔 끼운다
const CHIP = 100; // 가장 작은 칩. 모든 금액은 100 단위
// 실제 토너먼트처럼 오르는 블라인드
const LEVELS = [[100, 200], [200, 400], [300, 600], [400, 800], [500, 1000], [600, 1200], [800, 1600], [1000, 2000], [1200, 2400],
  [1500, 3000], [2000, 4000], [2500, 5000], [3000, 6000], [4000, 8000], [5000, 10000], [6000, 12000], [8000, 16000], [10000, 20000]];
// 블라인드 레벨은 G.level. 실제 대회처럼 화면의 토너먼트 시계가 시간으로 올린다 (엔진은 시간을 모른다)
const RANKS = '23456789TJQKA', SUITS = 'shdc', SUIT_GLYPH = '♠♥♦♣';
const rankOf = c => c >> 2, suitOf = c => c & 3;
const card = s => RANKS.indexOf(s[0]) * 4 + SUITS.indexOf(s[1]);
const rankLabel = r => r === 8 ? '10' : RANKS[r];
const cardText = c => rankLabel(rankOf(c)) + SUIT_GLYPH[suitOf(c)];
const fmt = n => n.toLocaleString('ko-KR');
const sum = a => a.reduce((s, x) => s + x, 0);
// 게임 목록: games/*.js가 규칙을 채운다 (홀덤 → games/holdem.js, 바둑이 → games/badugi.js). 서버도 같은 파일을 이어 붙여 쓴다
// G.game이 없으면 홀덤 (예전부터 저장된 홀덤 상태에는 game이 없다)
const GAMES = {};
const RULES = () => GAMES[G.game ?? 'holdem'];

// 상대 레인지 컷: 팟 크기 레이즈(공격 강도 1) 한 번이면 "상대가 레이즈하는 빈도(rr)"만큼의 상위 핸드로 좁힌다.
// 아무 패로나 레이즈하는 상대(rr≈1)는 거의 안 좁히고, 골라서 레이즈하는 상대는 크게 좁힌다. 상위 10%보다는 안 좁힌다
const rangeCut = (aggro, rr) => Math.min(0.9, 1 - rr ** aggro);

// ===== 게임 상태 =====
let G, H;
// opts: names[], styles[], stacks[]
function newGame(o) {
  const n = o.stacks.length;
  // stats: 베팅을 마주한 횟수, 폴드 횟수, 그때마다의 MDF(최소 방어 빈도) 합, 레이즈할 수 있었던 횟수, 실제 레이즈 횟수
  G = { n, names: o.names, styles: o.styles, game: o.game, stacks: o.stacks.slice(), out: Array(n).fill(false), place: Array(n).fill(null), // game: GAMES의 id (없으면 홀덤)
        level: 0, hand: 0, button: Math.floor(Math.random() * n),
        stats: Array.from({ length: n }, () => ({ faced: 0, folded: 0, mdf: 0, chances: 0, raises: 0 })) };
}
const alive = () => G.stacks.map((_, i) => i).filter(i => !G.out[i]);
const nextOf = (from, ok) => { for (let k = 1; k <= G.n; k++) { const i = (from + k) % G.n; if (ok(i)) return i; } return -1; };
const live = () => H.folded.map((f, i) => f ? -1 : i).filter(i => i >= 0); // 이번 핸드에서 아직 안 접은 사람
const maxBet = () => Math.max(...H.bets);
const allInRunout = () => live().length > 1 && live().filter(i => G.stacks[i] > 0).length <= 1; // 올인으로 더 걸 사람이 없다 → 패를 까고 남은 카드만 깐다
const needsAction = i => !H.folded[i] && G.stacks[i] > 0 && (!H.acted[i] || H.bets[i] < maxBet());
function put(p, x) { x = Math.min(x, G.stacks[p]); G.stacks[p] -= x; H.bets[p] += x; H.committed[p] += x; }

const mix = d => { for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(RNG() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; }; // 덱 섞기
function newHand() {
  if (G.hand) G.button = nextOf(G.button, i => !G.out[i]);
  G.hand++;
  const n = G.n, R = RULES(), sb = anteOf(G.level), bb = 2 * sb, d = mix([...Array(R.deckSize ?? 52).keys()]); // 블라인드: 레벨표(방장이 정했으면 그 배율·고정). 빅은 늘 스몰의 2배
  const z = () => Array(n).fill(0);
  H = { deck: d, hole: Array.from({ length: n }, () => []), board: [], bets: z(), committed: z(), aggro: z(),
        folded: G.out.slice(), acted: Array(n).fill(false), canRaise: Array(n).fill(true),
        lastRaise: bb, raises: 0, raiser: -1, opener: -1, lastAggr: -1, sb, bb, start: G.stacks.slice(), result: null, decision: null, busted: [] };
  for (let r = 0; r < (R.dealCards?.() ?? R.holeCards); r++) for (let k = 1; k <= n; k++) { const i = (G.button + k) % n; if (!G.out[i]) H.hole[i].push(d.pop()); } // 버튼 왼쪽부터 한 장씩
  R.post(sb, bb); // 블라인드(홀덤)·앤티(바둑이)와 첫 차례
}
function legal(p) {
  const mb = maxBet(), owe = mb - H.bets[p];
  const cap = Math.max(0, ...live().filter(i => i !== p).map(i => H.bets[i] + G.stacks[i])); // 아무도 못 받는 만큼은 의미 없음
  let maxTo = Math.min(H.bets[p] + G.stacks[p], cap);
  const R = RULES(); if (R.capRaise) maxTo = R.capRaise(p, maxTo, mb, owe); // 게임별 상한 (바둑이: 팟 리밋)
  return { toCall: Math.min(owe, G.stacks[p]), canCheck: owe === 0, canRaise: H.canRaise[p] && maxTo > mb,
           minTo: Math.min(mb + H.lastRaise, maxTo), maxTo };
}
function act(p, type, to) {
  const mb = maxBet(), owe = mb - H.bets[p], before = G.stacks[p], st = G.stats[p], L = legal(p);
  if (owe > 0) { const P = sum(H.committed); st.faced++; st.mdf += (P - owe) / P; }
  if (L.canRaise) { st.chances++; if (type === 'raise') st.raises++; }
  let label;
  if (type === 'raise' && !L.canRaise) type = 'call'; // 레이즈할 수 없으면 콜로 처리
  if (type === 'fold') { st.folded++; H.folded[p] = true; label = RULES().foldLabel; }
  else if (type === 'raise') {
    const names = RULES().betNames?.(p) ?? {}; // 금액이 버튼과 같으면 그 이름으로 부른다 (바둑이: 삥·따당·쿼터·하프·풀)
    to = Math.max(L.minTo, Math.min(L.maxTo, Math.round(to / CHIP) * CHIP));
    const inc = to - mb, full = inc >= H.lastRaise, verb = Object.keys(names).find(k => k !== '올인' && names[k] === to) ?? (mb ? '레이즈' : '베팅');
    const s = inc / (sum(H.committed) + owe); // 공격 강도: 1/2팟 0.75, 팟 1, 큰 올인은 최대 4
    if (full) { H.lastRaise = inc; H.raises = (H.raises ?? 0) + 1; H.raiser = p; if (H.raises === 1) H.opener = p; } // 이번 스트리트 몇 번째 레이즈인지, 누가
    H.lastAggr = p; // 주도권: 마지막으로 베팅·레이즈한 사람 (다음 스트리트까지 이어진다)
    // 최소 레이즈 이상이면 모두에게 액션이 다시 열리고, 모자란 올인이면 이미 행동한 사람은 콜/폴드만 할 수 있다
    for (const q of live()) if (q !== p && G.stacks[q] > 0) { if (full) H.canRaise[q] = true; else if (H.acted[q]) H.canRaise[q] = false; H.acted[q] = false; }
    put(p, to - H.bets[p]); H.aggro[p] += Math.min(4, 0.5 + s / 2);
    label = `${verb} ${fmt(H.bets[p])}`;
  } else { put(p, owe); label = owe ? `콜 ${fmt(before - G.stacks[p])}` : '체크'; }
  H.acted[p] = true;
  H.toAct = nextOf(p, needsAction);
  return type === 'fold' || G.stacks[p] ? label : `올인 · ${label}`;
}
function roundOver() {
  const lv = live();
  if (lv.length <= 1) return true;
  const canAct = lv.filter(i => G.stacks[i] > 0);
  // 칩이 남은 사람이 혼자이고 이미 최고 베팅을 맞췄다면 더 할 베팅이 없다
  if (lv.some(needsAction) && !(canAct.length === 1 && H.bets[canAct[0]] >= maxBet())) return false;
  const mb = maxBet(), top = H.bets.indexOf(mb), second = Math.max(0, ...H.bets.filter((_, i) => i !== top));
  if (mb > second) { const ex = mb - second; G.stacks[top] += ex; H.bets[top] -= ex; H.committed[top] -= ex; } // 아무도 받지 못한 초과분 반환
  return true;
}
function nextStreet() {
  RULES().dealStreet?.(); // 홀덤은 보드를 깐다 (바둑이는 보드가 없어 베팅 라운드만 새로 연다)
  H.bets.fill(0); H.acted.fill(false); H.canRaise.fill(true); H.lastRaise = H.bb; H.raises = 0; H.raiser = -1;
  H.toAct = nextOf(G.button, needsAction); // 플랍부터는 버튼 다음 사람부터 (헤즈업이면 BB)
}
// 정산: 올인 금액 층마다 사이드팟을 나누고 층마다 승자를 가린다. 폴드한 사람이 낸 칩도 팟에 남는다
function settle() {
  const n = G.n, lv = live(), total = sum(H.committed), pots = [];
  if (lv.length === 1) pots.push({ amt: total, elig: lv });
  else {
    let prev = 0;
    for (const L of [...new Set(lv.map(i => H.committed[i]))].sort((a, b) => a - b)) {
      let amt = 0;
      for (let i = 0; i < n; i++) amt += Math.max(0, Math.min(H.committed[i], L) - prev);
      pots.push({ amt, elig: lv.filter(i => H.committed[i] >= L) }); prev = L;
    }
    pots[pots.length - 1].amt += total - sum(pots.map(p => p.amt)); // 폴드한 사람이 더 많이 낸 몫(드묾)
  }
  const score = lv.length > 1 ? (RULES().scores?.(lv) ?? Object.fromEntries(lv.map(i => [i, RULES().score(i)]))) : null; // scores: 남은 사람 전체를 보고 정하는 게임 (섯다 특수패)
  const order = Array.from({ length: n }, (_, k) => (G.button + 1 + k) % n); // 남는 칩은 버튼 왼쪽부터
  for (const pot of pots) {
    const best = score && Math.max(...pot.elig.map(i => score[i]));
    const win = score ? pot.elig.filter(i => score[i] === best) : pot.elig;
    const unit = Math.floor(pot.amt / CHIP / win.length) * CHIP;
    win.forEach(i => G.stacks[i] += unit);
    let odd = pot.amt - unit * win.length;
    for (const i of order) if (odd && win.includes(i)) { const c = Math.min(CHIP, odd); G.stacks[i] += c; odd -= c; }
    pot.win = win;
  }
  H.result = { pots, win: [...new Set(pots.flatMap(p => p.win))], pot: total, showdown: lv.length > 1, score };
  H.committed.fill(0); H.bets.fill(0);
  // 탈락: 같은 핸드에서 여럿이 떨어지면 핸드 시작 때 칩이 많았던 사람이 더 높은 순위
  // 리바인(친구와 치기)할 수 있는 사람은 순위 없이 '고민 중'(pending)으로 두고, 그만할 때 순위를 매긴다
  const bust = alive().filter(i => G.stacks[i] === 0).sort((a, b) => H.start[b] - H.start[a]);
  const gone = bust.filter(i => !canRebuy(i));
  bust.forEach(i => { G.out[i] = true; if (canRebuy(i)) G.pending[i] = true; });
  const remain = alive().length + pendingCount();
  gone.forEach((i, k) => { G.place[i] = remain + 1 + k; });
  if (alive().length === 1 && !pendingCount()) G.place[alive()[0]] = 1;
  H.busted = bust;
}
const canRebuy = i => !!G.rebuyOpen && G.rebuysLeft?.[i] != null && G.rebuysLeft[i] !== 0; // -1 = 무제한
// 리바인 창이 열려 있나: 횟수가 정해진 방은 마감 시각(rebuyEnds)까지, 무제한 방은 마감이 없어(null) 끝까지
const rebuyWindow = now => !!G.rebuysLeft && (G.rebuyEnds == null || now < G.rebuyEnds);
const pendingCount = () => G.pending ? G.pending.filter(Boolean).length : 0;
function rebuy(i, stack) { G.pending[i] = false; G.out[i] = false; G.stacks[i] = stack; if (G.rebuysLeft[i] > 0) G.rebuysLeft[i]--; } // 다음 핸드부터
function quitPending(i) { // 리바인 안 함 → 아직 안 끝난 사람 수 + 1 위
  G.pending[i] = false; G.place[i] = alive().length + pendingCount() + 1;
  if (alive().length === 1 && !pendingCount()) G.place[alive()[0]] = 1;
}
// 한 단계 진행: 'act'(H.toAct 차례) | 'deal'(카드 깔림, 바둑이는 새 베팅 라운드) | 게임 고유 단계(바둑이 'draw': H.toAct가 카드를 바꿀 차례) | 'end'(정산 완료)
// 베팅이 없는 게임(예: 고스톱)은 규칙에 step을 두어 통째로 바꿔 끼운다
function step() {
  const R = RULES();
  if (R.step) return R.step();
  const many = live().length > 1;
  if (many && !R.busy?.() && !roundOver()) { if (!needsAction(H.toAct)) H.toAct = nextOf(Math.max(0, H.toAct), needsAction); return 'act'; } // busy: 게임 고유 단계 중 (바둑이 교환·섯다 고르기)
  if (many) { const s = R.afterRound(); if (s) return s; } // 베팅 라운드가 끝남 → 다음 카드·교환, 없으면 정산
  settle(); return 'end';
}

// 레벨의 스몰 블라인드(바둑이는 앤티): 방장이 정한 시작값(G.ante0)이 있으면 레벨표의 배율로 오르거나(anteUp) 고정, 없으면 레벨표 그대로 (100 → 200 → 300 …)
const anteOf = l => { const sb = LEVELS[Math.min(l, LEVELS.length - 1)][0]; return !G.ante0 ? sb : G.anteUp === false ? G.ante0 : sb * G.ante0 / 100; };

// ===== AI: 각자 자기 칩 기대값(EV)을 최대화. 서로 편먹지 않고 자기 패와 공개 정보만 본다 =====
// 성격은 계산식은 같고 몇 가지 성향만 다르다.
//  risk: 콜당했을 때 잃을 칩 감점 / bluff·slow: 블러프·슬로플레이 빈도 / realize: 에퀴티 실현율 보정(+면 더 콜)
//  defend: 상대가 얼마나 버틸 거라고 보는지(작을수록 상대가 잘 접는다고 봄) / press: 레이즈 가산점(팟 대비)
const STYLES = {
  pro:     { tag: '정석',   risk: 0.04, bluff: 0.3,  slow: 0.15, realize: 0,     defend: 1,    press: 0,    open: 1,   limp: 0,   callw: 1,    threeb: 1,    cbet: 1,    barrel: 1,   vthr: 0.72, raiseF: 1,    stick: 1,   size: 1 },
  rock:    { tag: '바위',   risk: 0.07, bluff: 0.1,  slow: 0.08, realize: -0.05, defend: 1.05, press: 0,    open: 0.6, limp: 0,   callw: 0.55, threeb: 0.5,  cbet: 0.5,  barrel: 0.3, vthr: 0.8,  raiseF: 0.6,  stick: 0.6, size: 0.9 },
  station: { tag: '콜링',   risk: 0.02, bluff: 0.12, slow: 0.35, realize: 0.07,  defend: 1.15, press: 0,    open: 0.5, limp: 1.8, callw: 2.4,  threeb: 0.25, cbet: 0.35, barrel: 0.3, vthr: 0.82, raiseF: 0.15, stick: 1.7, size: 0.8 },
  lag:     { tag: '공격형', risk: 0.03, bluff: 0.45, slow: 0.05, realize: 0.02,  defend: 0.88, press: 0.05, open: 1.5, limp: 0,   callw: 1.2,  threeb: 2,    cbet: 1.3,  barrel: 1.5, vthr: 0.64, raiseF: 1.5,  stick: 1.1, size: 1.35 },
};
//  open: 자리별 오픈 레인지 배율 / limp: 오픈 레인지 바로 아래(그 비율만큼)는 림프 / callw: 오픈·3벳에 콜하는 폭 / threeb: 3벳·4벳 폭과 블러프 3벳
//  cbet: 씨벳·세미 블러프·찔러보기 / barrel: 턴·리버 블러프 / vthr: 밸류 베팅하는 승률 기준 / raiseF: 베팅을 받아 레이즈하는 빈도
//  stick: 베팅에 버티는 정도(최소 방어 배율) / size: 베팅 크기 배율
// 예전 페르소나(진행 중이던 서버 게임)에는 새 값이 없을 수 있어 정석 값으로 채운다
const styleOf = s => ({ ...STYLES.pro, ...s });
// AI 베팅 판단은 게임마다 (홀덤 decideHoldem, 바둑이 decideBadugi, 섯다 decideSutda)
function decide(p) { return RULES().decide(p); }

// ===== 한국식 베팅 (바둑이·섯다): 팟 리밋. 삥(앤티만큼)·따당(앞 베팅의 2배)·쿼터·하프·풀(팟의 ¼·½·전부) =====
const potLimitCap = (p, maxTo, mb, owe) => Math.min(maxTo, mb + sum(H.committed) + owe); // 팟 리밋: 콜한 뒤의 팟만큼까지 올릴 수 있다
// 베팅 버튼의 금액(이 라운드에 내가 낸 총액). 삥: 앤티만큼(첫 베팅) / 따당: 앞 베팅의 2배 / 쿼터·하프·풀: 콜한 뒤 팟의 1/4·1/2·전부만큼 더 / 올인: 남은 칩이 풀 이하일 때
function krBets(p) {
  const L = legal(p), out = {};
  if (!L.canRaise) return out;
  const mb = maxBet(), pot = sum(H.committed) + mb - H.bets[p], low = mb ? Math.min(L.maxTo, 2 * mb) : L.minTo; // 가장 작은 버튼: 첫 베팅은 삥, 레이즈는 따당
  const fit = x => Math.max(low, Math.min(L.maxTo, Math.ceil(x / CHIP) * CHIP));
  if (mb) out['따당'] = fit(2 * mb); else out['삥'] = fit(H.ante);
  out['쿼터'] = fit(mb + pot / 4); out['하프'] = fit(mb + pot / 2); out['풀'] = fit(mb + pot);
  if (H.bets[p] + G.stacks[p] === L.maxTo) out['올인'] = L.maxTo;
  return out;
}
// AI 베팅: 승률(eq) + 성격(홀덤과 같은 STYLES) + 팟 오즈 + 상대 폴드율. 강하면 하프·풀, 중간이면 가끔 삥·쿼터, 약하면 가끔 블러프
// boost: 블러프 배율 (바둑이: 상대가 모두 나보다 많이 바꿨으면 2). game·iters는 판단 기록용
function krDecide(p, eq, boost, game, iters) {
  const s0 = G.styles[p], S = styleOf(typeof s0 === 'object' && s0 ? s0 : STYLES[s0] || STYLES.pro), L = legal(p), opts = krBets(p), r = Math.random();
  const po = L.toCall / (sum(H.committed) + L.toCall || 1), opps = live().filter(i => i !== p);
  // 홀덤처럼 상대가 베팅에 얼마나 접는지 보고(사전값 40%): 잘 접으면 블러프를 더, 안 접으면 덜 하고 밸류는 얇게
  const foldRate = sum(opps.map(q => (G.stats[q].folded + 2) / (G.stats[q].faced + 5))) / opps.length, A = Math.min(1.5, Math.max(0.1, foldRate / 0.4));
  const vthr = foldRate < 0.25 ? Math.min(0.62, S.vthr) : S.vthr;
  const pick = (...ks) => { for (const k of ks) if (opts[k] != null) return opts[k]; return opts['올인'] ?? null; };
  let type, to, tag;
  if (eq >= vthr && L.canRaise && !(L.canCheck && r < S.slow)) { type = 'raise'; to = eq >= 0.85 || S.size > 1.2 ? pick('풀', '하프') : pick('하프', '풀'); tag = '밸류'; }
  else if (L.canCheck) {
    if (eq >= 0.5 && L.canRaise && r < 0.5 * S.cbet) { type = 'raise'; to = pick('삥', '쿼터'); tag = '찔러보기'; }
    else if (eq < 0.5 && L.canRaise && r < S.bluff * 0.5 * A * boost) { type = 'raise'; to = pick('하프', '풀'); tag = '블러프'; }
    else { type = 'check'; tag = eq >= vthr ? '슬로플레이' : '체크'; }
  } else if (eq >= 0.5 ? eq >= po : eq * S.stick >= po * (1 + S.risk * 5)) { type = 'call'; tag = '콜'; }
  else { type = 'fold'; tag = '다이'; }
  if (type === 'raise' && to == null) type = L.canCheck ? 'check' : 'call';
  return { type, to, info: { who: p, eq, tag, iters, potOdds: po, game } };
}

// ===== 셀프 테스트 (?test=1) =====
function selfTest() {
  const E = s => evaluate(s.split(' ').map(card)), cat = s => Math.floor(E(s) / 13 ** 5);
  // 사이드팟 시나리오: 정해진 패·보드로 정산만 확인
  const pot = (stacks, committed, folded, holes, board, button = 0) => {
    const saved = [G, H];
    G = { n: stacks.length, stacks: stacks.slice(), out: stacks.map(() => false), place: stacks.map(() => null), button, hand: 1, level: 0, stats: [] };
    H = { committed: committed.slice(), bets: committed.map(() => 0), folded: folded.slice(), hole: holes.map(h => h ? h.split(' ').map(card) : []),
          board: board.split(' ').map(card), start: committed.map((c, i) => c + stacks[i]) };
    settle();
    const r = { stacks: G.stacks, place: G.place };
    [G, H] = saved;
    return r;
  };
  const cases = [
    // 0: 1,000 올인(최강), 1: 3,000 올인(중간), 2: 5,000(최약), 3: 2,000 내고 폴드 → 메인 4,000은 0, 사이드 5,000은 1, 남는 2,000은 2
    ['사이드팟: 짧은 올인이 이기면 메인만', () => { const r = pot([0, 0, 0, 1000], [1000, 3000, 5000, 2000], [false, false, false, true],
      ['As Ad', 'Ks Kd', '7c 2h', '9s 9d'], 'Ah Kh 5c 3d 8s');
      return r.stacks.join() === '4000,5000,2000,1000' && r.place.every(x => x === null); }],
    ['사이드팟: 세 명 나눠먹기 + 남는 칩', () => { const r = pot([0, 0, 0], [300, 300, 300], [false, false, false],
      ['2c 3c', '2d 3d', '2h 3h'], 'As Ks Qs Js 9d', 0); // 보드 플레이 → 900을 셋이 300씩
      return r.stacks.join() === '300,300,300'; }],
    ['남는 1칩은 버튼 왼쪽부터', () => { const r = pot([0, 0, 1000], [100, 100, 100], [false, false, true],
      ['2c 3c', '2d 3d', '7h 8h'], 'As Ks Qs Js 9d', 0); // 300을 둘이: 100씩 + 남는 100은 버튼(0) 왼쪽인 1에게
      return r.stacks.join() === '100,200,1000'; }],
    ['폴드한 사람의 칩도 팟에 남는다', () => { const r = pot([0, 500, 0], [400, 400, 200], [false, false, true],
      ['As Ad', '7c 2h', 'Ks Kd'], 'Ah Kh 5c 3d 8s');
      return r.stacks.join() === '1000,500,0'; }],
    // 4명: 1(리바인 가능)과 2(불가)가 같은 핸드에 탈락 → 2는 바로 4위, 1은 고민 중 → 그만하면 3위. 리바인하면 다시 살아난다
    ['리바인: 고민 중은 순위 보류, 그만하면 다음 순위', () => {
      const saved = [G, H];
      G = { n: 4, stacks: [3000, 0, 0, 500], out: [false, false, false, false], place: [null, null, null, null], button: 0, hand: 1, level: 0, stats: [],
            rebuyOpen: true, rebuysLeft: [2, 2, null, null], pending: [false, false, false, false] };
      H = { committed: [0, 1000, 1000, 1000], bets: [0, 0, 0, 0], folded: [true, false, false, false], hole: [[], ...['7c 2h', '8d 3s', 'As Ad'].map(h => h.split(' ').map(card))],
            board: 'Kh Qd 9c 5s 4h'.split(' ').map(card), start: [3000, 1000, 1000, 1500] };
      settle();
      const a = G.pending[1] && G.place[1] === null && G.place[2] === 4;
      quitPending(1); const b = G.place[1] === 3 && !G.pending[1];
      G.pending[1] = true; G.place[1] = null; rebuy(1, 20000); const c = !G.out[1] && G.stacks[1] === 20000 && G.rebuysLeft[1] === 1;
      [G, H] = saved;
      return a && b && c; }],
    ['리바인 창: 횟수 방은 마감 시각까지, 무제한 방(마감 없음)은 끝까지', () => {
      const saved = G;
      G = { rebuysLeft: [2, null], rebuyEnds: 1000 }; const a = rebuyWindow(999) && !rebuyWindow(1000);
      G = { rebuysLeft: [-1, null], rebuyEnds: null }; const b = rebuyWindow(1e15);
      G = {}; const c = !rebuyWindow(0); // 리바인 없는 방
      G = saved;
      return a && b && c; }],
    ['승점: 헤즈업 1500이 1600을 이기면 +26 (K40)', () => eloDeltaByPlace(1500, [1600], 1, 40) === 26 && eloDeltaByPlace(1500, [1600], 2, 40) === -14],
    ['승점: 9인 3위(모두 1500) +10, 꼴찌 -20', () => eloDeltaByPlace(1500, Array(8).fill(1500), 3, 40) === 10 && eloDeltaByPlace(1500, Array(8).fill(1500), 9, 40) === -20],
    ['승점: 친구 셋 순위대로 +20 -8 -12', () => [0, 1, 2].map(i => eloDelta(i, [1500, 1600, 1400], [1, 2, 3], 40)).join() === '20,-8,-12'],
    ['승점: K는 20판까지 40, 그 뒤 24', () => eloK(0) === 40 && eloK(19) === 40 && eloK(20) === 24],
    ['칩 순서 순위: 칩이 같으면 같은 순위', () => JSON.stringify(placesByChips([0, 2, 5, 1], [20000, 30000, 20000, 0, 0, 5000])) === '{"0":2,"1":1,"2":2,"5":4}'],
    ...Object.values(GAMES).flatMap(g => g.tests ? g.tests(pot) : []), // 게임별 자체 테스트
  ];
  return { total: cases.length, fails: cases.filter(([, f]) => { try { return !f(); } catch (e) { return true; } }).map(([n]) => n) };
}

// ===== 페르소나: 게임마다 이름·소개·성격·성향 수치를 무작위로 (서버도 AI 자리를 채울 때 쓴다) =====
const NAME_POOL = ['빅토르', '민지', '레오', '사쿠라', '도윤', '엘레나', '마르코', '하나', '제이크', '수아', '이반', '루시아', '카이', '나탈리', '오스카', '유나'];
// 소개는 성격과 상관없는 배경만. 성격은 게임 중에 숨기고 토너먼트가 끝나면 공개한다 (쳐 보면서 읽어 내는 재미)
const BIOS = ['부산에서 횟집을 하는 사장님', '수학과 대학원생', '은퇴한 프로야구 선수', '라스베이거스 딜러 출신', '스타트업 대표', '웹툰 작가',
  '주말마다 홈게임을 여는 회사원', '마카오에서 막 돌아온 여행자', '체스 국가대표 출신', '전직 증권사 트레이더', '동네 카페 로스터', '의대 졸업반',
  '택시 기사 20년 경력', '해외 대회 첫 출전', '포커 유튜브 채널 운영자', '은퇴한 고등학교 교사'];
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function persona() {
  const key = pickOne(Object.keys(STYLES)), b = STYLES[key], j = () => 0.8 + Math.random() * 0.4; // 같은 성격이어도 ±20% 흔든다
  return { bio: pickOne(BIOS), style: { tag: b.tag, risk: b.risk * j(), bluff: b.bluff * j(), slow: b.slow * j(), realize: b.realize * j(),
    defend: b.defend * (0.95 + Math.random() * 0.1), press: b.press * j(), open: b.open * (0.9 + Math.random() * 0.2), limp: b.limp * j(),
    callw: b.callw * j(), threeb: b.threeb * j(), cbet: b.cbet * j(), barrel: b.barrel * j(), vthr: b.vthr * (0.97 + Math.random() * 0.06), raiseF: b.raiseF * j(), stick: b.stick * j(), size: b.size * (0.9 + Math.random() * 0.2) } };
}
// ===== 승점: 맞대결 ELO (순위를 참가자 쌍마다 1:1 결과로 보고 체스 ELO를 그대로) =====
const RATING0 = 1500;
const AI_RATING = { '정석': 1600, '공격형': 1500, '바위': 1450, '콜링': 1350 }; // AI는 고정 점수 (성격 tag로 찾는다)
const eloK = games => games < 20 ? 40 : 24; // 처음 20판은 빨리 자리를 잡게
const eloE = (mine, opp) => 1 / (1 + 10 ** ((opp - mine) / 400)); // 기대 승률
// 모든 참가자의 순위를 알 때 (친구와 치기: 서버가 판정). places는 1이 가장 높다
function eloDelta(i, ratings, places, k) {
  let s = 0;
  for (let j = 0; j < ratings.length; j++) if (j !== i) s += (places[i] < places[j] ? 1 : places[i] > places[j] ? 0 : 0.5) - eloE(ratings[i], ratings[j]);
  return Math.round(k / (ratings.length - 1) * s);
}
// 내 순위만 알 때 (AI 게임: 어느 AI가 위였는지는 기기 말을 믿지 않는다) → 나보다 아래인 수만큼 이겼다고 보고 상대 전체에 고르게
function eloDeltaByPlace(mine, opps, place, k) {
  const n = opps.length + 1;
  return Math.round(k / (n - 1) * ((n - place) - sum(opps.map(r => eloE(mine, r)))));
}
// 칩 순서로 순위 (모두 자리를 비워 끝낼 때). 칩이 같으면 같은 순위: 1, 2, 2, 4 → { 자리: 순위 }
function placesByChips(ids, stacks) {
  const s = [...ids].sort((a, b) => stacks[b] - stacks[a]), out = {};
  s.forEach((i, k) => { out[i] = k && stacks[i] === stacks[s[k - 1]] ? out[s[k - 1]] : k + 1; });
  return out;
}