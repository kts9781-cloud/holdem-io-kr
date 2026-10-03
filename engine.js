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
const HAND_NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

// 랭크 비트마스크에서 스트레이트 최고 랭크 (없으면 -1). A-5 휠은 3('5') 반환.
function straightHigh(m) {
  const w = (m << 1) | ((m >> 12) & 1);
  for (let h = 13; h >= 4; h--) if (((w >> (h - 4)) & 31) === 31) return h - 1;
  return -1;
}

// 5~7장 → 비교 가능한 정수 (클수록 강함). 족보 × 13^5 + 키커 5개.
function evaluate(cs) {
  const rc = new Array(13).fill(0), sc = [0, 0, 0, 0], sm = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cs) { const r = c >> 2, s = c & 3; rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r; }
  const score = (cat, ks) => { let v = cat; for (let i = 0; i < 5; i++) v = v * 13 + (ks[i] ?? 0); return v; };
  // 7장 이하에서 플러시가 있으면 포카드·풀하우스는 불가능하므로 먼저 확인해도 된다
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) {
    const h = straightHigh(sm[s]);
    if (h >= 0) return score(8, [h]);
    const ks = [];
    for (let r = 12; r >= 0 && ks.length < 5; r--) if ((sm[s] >> r) & 1) ks.push(r);
    return score(5, ks);
  }
  const g = [[], [], [], [], []];
  for (let r = 12; r >= 0; r--) g[rc[r]].push(r);
  const [, , pairs, trips, quads] = g;
  const kick = (ex, n) => { const k = []; for (let r = 12; r >= 0 && k.length < n; r--) if (rc[r] && !ex.includes(r)) k.push(r); return k; };
  if (quads.length) return score(7, [quads[0], ...kick([quads[0]], 1)]);
  if (trips.length && (trips.length > 1 || pairs.length)) return score(6, [trips[0], Math.max(trips[1] ?? -1, pairs[0] ?? -1)]);
  const st = straightHigh(mask);
  if (st >= 0) return score(4, [st]);
  if (trips.length) return score(3, [trips[0], ...kick([trips[0]], 2)]);
  if (pairs.length > 1) return score(2, [pairs[0], pairs[1], ...kick(pairs.slice(0, 2), 1)]);
  if (pairs.length) return score(1, [pairs[0], ...kick([pairs[0]], 3)]);
  return score(0, kick([], 5));
}

function handName(score) {
  const cat = Math.floor(score / 13 ** 5);
  return cat === 8 && Math.floor(score / 13 ** 4) % 13 === 12 ? '로열 플러시' : HAND_NAMES[cat];
}

// 7장 중 최고의 5장 (쇼다운 하이라이트용)
function best5(cs) {
  let best = null;
  for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) {
    const five = cs.filter((_, i) => i !== a && i !== b), s = evaluate(five);
    if (!best || s > best.score) best = { score: s, cards: five };
  }
  return best;
}

// ===== 프리플랍 손패 순위: 169가지 손패를 실제 선수들이 레인지에 넣는 순서대로 (강한 것부터) =====
// 직접 정리한 순서. 위에서부터 조합 수(페어 6 · 수딧 4 · 오프수트 12)를 쌓아 x%가 되는 데까지가 '상위 x% 레인지'
// (UTG 16%는 88+·A9s+·A5s-A4s·KTs+·QTs+·JTs·ATo+·KQo, 버튼 44%는 22+·수딧 에이스 전부·수딧 커넥터·A8o+ … 까지)
const HAND_ORDER = `AA KK QQ AKs JJ AKo TT AQs KQs AJs AQo 99 ATs KJs QJs AJo KQo 88 KTs JTs QTs A5s A9s A4s 77 ATo
  K9s T9s A8s A3s KJo 66 A7s Q9s J9s A2s A6s 98s QJo 55 KTo 87s K8s T8s 44 K7s 76s A9o JTo 97s Q8s K6s 33 65s QTo
  K5s J8s 86s 22 A8o 54s K4s T7s 75s Q7s 96s K3s A5o Q6s 64s K2s A7o K9o Q5s J7s 53s 85s T9o A4o Q4s 74s J9o
  A6o 43s Q3s 95s 63s A3o Q9o J6s T6s Q2s 98o J5s 84s K8o A2o J4s 52s 73s T8o 87o J3s 42s K7o J2s 62s 94s T5s Q8o
  97o 76o 32s T4s 93s K6o J8o T3s 83s 65o K5o 92s T2s 82s 86o Q7o 72s 54o K4o T7o 75o J7o K3o 96o Q6o 64o K2o 53o
  Q5o 85o J6o T6o 43o Q4o 74o 95o J5o 63o Q3o 84o J4o 52o T5o Q2o 73o J3o 42o 94o T4o J2o 62o 93o T3o 32o 83o 92o T2o 82o 72o`.split(/\s+/);
