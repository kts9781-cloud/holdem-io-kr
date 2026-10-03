// 홀덤 규칙과 AI: 2장 + 보드 5장, 노리밋. engine.js 다음에 불러온다 (서버는 scripts/build-server-engine.sh가 이어 붙인다)
// 공통(상태·베팅·정산·리바인·레벨·AI 성격)은 engine.js, 여기는 홀덤에만 있는 것
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
function decideHoldem(p) {
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

GAMES.holdem = {
  id: 'holdem', name: '홀덤', seats: [2, 6, 9], ranked: true, holeCards: 2, minV: 1, // ranked: 승점·전적·AI 스타일 기억에 넣는다 / minV: 이 게임을 그릴 수 있는 화면 버전
  stakeName: '블라인드', minChipsX: 20, foldLabel: '폴드', // 시작 칩은 스몰 블라인드의 20배(빅의 10배) 이상
  stakeInput: '시작 블라인드(스몰)', chipsBase: '빅 블라인드', // 방 만들기 오류 문구: '○○는 100 단위로…', '시작 칩은 ○○의 10배 이상…'
  post(sb, bb) { // 헤즈업(2명)이면 버튼이 스몰 블라인드, 아니면 버튼 다음이 SB, 그다음이 BB
    H.sbSeat = alive().length === 2 ? G.button : nextOf(G.button, i => !G.out[i]);
    H.bbSeat = nextOf(H.sbSeat, i => !G.out[i]);
    put(H.sbSeat, sb); put(H.bbSeat, bb);
    H.toAct = nextOf(H.bbSeat, needsAction); // 프리플랍은 BB 다음 사람부터 (헤즈업이면 버튼=SB)
  },
  dealStreet() { const k = H.board.length ? 1 : 3; for (let i = 0; i < k; i++) H.board.push(H.deck.pop()); }, // 플랍 3장, 턴·리버 1장
  afterRound() { if (H.board.length < 5) { nextStreet(); return 'deal'; } return null; }, // 보드를 다 깔면 정산
  score: i => evaluate([...H.hole[i], ...H.board]),
  best: i => best5([...H.hole[i], ...H.board]), // 쇼다운 강조용 { score, cards }
  handName: b => handName(b.score),
  decide: p => decideHoldem(p),
  tests: () => {
    const E = s => evaluate(s.split(' ').map(card)), cat = s => Math.floor(E(s) / 13 ** 5);
    return [
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
      ['홀덤 방 블라인드: 방장이 정한 스몰 블라인드의 배율로 오르거나 고정 (빅은 2배)', () => {
        const saved = [G, H];
        newGame({ names: ['a', 'b', 'c'], styles: [null, null, null], stacks: [50000, 50000, 50000] }); Object.assign(G, { ante0: 500, anteUp: true, level: 1 }); newHand();
        const a = H.sb === 1000 && H.bb === 2000 && sum(H.bets) === 3000;
        newGame({ names: ['a', 'b', 'c'], styles: [null, null, null], stacks: [50000, 50000, 50000] }); Object.assign(G, { ante0: 500, anteUp: false, level: 5 }); newHand();
        const b = H.sb === 500 && H.bb === 1000;
        newGame({ names: ['a', 'b', 'c'], styles: [null, null, null], stacks: [50000, 50000, 50000] }); G.level = 2; newHand();
        const c = H.sb === 300 && H.bb === 600; // 정하지 않으면 레벨표 그대로
        [G, H] = saved; return a && b && c; }],
    ];
  },
};
