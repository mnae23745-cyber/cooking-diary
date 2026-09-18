// 인터넷이 없어도 앱이 열리게 파일을 폰에 저장해두는 역할 (service worker)
// 인터넷이 되면 항상 최신 파일을 먼저 받고, 안 될 때만 저장본을 씀.
const CACHE = "cooking-diary-v9";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.includes("/api/")) return; // server.py 전용 요청은 건드리지 않음

  const cacheKey = req.mode === "navigate" ? "./index.html" : req; // 공유로 열린 ?url=... 도 같은 화면
  e.respondWith(
    fetch(new Request(req, { cache: "no-cache" }))
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(cacheKey, copy));
        }
        return res;
      })
      .catch(() => caches.match(cacheKey))
  );
});