const handClass = (a, b) => { const r1 = Math.max(a >> 2, b >> 2), r2 = Math.min(a >> 2, b >> 2); return RANKS[r1] + RANKS[r2] + (r1 === r2 ? '' : (a & 3) === (b & 3) ? 's' : 'o'); };
const TOP = (() => { const t = {}; let n = 0; for (const h of HAND_ORDER) { n += h.length === 2 ? 6 : h[2] === 's' ? 4 : 12; t[h] = n / 1326; } return t; })(); // 이 손패까지 넣은 레인지가 전체의 몇 %
const topOf = hole => TOP[handClass(hole[0], hole[1])]; // 작을수록 강함 (AA 0.5%, 72o 100%)
// [카드a, 카드b, 값] 목록 → 핸드별 백분위 표 (동점은 같은 백분위)
function percentiles(l) {
  const out = new Float32Array(52 * 52);
  l.sort((x, y) => x[2] - y[2]);
  let first = 0;
  l.forEach(([a, b, v], i) => { if (i && v !== l[i - 1][2]) first = i; out[a * 52 + b] = out[b * 52 + a] = first / l.length; });
  return out;
}
// 프리플랍 백분위 (0 = 최약, 1 = 최강) = 나보다 약한 조합의 비율. 상대 레인지를 좁힐 때도 이 순서를 쓴다
const PCT = (() => { const out = new Float32Array(52 * 52); for (let a = 0; a < 52; a++) for (let b = 0; b < a; b++) out[a * 52 + b] = out[b * 52 + a] = 1 - TOP[handClass(a, b)]; return out; })();
// 상대 레인지 강도표: 프리플랍은 손패 순위, 플랍부터는 보드 위 현재 족보(65%) + 프리플랍(35%)을 섞어 다시 백분위로
// ponytail: 드로우는 족보로 안 잡혀서 과소평가된다. 더 정교하게 하려면 아웃츠 가중치를 더할 것
function strengthMap(board, dead) {
  if (!board.length) return PCT;
  const l = [];
  for (let a = 0; a < 52; a++) for (let b = 0; b < a; b++) if (!dead.has(a) && !dead.has(b)) l.push([a, b, evaluate([a, b, ...board])]);
  const made = percentiles(l);
  return percentiles(l.map(([a, b]) => [a, b, 0.65 * made[a * 52 + b] + 0.35 * PCT[a * 52 + b]]));
}
// 상대 레인지 컷: 팟 크기 레이즈(공격 강도 1) 한 번이면 "상대가 레이즈하는 빈도(rr)"만큼의 상위 핸드로 좁힌다.
// 아무 패로나 레이즈하는 상대(rr≈1)는 거의 안 좁히고, 골라서 레이즈하는 상대는 크게 좁힌다. 상위 10%보다는 안 좁힌다
const rangeCut = (aggro, rr) => Math.min(0.9, 1 - rr ** aggro);

// 몬테카를로 승률: 상대마다 각자 레인지(강도표에서 cuts[k] 이상)에서 패를 뽑고, 남은 보드는 무작위로. 동점은 나눠 가진다
// 거절 표본추출은 상대별로 따로 (한꺼번에 거절하면 상대가 많을 때 통과율이 곱으로 줄어든다)
function equity(hole, board, cuts, map = PCT, iters = ITERS) {
  const dead = new Set([...hole, ...board]), d = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) d.push(c);
  const n = d.length, need = 5 - board.length, me = [...hole, ...board], opp = cuts.map(() => [0, 0, ...board]);
  const rnd = k => Math.floor(Math.random() * k);
  const swap = (i, j) => { const t = d[i]; d[i] = d[j]; d[j] = t; };
  let won = 0;
  for (let it = 0; it < iters; it++) {
    let pos = 0;
    for (let k = 0; k < cuts.length; k++, pos += 2) {
      let tries = 0;
      do { swap(pos, pos + rnd(n - pos)); swap(pos + 1, pos + 1 + rnd(n - pos - 1)); }
      while (cuts[k] > 0 && map[d[pos] * 52 + d[pos + 1]] < cuts[k] && ++tries < 60);
      opp[k][0] = d[pos]; opp[k][1] = d[pos + 1];
    }
    for (let j = 0; j < need; j++) swap(pos + j, pos + j + rnd(n - pos - j));
    const run = d.slice(pos, pos + need), mine = evaluate(me.concat(run));
    let ties = 0, lost = false;
    for (const o of opp) { const s = evaluate(o.concat(run)); if (s > mine) { lost = true; break; } if (s === mine) ties++; }
    if (!lost) won += 1 / (ties + 1);
  }
  return won / iters;
}

