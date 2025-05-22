// 파일: sw.js
// 이 파일을 GitHub Pages 루트에 함께 올리시면,
// wom_auto.html에서 scope './'로 등록되어 적용됩니다.

const CACHE_NAME = 'wom-cache-v1';

function shouldCache(req) {
  const url = new URL(req.url);
  // manifest JSON 응답
  if (url.searchParams.get('manifest') === 'true') return true;
  // 이미지 응답
  if (req.destination === 'image') return true;
  return false;
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (!shouldCache(req)) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(req).then(resp =>
        resp ||
        fetch(req).then(networkRes => {
          cache.put(req, networkRes.clone());
          return networkRes;
        })
      )
    )
  );
});