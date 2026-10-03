// 앱 설치(PWA)용 서비스 워커. 인터넷이 되면 항상 새 파일을 먼저 받고(화면과 엔진 버전이 섞이지 않게),
// 안 되면 저장해 둔 파일로 혼자 하기를 계속한다. 다른 출처(Supabase·CDN·폰트)는 건드리지 않는다
const CACHE = 'holdem-v1';
const CHIPS = [100, 500, 1000, 5000, 25000].flatMap(v => [0, 1].map(i => `./assets/chips/chip-${v}-${i}.png`));
const CORE = ['./', './index.html', './engine.js', './games/holdem.js', './games/badugi.js', './ui/holdem-ui.js', './ui/badugi-ui.js', './manifest.webmanifest', './assets/room.jpg', './assets/felt.jpg', './icons/icon-192.png', ...CHIPS];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // 화면(html)과 코드(js)는 매번 서버에 새 버전인지 물어본다 (브라우저 캐시 10분 때문에 배포 직후에도 옛 화면이 뜨지 않게). 그림·글꼴·소리는 그대로
  const fresh = e.request.mode === 'navigate' || /\.(html|js)$/.test(new URL(e.request.url).pathname);
  e.respondWith(fetch(fresh ? new Request(e.request, { cache: 'no-cache' }) : e.request)
    .then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