// ===== 게임 상태 =====
let G, H;
// opts: names[], styles[], stacks[]
function newGame(o) {
  const n = o.stacks.length;
  // stats: 베팅을 마주한 횟수, 폴드 횟수, 그때마다의 MDF(최소 방어 빈도) 합, 레이즈할 수 있었던 횟수, 실제 레이즈 횟수
  G = { n, names: o.names, styles: o.styles, game: o.game, stacks: o.stacks.slice(), out: Array(n).fill(false), place: Array(n).fill(null), // game: 'badugi'면 바둑이, 없으면 홀덤
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
  const n = G.n, bd = G.game === 'badugi', [sb, bb] = LEVELS[Math.min(G.level, LEVELS.length - 1)], d = mix([...Array(52).keys()]);
  const z = () => Array(n).fill(0);
  H = { deck: d, hole: Array.from({ length: n }, () => []), board: [], bets: z(), committed: z(), aggro: z(),
        folded: G.out.slice(), acted: Array(n).fill(false), canRaise: Array(n).fill(true),
        lastRaise: bb, raises: 0, raiser: -1, opener: -1, lastAggr: -1, sb, bb, start: G.stacks.slice(), result: null, decision: null, busted: [] };
  for (let r = 0; r < (bd ? 4 : 2); r++) for (let k = 1; k <= n; k++) { const i = (G.button + k) % n; if (!G.out[i]) H.hole[i].push(d.pop()); } // 버튼 왼쪽부터 한 장씩
  if (bd) { // 바둑이: 블라인드 대신 모두 앤티. 앤티는 팟에만 들어가고 이번 라운드 베팅(bets)에는 안 들어가서 첫 라운드부터 체크할 수 있다
    const ante = anteOf(G.level);
    Object.assign(H, { ante, sb: 0, bb: ante, lastRaise: ante, draws: 0, drawing: false, drew: Array(n).fill(null), muck: [] });
    for (const i of alive()) { const x = Math.min(ante, G.stacks[i]); G.stacks[i] -= x; H.committed[i] += x; }
    H.toAct = nextOf(G.button, needsAction); // 베팅도 교환도 버튼 다음 사람부터
    return;
  }
  // 헤즈업(2명)이면 버튼이 스몰 블라인드, 아니면 버튼 다음이 SB, 그다음이 BB
  H.sbSeat = alive().length === 2 ? G.button : nextOf(G.button, i => !G.out[i]);
  H.bbSeat = nextOf(H.sbSeat, i => !G.out[i]);
  put(H.sbSeat, sb); put(H.bbSeat, bb);
  H.toAct = nextOf(H.bbSeat, needsAction); // 프리플랍은 BB 다음 사람부터 (헤즈업이면 버튼=SB)
}
function legal(p) {
  const mb = maxBet(), owe = mb - H.bets[p];
  const cap = Math.max(0, ...live().filter(i => i !== p).map(i => H.bets[i] + G.stacks[i])); // 아무도 못 받는 만큼은 의미 없음
  let maxTo = Math.min(H.bets[p] + G.stacks[p], cap);
  if (G.game === 'badugi') maxTo = Math.min(maxTo, mb + sum(H.committed) + owe); // 팟 리밋: 콜한 뒤의 팟만큼까지 올릴 수 있다
  return { toCall: Math.min(owe, G.stacks[p]), canCheck: owe === 0, canRaise: H.canRaise[p] && maxTo > mb,
           minTo: Math.min(mb + H.lastRaise, maxTo), maxTo };
}
function act(p, type, to) {
  const mb = maxBet(), owe = mb - H.bets[p], before = G.stacks[p], st = G.stats[p], L = legal(p);
  if (owe > 0) { const P = sum(H.committed); st.faced++; st.mdf += (P - owe) / P; }
  if (L.canRaise) { st.chances++; if (type === 'raise') st.raises++; }
  let label;
  if (type === 'raise' && !L.canRaise) type = 'call'; // 레이즈할 수 없으면 콜로 처리
  if (type === 'fold') { st.folded++; H.folded[p] = true; label = G.game === 'badugi' ? '다이' : '폴드'; }
  else if (type === 'raise') {
    const names = G.game === 'badugi' ? badugiBets(p) : {}; // 금액이 버튼과 같으면 그 이름으로 부른다 (삥·따당·쿼터·하프·풀)
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
  if (G.game !== 'badugi') { const k = H.board.length ? 1 : 3; for (let i = 0; i < k; i++) H.board.push(H.deck.pop()); } // 바둑이는 보드가 없다 (베팅 라운드만 새로 연다)
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
  const score = lv.length > 1 ? Object.fromEntries(lv.map(i => [i, G.game === 'badugi' ? badugi(H.hole[i]).score : evaluate([...H.hole[i], ...H.board])])) : null;
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
// 한 단계 진행: 'act'(H.toAct 차례) | 'deal'(카드 깔림, 바둑이는 새 베팅 라운드) | 'draw'(바둑이: H.toAct가 카드를 바꿀 차례) | 'end'(정산 완료)
function step() {
  const many = live().length > 1;
  if (many && !H.drawing && !roundOver()) { if (!needsAction(H.toAct)) H.toAct = nextOf(Math.max(0, H.toAct), needsAction); return 'act'; }
  if (many && G.game === 'badugi') { if (H.drawing || H.draws < 3) return drawStep(); }
  else if (many && H.board.length < 5) { nextStreet(); return 'deal'; }
  settle(); return 'end';
}

// ===== 바둑이 (G.game === 'badugi'): 4장, 아침·점심·저녁 세 번 교환, 무늬·숫자가 모두 다른 낮은 패가 이긴다 =====
// 앤티: 방장이 정한 시작 앤티(G.ante0)가 있으면 레벨표의 배율로 오르거나(anteUp) 고정, 없으면 레벨표의 스몰 블라인드 (100 → 200 → 300 …)
const anteOf = l => { const sb = LEVELS[Math.min(l, LEVELS.length - 1)][0]; return !G.ante0 ? sb : G.anteUp === false ? G.ante0 : sb * G.ante0 / 100; };
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
// 승률: 상대 패는 직전 교환에서 바꾼 장수에 맞게 뽑고(패스 → 메이드, 1장 → 3장 조합 이상, 2장 → 2장 이상),
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
      const tries = need(q) >= 4 * 14 ** 4 ? 200 : 40; // 패스한 상대(메이드)는 무작위 4장 중 6%뿐이라 더 뽑는다
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
  return out.length ? `${out.length}장` : '패스';
}

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
// ===== 프리플랍 표: 실제 선수처럼 자리와 앞의 액션에 따라 레인지로 정한다 (손패 순위 HAND_ORDER의 위에서 몇 %) =====
// 자리별 오픈 폭 (뒤에 남은 사람 수 → 상위 %): 1 = SB, 2 = 버튼, 3 = 컷오프, 4 = 하이잭, 5 = 로잭(6인 UTG) … 8 = 9인 UTG. 헤즈업 버튼(SB)은 80%
const OPEN_WIDTH = [0, 0.4, 0.44, 0.27, 0.2, 0.16, 0.14, 0.12, 0.1];
// 3벳 블러프로 쓰는 손패 (블로커·플레이어빌리티가 좋은 것)
const BLUFF3 = new Set('A5s A4s A3s A2s K9s K8s Q9s J9s T8s 97s 86s 75s 65s 54s A9s A8s KTs QTs'.split(' '));
// 이 핸드에 앉은 사람 중 q 뒤에 행동하는 사람 수 (BB 0, SB 1, 버튼 2, 컷오프 3 …). 헤즈업 버튼(SB)은 1
function seatsBehind(q) { let n = 0; for (let i = q; i !== H.bbSeat && n < G.n; n++) i = nextOf(i, j => !G.out[j]); return n; }
function preflopPlan(p, L, S, opts) {
  if (H.board.length || H.raises == null) return null; // 예전 상태(진행 중이던 서버 게임)는 EV 계산으로
  const bb = H.bb, mb = maxBet(), hu = alive().length === 2, me = seatsBehind(p);
  if (G.stacks[p] + H.bets[p] < 20 * bb) return null; // 짧은 스택은 올인까지 따지는 EV 계산으로
  const raises = opts.filter(x => x.type === 'raise'), allIn = raises.find(x => x.to === L.maxTo);
  const size = t => !raises.length ? null : t >= 0.4 * (G.stacks[p] + H.bets[p]) && allIn ? allIn : raises.reduce((a, b) => Math.abs(b.to - t) < Math.abs(a.to - t) ? b : a); // 스택의 40% 넘게 걸 거면 올인
  const fold = opts.find(x => x.type === 'fold'), call = opts.find(x => x.type === 'call' || x.type === 'check');
  const cls = handClass(H.hole[p][0], H.hole[p][1]), top = TOP[cls], r = Math.random();
  const widthOf = q => hu ? 0.8 : OPEN_WIDTH[Math.min(seatsBehind(q), 8)]; // 그 사람이 여는 폭 (표대로)
  // 표는 보통 상대를 가정한다. 아무 패로나 올리는 게 보이는 상대(관찰 10번 이상, 레이즈 50% 넘음)에게는 표 대신 EV 계산으로 (레인지를 덜 좁혀 더 받는다)
  if (H.raises > 0 && G.stats[H.raiser].chances >= 10 && G.stats[H.raiser].raises / G.stats[H.raiser].chances > 0.5) return null;
  const loose = S.callw, tb = S.threeb; // 콜하는 폭 (콜링은 훨씬 넓게, 바위는 좁게) / 3벳·4벳 (공격형은 넓게, 콜링은 거의 안 함)
  const raiseOr = (pick, tag) => pick ? { pick, tag } : { pick: call, tag: '콜' };
  if (H.raises === 0) { // 아무도 안 올림
    const limpers = live().filter(q => q !== p && H.acted[q]).length;
    if (H.bets[p] === mb) return top <= 0.1 * (S.open ?? 1) && raises.length ? { pick: size((3.5 + limpers) * bb), tag: '아이소 레이즈' } : { pick: call, tag: '체크' }; // BB (림프한 사람만 있음)
    const width = Math.min(0.9, (hu ? 0.8 : OPEN_WIDTH[Math.min(me, 8)]) * (S.open ?? 1) * 0.7 ** limpers); // 림프한 사람이 있으면 더 좁게
    if (top <= width && raises.length) return { pick: size((limpers ? 3.5 + limpers : 2.5) * bb), tag: limpers ? '아이소 레이즈' : '오픈' };
    if (top <= width * (1 + (S.limp ?? 0))) return { pick: call, tag: '림프' };
    return { pick: fold, tag: '오픈 레인지 밖' };
  }
  if (H.raises === 1) { // 누가 열었다 → 3벳 / 콜 / 폴드
    if (mb > 6 * bb || L.toCall > 0.3 * G.stacks[p]) return null; // 이상하게 큰 오픈(예: 프리플랍 올인)은 EV 계산으로
    const w = widthOf(H.raiser), callers = live().filter(q => q !== p && q !== H.raiser && H.bets[q] === mb).length;
    const value = Math.min(0.14, Math.max(0.006, Math.min(0.08, Math.max(0.025, w * 0.2)) * tb)); // 밸류 3벳: 상대가 여는 폭의 1/5 (QQ+·AK ~ 99+·AJs+·KQs), 성격 배율
    let D = me === 0 ? Math.min(hu ? 0.7 : 0.62, 0.1 + 1.05 * w) : me === 1 ? w * 0.3 : Math.min(0.22, Math.max(0.05, w * 0.55)); // BB는 넓게 막고, SB는 3벳 아니면 거의 폴드, 나머지는 좁게 콜
    D = Math.min(0.85, D * loose * (callers ? 0.7 : 1));
    const three = size((me <= 1 ? 3.7 : 3) * mb + callers * mb); // 밖(IP)이면 3배, 블라인드면 3.7배, 먼저 콜한 사람 1명당 +1배
    if (top <= value) return raiseOr(three, callers ? '스퀴즈' : '3벳');
    if (BLUFF3.has(cls) && r < (w >= 0.25 ? 0.45 : 0.2) * tb * (callers ? 0.3 : 1)) return raiseOr(three, '3벳 블러프');
    if (top <= D) return { pick: call, tag: me === 0 ? 'BB 방어' : '콜' };
    return { pick: fold, tag: '레인지 밖' };
  }
  if (mb > 40 * bb) return null; // 아주 큰 레이즈는 EV 계산으로
  if (H.raises === 2) { // 3벳을 받았다 → 4벳 / 콜 / 폴드
    const late = s => s === 1 ? 0 : s === 0 ? 1 : 100 - s; // 플랍부터 행동 순서 (SB → BB → 앞자리 → 버튼)
    const opened = H.opener === p, ip = hu ? p === G.button : late(me) > late(seatsBehind(H.raiser)); // 3벳한 사람보다 나중에 행동하면 IP
    const four = size((ip ? 2.3 : 2.6) * mb);
    if (top <= 0.017 * tb || (cls === 'AKo' && r < 0.5 * Math.min(1.5, tb))) return raiseOr(four, '4벳'); // QQ+·AKs, AKo는 반반 (공격형은 더 넓게, 콜링은 AA 정도만)
    if (opened && (cls === 'A5s' || cls === 'A4s') && r < 0.3 * tb) return raiseOr(four, '4벳 블러프');
    if (top <= (opened ? Math.min(0.12, widthOf(p) * 0.45) : 0.05) * loose) return { pick: call, tag: '콜' }; // 연 사람은 여는 폭의 45%까지, 아니면 아주 좁게
    return { pick: fold, tag: '레인지 밖' };
  }
  // 4벳 이상: AA·KK는 올인, QQ·AK·JJ는 콜, 나머지 폴드
  if (top <= 0.0091) return raiseOr(allIn ?? size(3 * mb), '올인');
  if (top <= 0.031) return { pick: call, tag: '콜' };
  return { pick: fold, tag: '레인지 밖' };
}
// ===== 플랍 이후: 사람처럼 손패 종류(강함·드로우·중간·공기)·보드·주도권·자리로 라인을 정한다 =====
// 체크할 수 있을 때는 이 계획대로 (씨벳·배럴·밸류·세미 블러프·팟 컨트롤·포기, 크기도 보드에 맞게). 베팅을 받았을 때는 EV 계산 + 최소 방어에 맡기고 레이즈만 섞는다
const catOf = cs => Math.floor(evaluate(cs) / 13 ** 5);
function outsOf(hole, board) { // 다음 한 장으로 스트레이트 이상이 되는 카드 수 (보드만으로 되는 건 빼고). 8장 이상 = 플러시·양방 드로우
  if (board.length >= 5 || catOf([...hole, ...board]) >= 4) return 0;
  const dead = new Set([...hole, ...board]);
  let n = 0;
  for (let c = 0; c < 52; c++) if (!dead.has(c) && catOf([...hole, ...board, c]) >= 4 && catOf([...board, c]) < 4) n++;
  return n;
}
function wetBoard(board) { // 플러시·스트레이트가 되기 쉬운 보드 (같은 무늬 2장+, 또는 4칸 안에 3장이 몰림)
  const suits = [0, 0, 0, 0]; board.forEach(c => suits[c & 3]++);
  if (Math.max(...suits) >= 2) return true;
  const rs = [...new Set(board.map(c => c >> 2))]; if (rs.includes(12)) rs.push(-1);
  return rs.some(a => rs.filter(b => b >= a && b <= a + 4).length >= 3);
}
function postflopPlan(p, L, S, opts, eq, opps, foldRate) {
  if (!H.board.length || H.lastAggr === undefined) return null; // 예전 상태(진행 중이던 서버 게임)는 EV 계산으로
  const street = H.board.length, pot = sum(H.committed), n = opps.length, mb = maxBet(), r = Math.random();
  const order = []; for (let k = 1; k <= G.n; k++) { const i = (G.button + k) % G.n; if (!H.folded[i] && G.stacks[i] > 0) order.push(i); }
  const ip = order[order.length - 1] === p, init = H.lastAggr === p; // 자리: 마지막에 행동 / 주도권: 마지막으로 베팅·레이즈한 사람 (프리플랍 레이저)
  const outs = outsOf(H.hole[p], H.board), draw = outs >= 8, wet = wetBoard(H.board);
  const bets = opts.filter(x => x.type === 'raise');
  const near = t => bets.length ? bets.reduce((a, b) => Math.abs(b.to - t) < Math.abs(a.to - t) ? b : a) : null;
  // 거의 안 접는 상대: 블러프·세미 블러프는 줄이고, 밸류는 더 얇게(중간 패도) 크기는 EV가 가장 큰 쪽으로 (많이 받아 주니까)
  const sticky = foldRate < 0.25, bestBet = bets.reduce((a, b) => b.ev > a.ev ? b : a, bets[0]);
  const A = Math.min(1.5, Math.max(0.1, foldRate / 0.4)); // 상대가 잘 접으면 블러프를 더, 안 접으면 덜
  const bet = f => sticky ? bestBet : near(mb + Math.min(1, f * S.size) * pot), check = opts.find(x => x.type === 'check'); // 크기도 성격대로 (공격형 크게, 콜링 작게)
  if (L.canCheck) {
    if (!bets.length) return null;
    const aggrLive = H.lastAggr >= 0 && H.lastAggr !== p && !H.folded[H.lastAggr];
    if (eq >= (sticky ? Math.min(0.6, S.vthr) : S.vthr)) { // 강함: 밸류 베팅 (기준은 성격대로: 공격형 낮게, 바위·콜링 높게) (마른 보드 1/3, 젖은 보드 2/3, 리버 3/4). 주도권 없는 OOP면 레이저에게 체크해 체크레이즈를 노리기도
      if (!init && !ip && aggrLive && r < 0.6) return { pick: check, tag: '체크레이즈 노림' };
      if (!wet && street < 5 && r < S.slow) return { pick: check, tag: '슬로플레이' };
      return { pick: bet(street === 5 ? 0.75 : wet ? 0.66 : 0.33), tag: '밸류 베팅' };
    }
    if (draw) return (init && r < (sticky ? 0.35 : 1) * Math.min(1, S.cbet)) || (ip && r < 0.5 * A * S.cbet) ? { pick: near(mb + Math.min(1, (wet ? 0.66 : 0.5) * S.size) * pot), tag: '세미 블러프' } : { pick: check, tag: '체크' }; // 드로우
    if (eq >= 0.45) { // 중간: 플랍 헤즈업에서 주도권이 있으면 작게 씨벳(얇은 밸류·보호), 리버 IP면 가끔 얇게, 아니면 팟 컨트롤
      if (init && street === 3 && n === 1 && r < (sticky ? 0.3 : 0.65) * S.cbet) return { pick: near(mb + Math.min(1, 0.33 * S.size) * pot), tag: '씨벳' };
      if (street === 5 && ip && eq >= 0.6 && r < 0.5 * S.cbet) return { pick: bet(0.5), tag: '씬 밸류' };
      return { pick: check, tag: '팟 컨트롤' };
    }
    // 약함·공기: 주도권이 있으면 씨벳/배럴 블러프 (마른 보드·헤즈업일수록 더), 리버는 놓친 드로우로 블러프. 없으면 IP에서 가끔 찔러보기
    const busted = street === 5 && outsOf(H.hole[p], H.board.slice(0, 4)) >= 8;
    if (init) {
      const freq = street === 3 ? (wet ? 0.45 : 0.65) : street === 4 ? 0.3 : busted ? 0.55 : 0.12;
      if (r < freq * A * (street === 3 ? S.cbet : S.barrel) / n) return { pick: near(mb + Math.min(1, (street === 3 ? (wet ? 0.5 : 0.33) : 0.66) * S.size) * pot), tag: street === 3 ? '씨벳' : street === 4 ? '배럴' : '블러프' };
      return { pick: check, tag: '포기' };
    }
    if (ip && r < (busted ? 0.4 : 0.25) * A * S.cbet / n) return { pick: near(mb + Math.min(1, 0.5 * S.size) * pot), tag: '찔러보기' };
    return { pick: check, tag: '체크' };
  }
  // 베팅을 받음: 아주 강하면 레이즈를 섞고(젖은 보드면 더), 드로우는 가끔 세미 블러프 레이즈 (베팅의 3배쯤). 나머지는 EV 계산 + 최소 방어
  if (L.canRaise && bets.length) {
    if (eq >= 0.8 && r < (wet ? 0.45 : 0.25) * S.raiseF) return { pick: near(3 * mb), tag: '레이즈 (밸류)' };
    if (draw && r < 0.15 * A * S.raiseF / n) return { pick: near(3 * mb), tag: '세미 블러프 레이즈' };
  }
  return null;
}
// ponytail: EV는 이번 베팅 라운드만 본다(이후 스트리트의 임플라이드 오즈 무시). 칩 EV = 승자독식 토너먼트의 우승 확률에 비례한다고 본다(ICM 미적용)
function decide(p) {
  if (G.game === 'badugi') return decideBadugi(p);
  // G.styles[p]: 페르소나(수치 묶음) 또는 성격 이름
  const s0 = G.styles[p], S = styleOf(typeof s0 === 'object' && s0 ? s0 : STYLES[s0] || STYLES.pro), L = legal(p), mb = maxBet(), opps = live().filter(i => i !== p);
  const myAfter = H.committed[p] + L.toCall;
  const potCall = H.committed.reduce((s, c, i) => s + Math.min(i === p ? myAfter : c, myAfter), 0); // 콜하면 내가 이길 수 있는 팟
  const potAll = sum(H.committed); // 모두 접으면 내가 가져가는 칩
  const map = strengthMap(H.board, new Set([...H.hole[p], ...H.board]));
  // 상대마다 성향을 학습 (사전값에서 시작해 관찰로 갱신). rr: 레이즈 빈도(사전값 75%) / 방어: 1 = MDF만큼 콜
  const rrOf = q => (G.stats[q].raises + 3) / (G.stats[q].chances + 4);
  const defOf = q => (G.stats[q].faced - G.stats[q].folded + 2) / (G.stats[q].mdf + 2) * S.defend;
  const cuts = opps.map(q => rangeCut(H.aggro[q], rrOf(q)));
  const it = Math.max(400, Math.round(ITERS * 2 / (opps.length + 1)));
  const eq = equity(H.hole[p], H.board, cuts, map, it);
  // 에퀴티 실현율: 뒤에 스트리트가 남으면 약한 패는 상대 베팅에 접게 돼 승률을 다 못 챙기고, 강한 패는 더 뽑아낸다 (올인이면 그대로)
  const later = H.board.length < 5;
  const realize = (e, allIn) => later && !allIn ? e * Math.min(1.1, Math.max(0.6, 0.85 + (e - 0.5) + S.realize)) : e;
  const opts = [];
  if (!L.canCheck) opts.push({ type: 'fold', label: '폴드', ev: 0 });
  opts.push({ type: L.canCheck ? 'check' : 'call', label: L.canCheck ? '체크' : '콜', to: H.bets[p] + L.toCall,
              ev: realize(eq, L.toCall >= G.stacks[p] || opps.every(q => !G.stacks[q])) * potCall - L.toCall });
  let sims = it;
  if (L.canRaise) {
    const seen = new Set(), verb = mb ? '레이즈' : '베팅';
    for (const [x, name] of H.board.length ? [[1 / 3, '1/3팟'], [2 / 3, '2/3팟'], [1, '팟'], [Infinity, '올인']] : [[0.5, '1/2팟'], [1, '팟'], [Infinity, '올인']]) { // 플랍부터는 1/3·2/3도
      const to = Math.max(L.minTo, Math.min(L.maxTo, Math.round((mb + x * potCall) / CHIP) * CHIP));
      const risk = to - H.bets[p], P = potAll + risk;
      // 올인은 상대가 낼 돈이 팟의 3배 이하일 때만 (스택이 깊을 때 과도한 오버벳 올인 방지)
      if (seen.has(to) || (to === L.maxTo && to - mb > 3 * potCall)) continue;
      seen.add(to);
      // 상대마다: 크게 걸수록 더 많이 접지만, 콜해 오는 건 레인지 상위 (1-f)뿐. 올인한 상대는 접을 수 없다
      let fAll = 1, reRaisers = 0, expCall = 0;
      const fq = opps.map(q => {
        if (!G.stacks[q]) { fAll = 0; return 0; }
        const call = Math.min(to - H.bets[q], G.stacks[q]), f = Math.min(0.9, Math.max(0, 1 - defOf(q) * (P - call) / P));
        fAll *= f; expCall += (1 - f) * call; if (G.stacks[q] > call) reRaisers++;
        return f;
      });
      const qr = Math.min(1 - fAll, 1 - 0.9 ** reRaisers); // 누군가 다시 레이즈하면 접고 건 돈을 잃는다
      const eqC = equity(H.hole[p], H.board, cuts.map((c, k) => c + (1 - c) * fq[k]), map, it); sims += it;
      const potCalled = P + (fAll < 1 ? expCall / (1 - fAll) : 0);
      opts.push({ type: 'raise', label: to === L.maxTo ? '올인' : `${verb} ${name}`, to, f: fAll, eqC,
                  ev: fAll * potAll + (1 - fAll - qr) * (realize(eqC, to === L.maxTo) * potCalled - risk) - qr * risk + S.press * potCall });
    }
  }
  // 위험 보정: EV 차이가 작으면 콜당했을 때 잃을 칩이 적은 쪽을 고른다
  const riskAdj = x => x.ev - S.risk * (x.type === 'raise' ? (1 - x.f) * (x.to - H.bets[p]) : x.type === 'call' ? L.toCall : 0);
  // 블러프 빈도: 상대가 잘 접으면 더, 절대 안 접으면 덜 (관찰한 폴드율, 사전값 40%). 상대가 여럿이면 나눠서 줄인다
  const foldRate = sum(opps.map(q => (G.stats[q].folded + 2) / (G.stats[q].faced + 5))) / opps.length;
  const bluffP = S.bluff * Math.min(1.5, Math.max(0.1, foldRate / 0.4)) / opps.length;
  const plan = preflopPlan(p, L, S, opts) ?? postflopPlan(p, L, S, opts, eq, opps, foldRate);
  let pick = plan ? plan.pick : opts.reduce((a, b) => riskAdj(b) > riskAdj(a) ? b : a);
  let tag = plan ? plan.tag : pick === opts.reduce((a, b) => b.ev > a.ev ? b : a) ? '' : '리스크 회피';
  const r = Math.random(), raise1 = opts.find(x => x.type === 'raise'); // 가장 작은 레이즈 (블러프는 작게)
  if (plan) { /* 프리플랍은 표대로, 플랍부터는 계획대로 */ }
  else if (pick.type === 'raise' && eq > 0.8 && later && r < S.slow) {
    pick = opts.find(x => x.type === 'check' || x.type === 'call'); tag = '슬로플레이';
  } else if (pick.type === 'check' && raise1 && eq < 0.4 && r < bluffP) {
    pick = raise1; tag = '블러프';
  } else if (pick.type === 'fold') {
    if (raise1 && eq < 0.3 && r < bluffP * 0.25) { pick = raise1; tag = '블러프'; } // 가끔은 받아서 되레 올린다
    else {
      // 최소 방어: 베팅에 너무 잘 접으면 아무 패로나 레이즈하는 상대에게 당한다. 이 크기의 베팅이 블러프로 이득을 못 보게 할 만큼은
      // 버틴다 → 내 패가 (이 보드에서 가능한 모든 패 중) 위쪽 그 비율 안이면 콜. 상대가 여럿이면 나눠서 막는다. 콜링은 더, 바위는 덜 버틴다.
      // 거의 안 올리는 상대(올리면 진짜)에게는 덜 버틴다: 레이즈 빈도 50% 이상이면 다, 그 아래면 비례해서
      const bettor = opps.find(q => H.bets[q] === mb) ?? opps[0], loose = Math.min(1, rrOf(bettor) / 0.5);
      // MDF = 베팅 전 팟 / (팟 + 베팅). 프리플랍은 약한 패도 승률 30% 안팎이라 좀 더 (팟 오즈까지, MDF의 1.6배까지: 3배 오픈엔 약 2/3, 올인엔 거의 안 버팀)
      const base = (potAll - L.toCall) / potAll, mdf = H.board.length ? base : Math.min(1 - L.toCall / (potAll + L.toCall), 1.6 * base);
      // 플랍부터는 0.8배: 내 패의 순위를 '가능한 모든 패' 중에서 재니, 실제 내 레인지보다 넓게 잡혀 너무 버티게 된다
      const maniac = G.stats[bettor].chances >= 10 && G.stats[bettor].raises / G.stats[bettor].chances > 0.5; // 아무 패로나 올리는 게 보이는 상대
      const share = (1 - (1 - mdf) ** (1 / opps.length)) * loose * (H.board.length && !maniac ? 0.8 : 1); // 그런 상대에게는 줄이지 않는다
      const top = H.board.length ? 1 - strengthMap(H.board, new Set(H.board))[H.hole[p][0] * 52 + H.hole[p][1]] : topOf(H.hole[p]); // 내 패가 위에서 몇 %
      if (top <= Math.min(0.95, share * S.stick)) { pick = opts.find(x => x.type === 'call'); tag = '방어'; } // 콜링은 훨씬 더, 바위는 덜 버틴다
    }
  }
  const avg = a => a.length ? sum(a) / a.length : 0, seenQ = opps.filter(q => G.stats[q].faced);
  return { type: pick.type, to: pick.to, info: { who: p, eq, opts, pick, tag, iters: sims, street: H.board.length, opps: opps.length,
    cut: avg(cuts), rr: avg(opps.map(rrOf)), foldSeen: seenQ.length ? avg(seenQ.map(q => G.stats[q].folded / G.stats[q].faced)) : null,
    potOdds: L.toCall / (potCall || 1) } };
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
    ['휠 스트레이트', () => cat('As 2d 3c 4h 5s 9d Kc') === 4],
    ['6 하이 > 휠', () => E('2d 3c 4h 5s 6d Kc Qh') > E('As 2d 3c 4h 5s 9d Kc')],
    ['브로드웨이 > K 하이 스트레이트', () => E('As Kd Qc Jh Ts 2d 3c') > E('Ks Qd Jc Th 9s 2d 3c')],
    ['플러시 > 스트레이트', () => E('2h 7h 9h Jh Kh 3c 4d') > E('5s 6d 7c 8h 9s 2d Kc')],
    ['풀하우스는 트리플이 결정', () => E('Ks Kd Kc 2h 2s 5d 7c') > E('Qs Qd Qc Ah As 5d 7c')],
    ['트리플 두 개 → 풀하우스', () => cat('7s 7d 7c 5h 5s 5d Ac') === 6 && E('7s 7d 7c 5h 5s 5d Ac') === E('7h 7d 7c 5h 5s Kd Ac')],
    ['투페어 키커', () => E('As Ad Ks Kd Qc 2h 3s') > E('As Ad Ks Kd Jc 2h 3s')],
    ['페어 세 개 → 상위 둘 + 키커', () => E('As Ad Ks Kd Qc Qh 2s') === E('As Ad Ks Kd Qc 3h 2s')],
    ['보드 스트레이트는 찹', () => E('2c 3d As Kd Qc Jh Ts') === E('4c 5d As Kd Qc Jh Ts')],
    ['스트레이트 플러시 > 포카드', () => E('5h 6h 7h 8h 9h 9s 9d') > E('As Ad Ac Ah Kd 2s 3c')],
    ['6장 플러시는 상위 5장', () => E('Ah Kh 9h 7h 4h 2h 3c') === E('Ah Kh 9h 7h 4h 3h 3c')],
    ['포카드 키커', () => E('9s 9d 9c 9h As 2d 3c') > E('9s 9d 9c 9h Ks Qd Jc')],
    ['로열 플러시 이름', () => handName(E('As Ks Qs Js Ts 2d 3c')) === '로열 플러시'],
    ['best5 = 7장 평가', () => { const cs = 'Ks Kd Kc 2h 2s 5d 7c'.split(' ').map(card); return best5(cs).score === evaluate(cs); }],
    ['프리플랍 백분위', () => PCT[card('As') * 52 + card('Ah')] > 0.95 && PCT[card('7s') * 52 + card('2d')] < 0.1],
    ['손패 순위 169가지 · 100%', () => HAND_ORDER.length === 169 && new Set(HAND_ORDER).size === 169 && Math.abs(TOP['72o'] - 1) < 1e-9 && TOP.AA < TOP.KK && TOP['22'] < TOP['72o']],
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
          ok = ok && (p === 0 ? lab === '2장' && H.hole[p][0] === was[0] && H.hole[p][2] === was[2] && H.hole[p][1] !== was[1] && H.hole[p][3] !== was[3] : lab === '패스' && H.hole[p].join() === was.join()); }
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
    ['바둑이 AI 교환: 메이드는 패스, 겹친 카드는 바꾸고, 교환이 많이 남으면 높은 탑을 깬다', () => {
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
    ['승점: 헤즈업 1500이 1600을 이기면 +26 (K40)', () => eloDeltaByPlace(1500, [1600], 1, 40) === 26 && eloDeltaByPlace(1500, [1600], 2, 40) === -14],
    ['승점: 9인 3위(모두 1500) +10, 꼴찌 -20', () => eloDeltaByPlace(1500, Array(8).fill(1500), 3, 40) === 10 && eloDeltaByPlace(1500, Array(8).fill(1500), 9, 40) === -20],
    ['승점: 친구 셋 순위대로 +20 -8 -12', () => [0, 1, 2].map(i => eloDelta(i, [1500, 1600, 1400], [1, 2, 3], 40)).join() === '20,-8,-12'],
    ['승점: K는 20판까지 40, 그 뒤 24', () => eloK(0) === 40 && eloK(19) === 40 && eloK(20) === 24],
    ['칩 순서 순위: 칩이 같으면 같은 순위', () => JSON.stringify(placesByChips([0, 2, 5, 1], [20000, 30000, 20000, 0, 0, 5000])) === '{"0":2,"1":1,"2":2,"5":4}'],
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
