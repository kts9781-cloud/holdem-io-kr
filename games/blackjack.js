// 블랙잭: 명시적으로 전달한 상태만 변경한다. 브라우저와 서버가 같은 규칙을 사용한다.
const BJ = (() => {
  const fail = m => { throw new Error(m); };
  const rank = c => (c % 52) >> 2;
  const value = c => rank(c) === 12 ? 11 : Math.min(10, rank(c) + 2);
  function total(cards) {
    let sum = cards.reduce((n, c) => n + value(c), 0), aces = cards.filter(c => rank(c) === 12).length;
    while (sum > 21 && aces) { sum -= 10; aces--; }
    return { sum, soft: aces > 0, bust: sum > 21 };
  }
  const natural = h => !h.split && h.cards.length === 2 && total(h.cards).sum === 21;
  function options(o = {}) {
    const n = (k, d) => o[k] == null || o[k] === '' ? d : Number(o[k]);
    const v = { minBet: n('minBet', 200), maxBet: n('maxBet', 4000), chips: n('chips', 20000), roundLimit: n('roundLimit', 20), rebuys: n('rebuys', 0), rulesVersion: 1 };
    if (![v.minBet, v.maxBet, v.chips].every(Number.isSafeInteger) || v.minBet < 200 || v.minBet % 200 || v.maxBet % 200 || v.maxBet < v.minBet || v.maxBet > v.chips || v.chips > 100000000 || v.chips % 100) fail('최소·최대 베팅은 200 단위, 시작 칩은 100 단위예요. 최대 베팅은 시작 칩 이하여야 해요');
    if (![10, 20, 50].includes(v.roundLimit) || ![0, 2, 3, 5, -1].includes(v.rebuys)) fail('판수나 리바인 횟수를 다시 골라 주세요');
    return v;
  }
  function create({ names, users, styles, options: opts = {}, now = Date.now() }) {
    const config = options(opts), n = names.length;
    if (n < 1 || n > 6 || !users.some(Boolean)) fail('플레이어는 1~6명이고 사람이 한 명 이상 필요해요');
    const state = { game: 'blackjack', n, names, users, styles, config, stacks: names.map(nm => nm ? config.chips : 0), round: 0, attempt: 0, phase: 'new', deadline: null, nextAt: null, pausedAt: null, startedAt: now, away: names.map(() => false), timeChips: names.map(() => 3), added: names.map(() => 0), rebuys: names.map(() => 0), bank: 0, requests: [], results: [], logs: [], serial: 0, stats: names.map(() => ({ played: 0, won: 0, lost: 0, push: 0, blackjack: 0 })) };
    begin(state, now); return state;
  }
  function log(s, text) { s.logs.push(text); s.logs = s.logs.slice(-40); }
  const humanPresent = s => s.users.some((u, i) => u && !s.away[i]);
  const canRebuy = (s, i) => !!s.users[i] && (s.config.rebuys === -1 || s.rebuys[i] < s.config.rebuys);
  function finish(s) { s.phase = 'over'; s.deadline = s.nextAt = null; s.rebuyUntil = null; log(s, '세션이 끝났어요'); }
  function begin(s, now) {
    if (s.round >= s.config.roundLimit || s.endRequested || !humanPresent(s)) return finish(s);
    const playing = s.users.some((u, i) => u && !s.away[i] && s.stacks[i] >= s.config.minBet);
    if (!playing) {
      if (!s.users.some((u, i) => u && !s.away[i] && canRebuy(s, i))) return finish(s);
      s.phase = 'waiting'; s.rebuyUntil = now + 30000; s.deadline = null; s.nextAt = null; return;
    }
    s.phase = 'betting'; s.attempt++; s.roundId = `${s.round + 1}:${s.attempt}`; s.deadline = now + 20000; s.nextAt = null; s.rebuyUntil = null;
    s.bets = s.names.map((nm, i) => !nm || s.away[i] || s.stacks[i] < s.config.minBet ? 0 : null);
    s.hands = s.names.map(() => []); s.dealer = []; s.revealed = false; s.deck = []; s.active = null; s.results = [];
    s.names.forEach((nm, i) => { if (nm && !s.users[i] && s.bets[i] === null) bet(s, i, aiBet(s, i)); });
    log(s, `${s.round + 1}번째 판 · 베팅을 정해 주세요`);
  }
  function bet(s, i, amount) {
    if (s.phase !== 'betting' || s.bets[i] !== null) fail('이미 베팅했거나 베팅 시간이 아니에요');
    if (!Number.isSafeInteger(amount) || amount < 0 || (amount && (amount % 200 || amount < s.config.minBet || amount > s.config.maxBet || amount > s.stacks[i]))) fail('베팅 금액과 남은 칩을 확인해 주세요');
    s.bets[i] = amount; s.stacks[i] -= amount;
  }
  function shuffled(rng) {
    const a = Array.from({ length: 312 }, (_, i) => i);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function take(s) { if (!s.deck.length) fail('카드가 부족해요'); return s.deck.pop(); }
  function newHand(s, i, cards, wager, split = false) { return { id: `${s.roundId}:${i}:${++s.serial}`, cards, wager, split, done: false, doubled: false, splitAces: false }; }
  function deal(s, now, rng) {
    if (!s.users.some((u, i) => u && s.bets[i] > 0)) {
      s.bets.forEach((b, i) => { s.stacks[i] += b || 0; });
      s.phase = 'waiting'; s.deadline = null; s.bets.fill(0); log(s, '모두 이번 판을 쉬어요 · 참여 재개를 누르면 다시 시작해요'); return;
    }
    s.deck = shuffled(rng);
    s.bets.forEach((b, i) => { if (b > 0) s.hands[i] = [newHand(s, i, [], b)]; });
    s.dealer = [];
    for (let k = 0; k < 2; k++) { s.hands.forEach(hs => { if (hs.length) hs[0].cards.push(take(s)); }); s.dealer.push(take(s)); }
    s.round++; s.phase = 'acting'; s.deadline = null;
    s.hands.flat().forEach(h => { if (natural(h)) h.done = true; });
    log(s, `${s.round}번째 판 · 카드를 나눴어요`);
    if (total(s.dealer).sum === 21) { settle(s, now); return; }
    advance(s, now);
  }
  function legal(s, i) {
    const h = s.active?.seat === i ? s.hands[i]?.find(h => h.id === s.active.handId) : null;
    if (!h || s.phase !== 'acting' || h.done || s.pausedAt) return [];
    const a = ['hit', 'stand'];
    if (h.cards.length === 2 && !h.splitAces && s.stacks[i] >= h.wager) {
      a.push('double');
      if (!h.split && s.hands[i].length === 1 && rank(h.cards[0]) === rank(h.cards[1])) a.push('split');
    }
    return a;
  }
  function action(s, i, type, now) {
    if (!legal(s, i).includes(type)) fail('지금은 할 수 없는 행동이에요');
    const h = s.hands[i].find(h => h.id === s.active.handId);
    if (type === 'stand') h.done = true;
    if (type === 'hit' || type === 'double') {
      if (type === 'double') { s.stacks[i] -= h.wager; h.wager *= 2; h.doubled = true; }
      h.cards.push(take(s)); if (type === 'double' || total(h.cards).sum >= 21) h.done = true;
    }
    if (type === 'split') {
      s.stacks[i] -= h.wager;
      const second = newHand(s, i, [h.cards.pop()], h.wager, true); h.split = true;
      const aces = rank(h.cards[0]) === 12;
      for (const x of [h, second]) { x.cards.push(take(s)); x.splitAces = aces; x.done = aces || total(x.cards).sum >= 21; }
      s.hands[i].push(second);
    }
    log(s, `${s.names[i]} · ${{ hit: '히트', stand: '스탠드', double: '더블다운', split: '스플릿' }[type]}`);
    advance(s, now);
  }
  function advance(s, now) {
    for (let i = 0; i < s.n; i++) for (const h of s.hands[i]) if (!h.done) {
      if (s.away[i]) { h.done = true; continue; }
      s.active = { seat: i, handId: h.id, turnId: `${s.roundId}:t${++s.serial}` }; s.deadline = now + 20000; return;
    }
    settle(s, now);
  }
  function settle(s, now) {
    if (s.phase !== 'acting') return;
    s.active = null; s.revealed = true;
    const dealerNatural = s.dealer.length === 2 && total(s.dealer).sum === 21;
    if (!dealerNatural && s.hands.flat().some(h => !total(h.cards).bust && !natural(h))) while (total(s.dealer).sum < 17) s.dealer.push(take(s));
    const d = total(s.dealer); s.results = [];
    s.hands.forEach((hs, i) => {
      if (!hs.length) return;
      s.stats[i].played++;
      hs.forEach(h => {
        const mine = total(h.cards), bj = natural(h);
        let returned = 0;
        if (!mine.bust) {
          if (dealerNatural) returned = bj ? h.wager : 0;
          else if (bj) returned = h.wager * 2.5;
          else if (d.bust || mine.sum > d.sum) returned = h.wager * 2;
          else if (mine.sum === d.sum) returned = h.wager;
        }
        const net = returned - h.wager;
        Object.assign(h, { done: true, returned, net, result: net > 0 ? '승리' : net < 0 ? '패배' : '원금 반환' });
        s.stacks[i] += returned; s.bank -= net;
        s.stats[i][net > 0 ? 'won' : net < 0 ? 'lost' : 'push']++;
        if (bj) s.stats[i].blackjack++;
        s.results.push({ seat: i, handId: h.id, wager: h.wager, returned, net });
      });
    });
    log(s, `딜러 ${d.bust ? '버스트' : d.sum} · 정산 완료`);
    s.phase = 'between'; s.deadline = null; s.nextAt = now + 5000;
    if (s.round >= s.config.roundLimit || s.endRequested || !humanPresent(s)) finish(s);
  }
  const styleKey = s => typeof s === 'string' ? s : s?.tag;
  // 공격형(3배)과 기존 미친놈(8배)을 70:30으로 섞고 200칩 단위로 맞춘다.
  const styleFactor = x => ({ pro: 1, '정석': 1, rock: 1, '바위': 1, station: 2, '콜링': 2, lag: 3, '공격형': 3, maniac: 4.5, '미친놈': 4.5 })[styleKey(x)] || 1;
  function aiBet(s, i) { return Math.min(s.config.maxBet, Math.floor(s.stacks[i] / 200) * 200, Math.round(s.config.minBet * styleFactor(s.styles[i]) / 200) * 200); }
  function strategy(cards, up) {
    const t = total(cards), d = value(up), pair = cards.length === 2 && rank(cards[0]) === rank(cards[1]) ? value(cards[0]) : 0;
    if (pair && (pair === 11 || pair === 8 || (pair === 9 && [2,3,4,5,6,8,9].includes(d)) || (pair === 7 && d <= 7) || (pair === 6 && d <= 6) || ([2,3].includes(pair) && d <= 7) || (pair === 4 && [5,6].includes(d)))) return 'split';
    if (t.soft) {
      if (t.sum >= 19) return 'stand';
      if (t.sum === 18) return d >= 3 && d <= 6 ? 'double' : [2,7,8].includes(d) ? 'stand' : 'hit';
      if ((t.sum === 17 && d >= 3 && d <= 6) || ([15,16].includes(t.sum) && d >= 4 && d <= 6) || ([13,14].includes(t.sum) && [5,6].includes(d))) return 'double';
      return 'hit';
    }
    if (t.sum >= 17) return 'stand';
    if (t.sum === 11 && d !== 11 || t.sum === 10 && d <= 9 || t.sum === 9 && d >= 3 && d <= 6) return 'double';
    if (t.sum >= 13 && d <= 6 || t.sum === 12 && d >= 4 && d <= 6) return 'stand';
    return 'hit';
  }
  function aiAction(s, i, rng) {
    const h = s.hands[i].find(h => h.id === s.active.handId), a = legal(s, i), maniac = ['maniac', '미친놈'].includes(styleKey(s.styles[i]));
    if (maniac && rng() < 0.35 * 0.3) return a.includes('split') ? 'split' : a.includes('double') ? 'double' : total(h.cards).sum < 20 ? 'hit' : 'stand';
    const plan = strategy(h.cards, s.dealer[0]);
    if (a.includes(plan)) return plan;
    if (plan === 'double' && total(h.cards).soft && total(h.cards).sum === 18) return 'stand';
    return total(h.cards).sum >= 17 ? 'stand' : 'hit';
  }
  function progress(s, now, rng = Math.random) {
    if (s.pausedAt) return;
    if (s.phase === 'betting' && s.bets.every(b => b !== null)) deal(s, now, rng);
    for (let guard = 0; s.phase === 'acting' && s.active && !s.users[s.active.seat] && guard < 500; guard++) action(s, s.active.seat, aiAction(s, s.active.seat, rng), now);
  }
  function tick(s, now, rng = Math.random) {
    if (s.pausedAt || s.phase === 'over') return;
    if (s.phase === 'betting' && now >= s.deadline) { s.bets.forEach((b, i) => { if (b === null) s.bets[i] = 0; }); progress(s, now, rng); }
    else if (s.phase === 'acting' && now >= s.deadline) {
      const i = s.active.seat; s.away[i] = true; s.hands[i].forEach(h => { h.done = true; }); log(s, `${s.names[i]} · 시간 초과, 자동 스탠드`); advance(s, now); progress(s, now, rng);
    } else if (s.phase === 'between' && now >= s.nextAt) begin(s, now);
    else if (s.phase === 'waiting' && s.rebuyUntil && now >= s.rebuyUntil) finish(s);
  }
  function command(s, i, op, b = {}, now = Date.now(), rng = Math.random) {
    if (!s.users[i]) fail('참가자가 아니에요');
    const id = b.requestId;
    const body = JSON.stringify(op === 'bjBet' ? [b.roundId,b.amount] : op === 'bjAct' ? [b.roundId,b.handId,b.turnId,b.type] : [b.yes !== false]);
    if (['bjBet', 'bjAct', 'rebuy'].includes(op)) {
      if (typeof id !== 'string' || !/^[\w-]{8,100}$/.test(id)) fail('요청 번호를 확인해 주세요');
      const prev = s.requests.find(r => r.id === id && r.seat === i);
      if (prev) { if (prev.op !== op || prev.body !== body) fail('같은 요청 번호에 다른 행동을 보낼 수 없어요'); return false; }
    }
    if (s.phase === 'over') fail('끝난 게임이에요');
    if (s.pausedAt && !['pause', 'leave', 'bjEnd', 'remove'].includes(op)) fail('일시정지 중이에요');
    if (op === 'bjBet') {
      if (s.roundId !== b.roundId || now >= s.deadline || s.away[i]) fail('베팅 시간이 끝났거나 자리 비움 상태예요');
      bet(s, i, b.amount); log(s, `${s.names[i]} · ${b.amount ? b.amount.toLocaleString('ko-KR') + ' 베팅' : '이번 판 쉬기'}`); progress(s, now, rng);
    } else if (op === 'bjAct') {
      if (s.roundId !== b.roundId || s.active?.handId !== b.handId || s.active?.turnId !== b.turnId || now >= s.deadline) fail('지난 차례예요. 화면을 새로 확인해 주세요');
      action(s, i, b.type, now); progress(s, now, rng);
    } else if (op === 'tick') {
      const before = JSON.stringify(s); tick(s, now, rng); if (before === JSON.stringify(s)) return false;
    } else if (op === 'pause') {
      if (b.on === false && s.pausedAt) { const shift = now - s.pausedAt; for (const k of ['deadline', 'nextAt', 'rebuyUntil']) if (s[k] != null) s[k] += shift; s.pausedAt = null; }
      else if (b.on !== false && !s.pausedAt) s.pausedAt = now;
      else return false;
    } else if (op === 'timechip') {
      if (s.phase !== 'acting' || s.active?.seat !== i || now >= s.deadline || !s.timeChips[i]) fail('내 차례가 아니거나 타임칩이 없어요');
      s.timeChips[i]--; s.deadline += 30000;
    } else if (op === 'back' || op === 'bjResume') {
      s.away[i] = false;
      if (s.phase === 'waiting') begin(s, now);
    } else if (op === 'leave') {
      if (s.pausedAt) { const shift = now - s.pausedAt; for (const k of ['deadline','nextAt','rebuyUntil']) if (s[k] != null) s[k] += shift; s.pausedAt = null; }
      s.away[i] = true;
      if (s.phase === 'betting' && s.bets[i] === null) s.bets[i] = 0;
      if (s.phase === 'acting') { s.hands[i].forEach(h => { h.done = true; }); if (s.active?.seat === i) advance(s, now); }
      progress(s, now, rng);
      if (!humanPresent(s)) { s.endRequested = true; if (s.phase === 'acting') { s.hands.flat().forEach(h => { h.done = true; }); settle(s, now); } else if (s.phase === 'betting' && s.bets.some(b => b > 0)) { s.bets = s.bets.map(b => b ?? 0); deal(s, now, rng); if (s.phase === 'acting') { s.hands.flat().forEach(h => { h.done = true; }); settle(s, now); } } finish(s); }
    } else if (op === 'bjEnd' || op === 'remove') {
      if(s.pausedAt){const shift=now-s.pausedAt;for(const k of ['deadline','nextAt','rebuyUntil'])if(s[k]!=null)s[k]+=shift;s.pausedAt=null;}
      s.endRequested = true;
      if (s.phase === 'between' || s.phase === 'waiting' || s.phase === 'betting' && !s.bets.some(b => b > 0)) finish(s);
      else if (s.phase === 'betting') { s.bets = s.bets.map(b => b ?? 0); progress(s, now, rng); }
    } else if (op === 'rebuy') {
      if (!['between','waiting'].includes(s.phase) || !canRebuy(s, i) || s.round >= s.config.roundLimit || s.endRequested || s.rebuyUntil && now >= s.rebuyUntil) fail('지금은 리바인할 수 없어요');
      if (b.yes === false) { s.away[i] = true; if (!humanPresent(s)) finish(s); }
      else { s.stacks[i] += s.config.chips; s.added[i] += s.config.chips; s.rebuys[i]++; s.away[i] = false; if (s.phase === 'waiting') begin(s, now); }
    } else fail('블랙잭에서 사용할 수 없는 요청이에요');
    if (id && ['bjBet','bjAct','rebuy'].includes(op)) { s.requests.push({ id, seat: i, op, body }); s.requests = s.requests.slice(-128); }
    return true;
  }
  function publicState(s, now = Date.now()) {
    // 허용한 필드만 복사: 덱·요청 기록·공개 전 딜러 홀카드를 전송하지 않는다.
    return structuredClone({ game: 'blackjack', now, n: s.n, names: s.names, users: s.users, stacks: s.stacks, config: s.config, round: s.round, roundId: s.roundId, phase: s.phase, deadline: s.deadline, nextAt: s.nextAt, paused: !!s.pausedAt, away: s.away, timeChips: s.timeChips, rebuys: s.rebuys, added: s.added, stats: s.stats, results: s.results, bets: s.bets, hands: s.hands, active: s.active, revealed: s.revealed, dealer: s.revealed ? s.dealer : s.dealer.length ? [s.dealer[0], -1] : [], logs: s.logs, endRequested: !!s.endRequested, rebuyUntil: s.rebuyUntil, styles: s.phase === 'over' ? s.styles.map(styleKey) : null });
  }
  return { options, create, begin, bet, deal, total, natural, legal, action, settle, progress, tick, command, publicState, strategy, rank, value, canRebuy };
})();
GAMES.blackjack = { id: 'blackjack', name: '블랙잭', runtime: 'dealer', seats: [2,4,6], fixedSeats: true, ranked: false, minV: 5, holeCards: 2, stakeName: '최소 베팅', stakeInput: '최소 베팅', minChipsX: 1, chipsBase: '최소 베팅' };
