// 선택값은 이미지 주소 대신 0~7 번호만 받는다. 사람 아바타를 고르며 AI 초상은 유지한다.
const Avatar = (() => {
  const names = ['안경 남성', '단발 여성', '대머리 남성', '단발 여성', '캡모자 남성', '베레모 여성', '수염 남성', '안경 여성'];
  const builds = ['슬림', '슬림', '통통', '통통', '통통', '슬림', '보통', '통통'];
  const valid = id => Number.isInteger(id) && id >= 0 && id < names.length;
  function src(name, uid, choice, human = false) {
    if (valid(choice)) return `assets/avatars/people/p-${choice}.webp`;
    const i = uid || human ? -1 : NAME_POOL.indexOf(name);
    if (i >= 0) return `assets/avatars/ai-${i}.webp`;
    let h = 0; for (const c of String(uid || name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `assets/avatars/people/p-${h % names.length}.webp`;
  }
  const label = id => valid(id) ? `${names[id]} · ${builds[id]}` : '자동 선택';
  return { names, builds, label, valid, src };
})();
