// 선택값은 이미지 주소 대신 0~7 번호만 받는다. 기존 자동 아바타·AI 초상도 유지한다.
const Avatar = (() => {
  const names = ['여우', '부엉이', '검은 고양이', '곰', '늑대', '토끼', '호랑이', '까마귀'];
  const valid = id => Number.isInteger(id) && id >= 0 && id < names.length;
  function src(name, uid, choice, human = false) {
    if (valid(choice)) return `assets/avatars/p-${choice}.webp`;
    const i = uid || human ? -1 : NAME_POOL.indexOf(name);
    if (i >= 0) return `assets/avatars/ai-${i}.webp`;
    let h = 0; for (const c of String(uid || name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `assets/avatars/p-${h % names.length}.webp`;
  }
  return { names, valid, src };
})();
