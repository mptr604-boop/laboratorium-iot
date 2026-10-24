// src/utils/csrf.js
// Ochrona CSRF dla żądań zmieniających stan (wszystko poza GET/HEAD/OPTIONS).
// Przeglądarka sama dopisuje nagłówki Sec-Fetch-Site i Origin, a strona z innej domeny nie może ich podrobić.
// Żądanie bez żadnego z nich pochodzi spoza przeglądarki (curl, skrypt), a CSRF wymaga przeglądarki ofiary.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isCrossSiteRequest(req) {
  if (SAFE_METHODS.has(req.method)) return false;

  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite) return fetchSite !== 'same-origin';

  const origin = req.headers['origin'];
  if (origin) {
    try {
      return new URL(origin).host !== req.headers['host'];
    } catch {
      return true; // np. "null" z sandboxowanego iframe
    }
  }
  return false;
}
