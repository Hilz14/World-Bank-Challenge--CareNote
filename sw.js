// GOLDNexus CareNote offline cache.
// Same-site files: network first, so updates show while online; cached copy when offline.
// Runtime files from CDNs: cache first.
// Hugging Face model files are skipped here because Transformers.js caches them itself.
const CACHE = 'goldnexus-carenote-v3';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => (k.startsWith('goldnexus-carenote') || k.startsWith('ondera-scribe')) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function save(req, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/(^|\.)huggingface\.co$|(^|\.)hf\.co$/.test(url.hostname)) return;

  if (url.origin === self.location.origin) {
    // Always check GitHub for a newer copy while online, instead of using the browser's 10 minute saved copy.
    e.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => save(req, res))
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => save(req, res)))
  );
});
