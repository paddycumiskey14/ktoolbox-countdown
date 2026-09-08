const express = require('express');
const path = require('path');
const sharp = require('sharp');
const Piscina = require('piscina');
const { sanitizeConfig, renderCountdownSVG } = require('./lib/timer-render');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// GIF generation (color quantization + LZW encoding) is synchronous,
// CPU-bound JS -- running it on the main thread would block Express from
// handling any other request for the several seconds it takes. A worker
// pool spreads that work across threads so many opens arriving at once
// (e.g. right after a campaign send) can be generated concurrently instead
// of queueing one-by-one behind each other.
const gifWorkerPool = new Piscina({ filename: path.join(__dirname, 'gif-worker.js') });

// Short-lived cache of rendered GIFs, keyed by the sanitized config. This is
// the main lever for handling large sends: if hundreds or thousands of
// people open the same campaign within the same few-second window, only the
// first request per unique config actually renders -- everyone else within
// that window is served the same cached buffer instantly. `inFlight` also
// dedupes concurrent cache misses so a burst of simultaneous first-opens
// for the same config triggers exactly one render, not one per request.
const GIF_CACHE_TTL_MS = 5000;
const GIF_CACHE_MAX_ENTRIES = 500;
const gifCache = new Map(); // key -> { buffer, expiresAt }
const gifInFlight = new Map(); // key -> Promise<Buffer>

async function getCachedGif(cfg) {
  const key = JSON.stringify(cfg);
  const now = Date.now();

  const cached = gifCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.buffer;
  }

  const pending = gifInFlight.get(key);
  if (pending) {
    return pending;
  }

  const genPromise = gifWorkerPool
    .run(cfg)
    .then((result) => {
      const buffer = Buffer.from(result);
      gifCache.set(key, { buffer, expiresAt: Date.now() + GIF_CACHE_TTL_MS });
      if (gifCache.size > GIF_CACHE_MAX_ENTRIES) {
        gifCache.delete(gifCache.keys().next().value); // evict oldest
      }
      return buffer;
    })
    .finally(() => {
      gifInFlight.delete(key);
    });

  gifInFlight.set(key, genPromise);
  return genPromise;
}

function parseConfigParam(req) {
  try {
    return req.query.config ? JSON.parse(req.query.config) : {};
  } catch (e) {
    return {};
  }
}

// Strong anti-caching headers for the live-ticking preview formats (SVG/PNG)
// so the browser preview's per-second refresh always gets a fresh render.
function setNoCacheHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
}

app.get('/timer.svg', (req, res) => {
  const cfg = sanitizeConfig(parseConfigParam(req));
  const svg = renderCountdownSVG(cfg);
  res.set('Content-Type', 'image/svg+xml');
  setNoCacheHeaders(res);
  res.send(svg);
});

// PNG rendering for email clients (e.g. Outlook desktop) that don't support
// SVG in <img> tags. Rendered at 2x density so it stays crisp on retina
// screens when displayed at its natural CSS size.
app.get('/timer.png', async (req, res) => {
  const cfg = sanitizeConfig(parseConfigParam(req));
  const svg = renderCountdownSVG(cfg);
  try {
    const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
    res.set('Content-Type', 'image/png');
    setNoCacheHeaders(res);
    res.send(png);
  } catch (e) {
    res.status(500).send('Failed to render timer image');
  }
});

// Animated GIF version -- this is what should be used in the actual email
// embed, since it's the only format that can visibly tick down while the
// email is open (see lib/timer-render.js for how/why). Rendered in a
// worker thread and cached for a few seconds (see getCachedGif above) so
// large sends with many opens in a short window don't overwhelm the server.
app.get('/timer.gif', async (req, res) => {
  const cfg = sanitizeConfig(parseConfigParam(req));
  try {
    const gif = await getCachedGif(cfg);
    res.set('Content-Type', 'image/gif');
    // Allow the CDN in front of this app (and any other intermediary cache)
    // to serve repeat requests for the same config directly for a few
    // seconds, matching our in-memory cache window -- this is what lets a
    // burst of simultaneous opens be handled without each one reaching our
    // server at all. stale-while-revalidate lets a cache keep serving the
    // last good copy for a bit longer while a fresh one renders in the
    // background, instead of a slow render blocking that request.
    res.set('Cache-Control', `public, max-age=${GIF_CACHE_TTL_MS / 1000}, s-maxage=${GIF_CACHE_TTL_MS / 1000}, stale-while-revalidate=30`);
    res.send(gif);
  } catch (e) {
    res.status(500).send('Failed to render timer image');
  }
});

app.listen(PORT, () => {
  console.log(`Klavkit Countdown running at http://localhost:${PORT}`);
});
