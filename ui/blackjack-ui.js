// 블랙잭 전용 테이블. 서버 좌석과 패 ID를 그대로 사용해 분할·재접속을 안정적으로 복구한다.
UI_GAMES.blackjack = {
  actions: 'actions', center: 'board', panels: [], solo: { bj: 1 }, evGauge: false,
  tag: '블랙잭', mpTitle: '블랙잭 · 딜러와 승부', duel: '플레이어 2자리 + 딜러',
  stakeAmt: x => fmt(x), stakeHint: () => '200 단위', bind() {},
};
const BJU = (() => {
  let root, state, local, remote = false, me = 0, clockTimer, pollTimer, channel, busy = false, polling = false, ticking = false, generation = 0, seq = -1, pending = null, error = '', lastBet = 200, skew = 0;
  const e = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => Number(n || 0).toLocaleString('ko-KR');
  const signed = n => `${n > 0 ? '+' : ''}${money(n)}`;
  function mount() {
    if (!root) { root = document.createElement('section'); root.id = 'blackjackPage'; root.setAttribute('aria-label', '블랙잭 테이블'); root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.tabIndex=-1; document.body.append(root); root.addEventListener('click', click); }
    root.hidden = false; document.querySelector('header.top').inert=true; root.focus({preventScroll:true});
    for (const id of ['landing','lobby','mpSheet','endModal']) $(id).hidden = true;
    document.querySelector('.layout').hidden = true; hideStage(); G = null;
  }
  function setup() {
    stop(); remote = false; mode = 'bj'; phase = 'player'; mount();
    root.innerHTML = `<div class="bj-wrap bj-setup"><button class="btn" data-bj="exit">← 로비</button><p class="bj-eyebrow">BLACKJACK</p><h1>딜러와 한 판</h1><p>21에 가까울수록 유리해요.<br>딜러보다 높은 패로 칩을 쌓아 보세요.</p><div class="bj-setup-form"><label>플레이할 판수<select id="bjSoloRounds"><option>10</option><option selected>20</option><option>50</option></select></label><label>리바인<select id="bjSoloRebuys"><option value="0">없음</option><option value="2">2회</option><option value="3">3회</option><option value="5">5회</option><option value="-1">무제한</option></select></label></div><p class="bj-rule">시작 20,000칩 · 베팅 200~4,000<br>블랙잭 3:2 · 딜러 소프트 17 스탠드 · 매 판 6덱 재셔플</p><button class="btn primary" data-bj="solo">플레이 시작</button>${rules()}</div>`;
  }
  function startSolo() {
    const opts = { roundLimit: +$('bjSoloRounds').value, rebuys: +$('bjSoloRebuys').value };
    local = BJ.create({ names: [NICK || '나'], users: ['local'], styles: [null], options: opts });
    me = 0; remote = false; error = ''; pending = null; state = BJ.publicState(local); render();
    clockTimer = setInterval(() => { const before=JSON.stringify(local); BJ.tick(local, Date.now()); if(before!==JSON.stringify(local)){state=BJ.publicState(local);render();} clock(); }, 500);
  }
  function stop() {
    document.querySelector('header.top').inert=false;
    generation++; clearInterval(clockTimer); clearInterval(pollTimer);
    if (channel && typeof sb !== 'undefined' && sb) sb.removeChannel(channel);
    channel = null; pending = null; busy = polling = ticking = false;
  }
  async function enter(T) {
    stop(); remote = true; local = null; mode = 'mp'; phase = 'player'; error = ''; pending = null; seq = T.seq; document.body.classList.remove('waiting'); MP.waiting=false; state = T.public; skew = state.now - Date.now(); me = state.users.indexOf(MP.me); mount(); render();
    const gen = generation;
    channel = sb.channel('blackjack-' + MP.id + '-' + gen).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables', filter: `id=eq.${MP.id}` }, p => receive(p.new, gen)).subscribe();
    pollTimer = setInterval(() => refresh(gen), 2000);
    clockTimer = setInterval(async () => {
      clock(); if (ticking || gen !== generation || state.paused || state.phase === 'over') return;
      const due = state.phase === 'between' ? state.nextAt : state.phase === 'waiting' ? state.rebuyUntil : state.deadline;
      if (due && Date.now() + skew >= due) { ticking = true; try { await mpCall('tick', { id: MP.id }); await refresh(gen); } catch (err) { error = err.message; const el = $('bjError'); if (el) el.textContent = error; } finally { if (gen === generation) ticking = false; } }
    }, 700);
  }
  function receive(T, gen) {
    if (gen !== generation) return;
    if (T.status === 'waiting') { stop(); root.hidden = true; MP.waiting = false; mode = 'hu'; mpWait(); return; }
    if (T.seq <= seq || T.public?.game !== 'blackjack') return;
    seq = T.seq; const prev = state; state = T.public; skew = state.now - Date.now();
    if (state.hands?.flat().reduce((n,h)=>n+h.cards.length,0) > (prev.hands?.flat().reduce((n,h)=>n+h.cards.length,0) || 0)) sfx('deal');
    if (state.round !== prev.round || state.phase !== prev.phase) { if (state.phase === 'between' || state.phase === 'over') sfx(state.results.filter(r=>r.seat===me).reduce((n,r)=>n+r.net,0) >= 0 ? 'win' : 'lose'); }
    render();
  }
  async function refresh(gen = generation) {
    if (polling || !remote) return; polling = true;
    try { const {data:T,error:err} = await sb.from('tables').select('public,seq,status').eq('id',MP.id).maybeSingle(); if (err) throw err; if (!T) { error = '방이 닫혔어요. 로비로 돌아가 주세요'; render(); } else receive(T,gen); }
    catch (err) { if (gen === generation) { error = '연결을 확인하고 다시 시도해 주세요'; const el=$('bjError'); if(el) el.textContent=error; } }
    finally { if (gen === generation) polling=false; }
  }
  async function send(op, body = {}, retry = false) {
    if (busy) return; busy = true; error = ''; const gen = generation;
    const b = retry ? pending.body : { id: remote ? MP.id : 'local', ...body, requestId: crypto.randomUUID() };
    pending = { op, body: b }; render();
    try {
      if (remote) { await mpCall(op,b); await refresh(gen); }
      else { const before=local.phase; BJ.command(local,me,op,b); state=BJ.publicState(local); if(['bjBet','bjAct'].includes(op))sfx('deal'); if(local.phase!==before && ['between','over'].includes(local.phase))sfx(local.results.filter(r=>r.seat===me).reduce((n,r)=>n+r.net,0)>=0?'win':'lose'); }
      if (gen === generation) pending=null;
    } catch(err) { if (gen===generation) { error=err.message; if (remote) await refresh(gen); else pending=null; } }
    finally { if(gen===generation){busy=false;render();} }
  }
  async function click(ev) {
    const b=ev.target.closest('[data-bj]'); if(!b || b.disabled) return;
    audio(); const k=b.dataset.bj;
    if(k==='exit'){ const wasRemote=remote; stop(); root.hidden=true; if(wasRemote){try{await mpCall('leave',{id:MP.id});}catch{}} mode='hu'; showLobby(wasRemote?'mp':'solo'); return; }
    if(k==='solo')return startSolo();
    if(k==='retry' && pending)return send(pending.op,pending.body,true);
    if(k==='again'){if(!remote)return setup(); try{await mpCall('rematch',{id:MP.id}); await refresh();}catch(err){error=err.message;render();}return;}
    if(k==='bet') {const amount=Number($('bjAmount').value);lastBet=amount;return send('bjBet',{amount,roundId:state.roundId});}
    if(k==='skip')return send('bjBet',{amount:0,roundId:state.roundId});
    if(k==='preset'){$('bjAmount').value=Math.min(+b.dataset.amount,Math.floor(Math.min(state.stacks[me],state.config.maxBet)/200)*200);return;}
    if(['hit','stand','double','split'].includes(k))return send('bjAct',{type:k,roundId:state.roundId,handId:state.active.handId,turnId:state.active.turnId});
    if(k==='pause')return send('pause',{on:!state.paused});
    if(k==='rebuy')return send('rebuy',{yes:true});
    if(k==='time')return send('timechip');
    if(k==='back')return send('bjResume');
    if(k==='end'){if(b.dataset.armed==='1')return send('bjEnd');b.dataset.armed='1';b.textContent='다시 누르면 종료 예약';setTimeout(()=>{if(b.isConnected){b.dataset.armed='0';b.textContent='세션 끝내기';}},3000);}
  }
  function cards(cs) {
    return `<div class="bj-cards">${cs.map(c=>c<0?'<span class="bj-card bj-back" role="img" aria-label="딜러 비공개 카드">♠</span>':`<span class="bj-card ${[1,2].includes(c%4)?'bj-red':''}" role="img" aria-label="${e(cardText(c%52))}"><b>${e(rankLabel(BJ.rank(c)))}</b><span>${SUIT_GLYPH[c%4]}</span></span>`).join('')}</div>`;
  }
  function label(h) {const t=BJ.total(h.cards);return t.bust?'버스트':BJ.natural(h)?'블랙잭':`${t.soft?'소프트 ':''}${t.sum}`;}
  function rules() {return '<details class="bj-rules"><summary>게임 규칙</summary><p>플레이어끼리 겨루지 않고 각자 딜러와 승부해요. A는 1 또는 11, J·Q·K는 10이에요. 딜러는 소프트 17에서도 멈춥니다.</p><p>블랙잭 3:2 · 일반 승리 1:1 · 무승부 원금 반환. 최초 두 장에서 더블다운, 같은 랭크는 스플릿 1회 가능해요. A를 나누면 각 패에 한 장만 받고 멈추고, 분할 후 21은 일반 21이에요. 보험과 서렌더는 없어요. 매 판 6덱을 새로 섞어요.</p></details>';}
  const btn=(k,text,off=false,cls='')=>`<button class="btn ${cls}" data-bj="${k}" ${off?'disabled':''}>${text}</button>`;
  function render() {
    if(!state || !root || root.hidden)return;
    const amount=document.getElementById('bjAmount')?.value;
    const s=state,c=s.config, host=!remote||MP.host===MP.me, done=s.phase==='over', mine=s.hands[me]||[], canBet=s.phase==='betting' && s.bets[me]===null && !s.away[me], canAct=s.phase==='acting' && s.active?.seat===me && !s.paused;
    const allowed=canAct?BJ.legal({...s,pausedAt:s.paused},me):[];
    const titles={betting:'베팅을 정해 주세요',acting:s.active?.seat===me?'내 차례예요':`${s.names[s.active?.seat]||'딜러'}의 차례`,between:'이번 판 결과',waiting:'잠시 쉬고 있어요',over:'세션 종료'};
    let controls='';
    if(done)controls=btn('again',remote?'같은 방 다시 하기':'다시 하기',remote && !host && !MP.pw,'primary');
    else if(s.paused)controls='<p>일시정지 중이에요. 방장이 다시 시작할 수 있어요.</p>';
    else if(canBet)controls=`<label class="bj-amount">베팅할 칩<input id="bjAmount" type="number" inputmode="numeric" step="200" min="${c.minBet}" max="${Math.min(s.stacks[me],c.maxBet)}" value="${e(amount??Math.min(Math.max(lastBet,c.minBet),c.maxBet,Math.floor(s.stacks[me]/200)*200))}" aria-label="베팅할 칩"></label><div class="bj-presets">${[c.minBet,Math.min(c.maxBet,c.minBet*5),c.maxBet].filter((x,i,a)=>a.indexOf(x)===i).map(x=>`<button class="chip" data-bj="preset" data-amount="${x}">${money(x)}</button>`).join('')}</div><div class="bj-buttons">${btn('bet','베팅 확정',busy,'primary')}${btn('skip','이번 판 쉬기',busy)}</div>`;
    else if(canAct)controls=`<div class="bj-buttons">${[['hit','히트'],['stand','스탠드'],['double','더블다운'],['split','스플릿']].map(([k,t])=>btn(k,t,!allowed.includes(k)||busy,k==='stand'?'primary':'')).join('')}</div><small>더블·스플릿은 해당 패 베팅액을 추가로 사용해요.</small>${btn('time',`타임칩 +30초 (${s.timeChips[me]})`,!s.timeChips[me]||busy)}`;
    else controls=`<p>${s.phase==='betting'?(s.bets[me]>0?'베팅했어요. 다른 사람을 기다리는 중…':'이번 판은 쉬어요.'):s.phase==='between'?'잠시 후 다음 판의 베팅을 시작해요.':s.phase==='acting'?'다른 플레이어의 행동을 보고 있어요.':'참여 재개를 누르면 베팅을 시작해요.'}</p>`;
    if(!done && !s.paused && (s.away[me]||s.phase==='waiting') && s.stacks[me]>=c.minBet)controls+=btn('back',s.phase==='waiting'?'참여 재개':'자리로 복귀',busy);
    if(!done && !s.paused && ['between','waiting'].includes(s.phase) && BJ.canRebuy(s,me))controls+=btn('rebuy',`${money(c.chips)}칩 리바인`,busy);
    const locked=s.phase==='betting'?(s.bets[me]||0):s.phase==='acting'?mine.reduce((n,h)=>n+h.wager,0):0;
    const profit=s.stacks[me]+locked-c.chips-s.added[me], dealer=s.dealer.filter(x=>x>=0), dLabel=dealer.length?(s.revealed?BJ.total(dealer).bust?'버스트':BJ.total(dealer).sum:`공개 ${BJ.total(dealer).sum}`):'카드를 기다려요';
    root.innerHTML=`<div class="bj-wrap"><header class="bj-header"><div><span class="bj-eyebrow">BLACKJACK</span><h1>블랙잭</h1><small>${remote?'친구방 · 코드 '+e(MP.code):'혼자 하기'} · ${s.round} / ${c.roundLimit}판</small></div><div class="bj-nav">${host&&!done?btn('pause',s.paused?'다시 시작':'일시정지'):''}${btn('exit','로비')}</div></header><div class="bj-content"><main class="bj-felt"><div class="bj-dealer"><span class="bj-eyebrow">DEALER</span><h2>딜러 <span>${dLabel}</span></h2>${cards(s.dealer)}<p>BLACKJACK PAYS 3 TO 2</p><small>소프트 17 스탠드 · 매 판 6덱 재셔플</small></div><div class="bj-stage"><h2>${e(s.paused?'일시정지':titles[s.phase])}</h2><span id="bjClock" aria-live="off"></span></div><div class="bj-players">${s.names.map((nm,i)=>nm?`<article class="bj-player ${i===me?'bj-me':''} ${s.active?.seat===i?'bj-current':''}"><div class="bj-player-title"><b>${e(nm)}${i===me?' · 나':''}</b><span>${money(s.stacks[i])}칩${s.away[i]?' · 자리 비움':''}</span></div><div class="bj-hands">${(s.hands[i]||[]).map((h,j)=>`<div class="bj-hand ${s.active?.handId===h.id?'bj-active':''}"><small>${s.hands[i].length>1?`${j+1}번 패 · `:''}${money(h.wager)}칩${h.doubled?' · 더블':''}</small>${cards(h.cards)}<b class="bj-score">${label(h)}</b>${h.result?`<span class="bj-result ${h.net>0?'positive':h.net<0?'negative':''}">${h.result} ${signed(h.net)}</span>`:''}</div>`).join('')||`<p class="bj-empty">${s.phase==='betting'?s.bets[i]===null?'베팅 선택 중':s.bets[i]===0?'이번 판 쉬기':`${money(s.bets[i])}칩 베팅`:'이번 판 쉬기'}</p>`}</div></article>`:'').join('')}</div></main><aside class="bj-side"><div class="bj-wallet"><span>내 칩</span><b>${money(s.stacks[me])}</b><small>순손익 <strong class="${profit>=0?'positive':'negative'}">${signed(profit)}</strong> · 리바인 ${money(s.added[me])}</small></div>${done?`<p>${s.stats[me].played}판 참여 · ${s.stats[me].won}승 ${s.stats[me].lost}패 ${s.stats[me].push}무<br>블랙잭 ${s.stats[me].blackjack}회</p>`:''}<div class="bj-controls">${controls}</div><p id="bjError" class="negative" role="alert">${e(error)}</p>${pending&&!busy?btn('retry','같은 요청 다시 전송'):''}<p class="bj-rule">베팅 ${money(c.minBet)}~${money(c.maxBet)}<br>${s.endRequested?'이번 판이 끝나면 세션을 종료해요.':''}</p>${rules()}<details class="bj-history"><summary>이번 세션 기록</summary><ol>${s.logs.slice().reverse().map(t=>`<li>${e(t)}</li>`).join('')}</ol></details>${host&&!done?btn('end','세션 끝내기',busy||s.endRequested):''}</aside></div></div>`;
    clock();
  }
  function clock(){const el=$('bjClock');if(!el||!state)return;const at=state.phase==='between'?state.nextAt:state.phase==='waiting'?state.rebuyUntil:state.deadline;el.textContent=state.paused?'시계가 멈췄어요':at?`${Math.max(0,Math.ceil((at-(Date.now()+(remote?skew:0)))/1000))}초`:'';}
  return { setup, enter, stop, get state(){return state;} };
})();
