// 초대 경로만 보관한다. 로그인 토큰은 브라우저 사이로 복사하거나 URL에 싣지 않는다.
const Invite = (() => {
  const key = 'holdem.pendingInvite', ttl = 30 * 60 * 1000;
  const normalize = code => /^[A-Z0-9]{6}$/.test(String(code ?? '').trim().toUpperCase()) ? String(code).trim().toUpperCase() : null;
  const inKakao = /KAKAOTALK/i.test(navigator.userAgent);
  function remember(code) {
    code = normalize(code); if (!code) return null;
    try { sessionStorage.setItem(key, JSON.stringify({ code, at: Date.now() })); } catch {}
    return code;
  }
  function clear() { try { sessionStorage.removeItem(key); } catch {} }
  function pending() {
    try {
      const p = JSON.parse(sessionStorage.getItem(key));
      if (p && Number.isFinite(p.at) && Date.now() >= p.at && Date.now() - p.at < ttl && normalize(p.code)) return normalize(p.code);
    } catch {}
    clear(); return null;
  }
  function handoffUrl(code) {
    const url = new URL(location.origin); url.pathname = location.pathname;
    code = normalize(code); if (code) url.searchParams.set('room', code);
    return url.href;
  }
  function authRoom(code) { return code == null || code === '' ? pending() : normalize(code); }
  function show({ room, onContinue }) {
    const code = normalize(room), url = handoffUrl(code);
    if (code) remember(code); else clear();
    let root = document.getElementById('inviteGuide');
    if (!root) { root = document.createElement('section'); root.id = 'inviteGuide'; root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.setAttribute('aria-labelledby','inviteTitle'); document.body.append(root); }
    const background = ['header.top','.layout','#landing','#lobby','#mpSheet'].map(s=>document.querySelector(s)).filter(Boolean);
    background.forEach(el=>{el.inert=true;}); root.hidden=false;
    root.innerHTML = `<div class="invite-sheet"><span class="invite-brand">♠ HOLDEM</span><p class="invite-eyebrow">카카오톡에서 받은 ${code ? '초대' : '링크'}</p><h1 id="inviteTitle" tabindex="-1">로그인한 곳에서<br>이어서 참여하세요</h1><p class="invite-intro">카카오톡 안에서는 설치한 앱이나 다른 브라우저의 로그인 상태가 이어지지 않을 수 있어요.</p>
      <a class="btn primary invite-external" id="inviteExternal">외부 브라우저로 열기 <span aria-hidden="true">↗</span></a><p class="invite-note">평소 로그인한 브라우저에서 열어 주세요. 설치 앱으로 바로 열리는지는 기기에 따라 달라요.</p>
      ${code ? `<div class="invite-ticket"><label for="inviteCode">방 초대 코드</label><input id="inviteCode" value="${code}" readonly spellcheck="false" aria-label="방 초대 코드"><button class="btn" id="inviteCopy">초대 코드 복사</button></div><div class="invite-app"><h2>홀덤 앱을 설치했다면</h2><ol><li>초대 코드를 복사하세요.</li><li>홈 화면의 <b>홀덤</b> 앱을 직접 여세요.</li><li><b>친구와 치기 → 코드로 입장</b>에 붙여 넣으세요.</li></ol></div>` : '<button class="btn wide" id="inviteCopy">링크 복사</button>'}
      <p id="inviteStatus" class="invite-status" role="status" aria-live="polite"></p><details class="invite-help"><summary>브라우저가 열리지 않나요?</summary><p>카카오톡 메뉴에서 외부 브라우저로 여세요. 코드 복사가 안 되면 위 코드를 길게 눌러 복사할 수 있어요.</p>${code ? '' : `<input id="inviteLink" readonly aria-label="현재 링크">`}</details><button class="linkbtn invite-stay" id="inviteStay">카카오톡에서 계속하기</button><p class="invite-note">여기서 계속하면 별도로 로그인해야 할 수 있어요.</p></div>`;
    const status = document.getElementById('inviteStatus'), external = document.getElementById('inviteExternal');
    external.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
    external.onclick = () => { if(code)remember(code); status.textContent='열리지 않으면 카카오톡 메뉴에서 외부 브라우저로 열어 주세요.'; };
    if (!code) document.getElementById('inviteLink').value = url;
    document.getElementById('inviteCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(code || url); status.textContent = code ? '코드를 복사했어요. 홈 화면의 홀덤 앱에서 코드로 입장해 주세요.' : '링크를 복사했어요. 평소 쓰는 브라우저에 붙여 넣어 주세요.'; }
      catch { const input = document.getElementById(code ? 'inviteCode' : 'inviteLink'); input.closest('details')?.setAttribute('open',''); input.focus(); input.select(); status.textContent=code ? '복사가 되지 않았어요. 위 코드를 길게 눌러 복사하거나 직접 입력해 주세요.' : '복사가 되지 않았어요. 표시된 링크를 길게 눌러 복사해 주세요.'; }
    };
    document.getElementById('inviteStay').onclick = async ev => {
      const button=ev.currentTarget; button.disabled=true;
      try { await onContinue(code); root.hidden=true; background.forEach(el=>{el.inert=false;}); }
      catch { button.disabled=false; status.textContent='연결하지 못했어요. 다시 누르거나 외부 브라우저로 열어 주세요.'; }
    };
    document.getElementById('inviteTitle').focus({preventScroll:true});
  }
  return { normalize, inKakao, remember, pending, clear, authRoom, handoffUrl, show };
})();
