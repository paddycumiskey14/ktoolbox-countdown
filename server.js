const express = require('express');
const path = require('path');
const sharp = require('sharp');
const { quantize, applyPalette } = require('gifenc');
const { GifWriter } = require('omggif');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const UNIT_ORDER = ['days', 'hours', 'minutes', 'seconds'];

// Layout preset: box dimensions/spacing, plus default font sizes used
// whenever a section hasn't been given an explicit override.
const SIZE_MAP = {
  medium: { numbers: 50, labels: 12, boxW: 96, boxH: 90, gap: 18, pad: 30 },
};

// Single-quoted font names so these strings can be safely embedded inside
// a double-quoted SVG attribute without escaping.
const FONT_STACKS = {
  sans: 'Arial, Helvetica, sans-serif',
  serif: "'Times New Roman', Times, serif",
};

const FONT_WEIGHTS = {
  normal: 400,
  bold: 700,
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function sanitizeColor(value, fallback) {
  return typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim() : fallback;
}

function sanitizeFontFamily(value, fallback) {
  return typeof value === 'string' && FONT_STACKS[value] ? value : fallback;
}

function sanitizeFontWeight(value, fallback) {
  return typeof value === 'string' && FONT_WEIGHTS[value] ? value : fallback;
}

function sanitizeConfig(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const cfg = {};

  // target: must be a valid, parseable date
  const targetDate = new Date(raw.target);
  cfg.target = isNaN(targetDate.getTime()) ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : targetDate.toISOString();

  cfg.layoutSize = 'medium';

  // numbers (the digits themselves)
  const rawNumbers = raw.numbers && typeof raw.numbers === 'object' ? raw.numbers : {};
  cfg.numbers = {
    color: sanitizeColor(rawNumbers.color, '#C4FF3D'),
    fontFamily: sanitizeFontFamily(rawNumbers.fontFamily, 'sans'),
    fontWeight: sanitizeFontWeight(rawNumbers.fontWeight, 'bold'),
  };

  // number box (the tile behind each digit)
  const rawNumberBox = raw.numberBox && typeof raw.numberBox === 'object' ? raw.numberBox : {};
  cfg.numberBox = {
    color: sanitizeColor(rawNumberBox.color, '#111111'),
    shape: ['square', 'rounded', 'circle'].includes(rawNumberBox.shape) ? rawNumberBox.shape : 'square',
  };

  // labels (the DAYS / HOURS / MINUTES / SECONDS captions under each box)
  const rawLabels = raw.labels && typeof raw.labels === 'object' ? raw.labels : {};
  cfg.labels = {
    enabled: rawLabels.enabled !== false,
    fontFamily: sanitizeFontFamily(rawLabels.fontFamily, 'sans'),
    fontWeight: sanitizeFontWeight(rawLabels.fontWeight, 'normal'),
    color: sanitizeColor(rawLabels.color, '#6b7280'),
  };

  // background
  const rawBackground = raw.background && typeof raw.background === 'object' ? raw.background : {};
  cfg.background = {
    style: rawBackground.style === 'transparent' ? 'transparent' : 'solid',
    color: sanitizeColor(rawBackground.color, '#ffffff'),
  };

  cfg.units = UNIT_ORDER.slice();

  cfg.expiredText = "Offer's expired";

  return cfg;
}

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[c]));
}

function fontStack(key) {
  return FONT_STACKS[key] || FONT_STACKS.sans;
}

function fontWeightValue(key) {
  return FONT_WEIGHTS[key] || FONT_WEIGHTS.normal;
}

function boxCornerRadius(shape, boxW, boxH) {
  if (shape === 'square') return 0;
  if (shape === 'circle') return Math.min(boxW, boxH) / 2;
  return Math.round(Math.min(boxW, boxH) * 0.12); // 'rounded'
}

function computeValues(totalSeconds) {
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

// Shared geometry between the static SVG renderer and the GIF frame cropper
// below, so box positions/sizes never drift out of sync between the two.
function layoutFor(cfg) {
  const size = SIZE_MAP.medium;
  const units = cfg.units;
  const boxesWidth = units.length * size.boxW + (units.length - 1) * size.gap;
  const width = boxesWidth + size.pad * 2;
  const labelsBlockHeight = cfg.labels.enabled ? size.labels + 16 : 8;
  const height = size.pad + size.boxH + labelsBlockHeight + size.pad;
  const boxesTop = size.pad;
  return { size, units, boxesWidth, width, height, boxesTop };
}

function renderCountdownSVG(cfg, secondsOverride) {
  let totalSeconds;
  if (typeof secondsOverride === 'number') {
    totalSeconds = Math.max(0, Math.floor(secondsOverride));
  } else {
    const now = new Date();
    const target = new Date(cfg.target);
    const diffMs = Math.max(0, target.getTime() - now.getTime());
    totalSeconds = Math.floor(diffMs / 1000);
  }
  const expired = totalSeconds <= 0;

  const values = computeValues(totalSeconds);

  const { size, units, width, height, boxesTop } = layoutFor(cfg);

  const numbersColor = cfg.numbers.color;
  const numbersFont = fontStack(cfg.numbers.fontFamily);
  const numbersWeight = fontWeightValue(cfg.numbers.fontWeight);
  const numbersSize = size.numbers;

  const boxColor = cfg.numberBox.color;
  const boxRadius = boxCornerRadius(cfg.numberBox.shape, size.boxW, size.boxH);

  const labelsColor = cfg.labels.color;
  const labelsFont = fontStack(cfg.labels.fontFamily);
  const labelsWeight = fontWeightValue(cfg.labels.fontWeight);
  const labelsSize = size.labels;

  let boxesSvg = '';
  units.forEach((unit, i) => {
    const x = size.pad + i * (size.boxW + size.gap);
    const y = boxesTop;
    const value = String(values[unit]).padStart(2, '0');
    const unitLabel = unit.charAt(0).toUpperCase() + unit.slice(1);
    boxesSvg += `
      <rect x="${x}" y="${y}" width="${size.boxW}" height="${size.boxH}" rx="${boxRadius}" fill="${boxColor}" />
      <text x="${x + size.boxW / 2}" y="${y + size.boxH / 2 + numbersSize * 0.32}" font-family="${numbersFont}" font-size="${numbersSize}" font-weight="${numbersWeight}" fill="${numbersColor}" text-anchor="middle">${value}</text>
      ${cfg.labels.enabled ? `<text x="${x + size.boxW / 2}" y="${y + size.boxH + labelsSize + 10}" font-family="${labelsFont}" font-size="${labelsSize}" font-weight="${labelsWeight}" fill="${labelsColor}" text-anchor="middle" letter-spacing="1">${unitLabel.toUpperCase()}</text>` : ''}
    `;
  });

  let body;
  if (expired) {
    body = `<text x="${width / 2}" y="${height / 2 + 8}" font-family="${numbersFont}" font-size="${numbersSize * 0.6}" font-weight="${numbersWeight}" fill="${numbersColor}" text-anchor="middle">${escapeXml(cfg.expiredText)}</text>`;
  } else {
    body = boxesSvg;
  }

  const bgRect = cfg.background.style === 'transparent' ? '' : `<rect width="100%" height="100%" fill="${cfg.background.color}" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${bgRect}
    ${body}
  </svg>`;
}

// Animated GIF rendering, so the timer visibly ticks down while an email is
// open on screen (email clients block JavaScript, so this is done the same
// way other email countdown timer services do it: bake real per-second
// frames into the GIF itself and let the image format's own animation play
// them back). To keep frame count/file size bounded for far-off targets,
// only up to MAX_GIF_FRAMES seconds of true per-second ticking are baked
// in, starting from "now" (the moment the image is fetched). If the target
// is further away than that, the animation plays through that window of
// real ticking and then holds on the last frame -- if it's closer than
// that, the animation ticks all the way down to the expired frame and
// holds there.
//
// Only the digit box(es) whose value actually changed between two ticks are
// re-encoded each frame (background/box art/labels are drawn once and left
// in place) -- this is what keeps file size small, since re-encoding the
// full canvas on every single frame (as a naive GIF encoder would) produces
// files that are an order of magnitude larger for no visual benefit.
const MAX_GIF_FRAMES = 90; // 1.5 minutes of per-second ticking -- generation
// time scales with frame count and needs to stay well under typical image
// fetch timeouts (email proxies, browsers, Klaviyo's preview), especially
// on slower hosting CPUs.
const GIF_DENSITY = 144; // matches renderCountdownSVG's raster density
const GIF_SCALE = GIF_DENSITY / 72; // raster pixels per SVG unit at that density

function padPaletteToPowerOfTwo(palette) {
  const padded = palette.slice();
  let target = 2;
  while (target < padded.length) target *= 2;
  while (padded.length < target) padded.push(padded[padded.length - 1] || [0, 0, 0, 0]);
  return padded;
}

async function rasterizeCrop(svg, cropRect) {
  let pipeline = sharp(Buffer.from(svg), { density: GIF_DENSITY }).ensureAlpha();
  if (cropRect) pipeline = pipeline.extract(cropRect);
  return pipeline.raw().toBuffer({ resolveWithObject: true });
}

async function renderCountdownGIF(cfg) {
  const now = new Date();
  const target = new Date(cfg.target);
  const diffMs = Math.max(0, target.getTime() - now.getTime());
  const totalSeconds = Math.floor(diffMs / 1000);

  const frameCount = Math.max(1, Math.min(totalSeconds, MAX_GIF_FRAMES - 1) + 1);

  const layout = layoutFor(cfg);
  const isTransparentBg = cfg.background.style === 'transparent';
  const paletteFormat = isTransparentBg ? 'rgba4444' : 'rgb565';

  // Work out each frame's crop rect up front (cheap, no rasterization yet),
  // so the actual rasterization below can happen in parallel across frames
  // instead of one-at-a-time -- this is the main lever for keeping total
  // generation time low on slower hosting CPUs.
  const frameDescriptors = [];
  let previousValues = computeValues(totalSeconds);
  for (let i = 0; i < frameCount; i++) {
    const remaining = totalSeconds - i;
    const values = computeValues(remaining);
    const justExpired = remaining <= 0;

    let cropRectSvg;
    if (i === 0 || justExpired) {
      cropRectSvg = { left: 0, top: 0, width: layout.width, height: layout.height };
    } else {
      const changedIndex = layout.units.findIndex((unit) => values[unit] !== previousValues[unit]);
      const startIndex = changedIndex === -1 ? layout.units.length - 1 : changedIndex;
      const x = layout.size.pad + startIndex * (layout.size.boxW + layout.size.gap);
      const rectWidth = layout.boxesWidth - startIndex * (layout.size.boxW + layout.size.gap);
      cropRectSvg = { left: x, top: layout.boxesTop, width: rectWidth, height: layout.size.boxH };
    }

    const cropRectPx = {
      left: Math.round(cropRectSvg.left * GIF_SCALE),
      top: Math.round(cropRectSvg.top * GIF_SCALE),
      width: Math.round(cropRectSvg.width * GIF_SCALE),
      height: Math.round(cropRectSvg.height * GIF_SCALE),
    };

    frameDescriptors.push({ remaining, cropRectPx, isFull: i === 0 || justExpired });
    previousValues = values;
    if (justExpired) {
      frameDescriptors.length = i + 1; // don't render anything past expiry
      break;
    }
  }

  const rasterResults = await Promise.all(
    frameDescriptors.map((desc) => {
      const svg = renderCountdownSVG(cfg, desc.remaining);
      return rasterizeCrop(svg, desc.isFull ? undefined : desc.cropRectPx);
    })
  );

  const width = rasterResults[0].info.width;
  const height = rasterResults[0].info.height;

  const rawPalette = quantize(
    rasterResults[0].data,
    isTransparentBg ? 255 : 256,
    isTransparentBg ? { format: 'rgba4444', oneBitAlpha: true } : { format: 'rgb565' }
  );
  const palette = padPaletteToPowerOfTwo(rawPalette);
  const paletteInts = palette.map((c) => ((c[0] & 0xff) << 16) | ((c[1] & 0xff) << 8) | (c[2] & 0xff));
  const transparentIndex = isTransparentBg ? palette.findIndex((c) => c.length === 4 && c[3] === 0) : -1;

  const buf = [];
  const gif = new GifWriter(buf, width, height, { palette: paletteInts });

  frameDescriptors.forEach((desc, i) => {
    const { data } = rasterResults[i];
    const index = applyPalette(data, palette, paletteFormat);
    const rect = desc.isFull ? { left: 0, top: 0, width, height } : desc.cropRectPx;
    gif.addFrame(rect.left, rect.top, rect.width, rect.height, index, {
      delay: 100, // centiseconds (GIF's native unit) = 1 second
      disposal: 1, // leave in place, so later partial frames layer on top
      transparent: transparentIndex >= 0 ? transparentIndex : undefined,
    });
  });

  gif.end();
  return Buffer.from(buf);
}

function parseConfigParam(req) {
  try {
    return req.query.config ? JSON.parse(req.query.config) : {};
  } catch (e) {
    return {};
  }
}

// Strong anti-caching headers so email clients/proxies (e.g. Gmail's image
// proxy) always re-fetch a fresh render instead of serving a stale snapshot.
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
// email is open (see renderCountdownGIF above for how/why).
app.get('/timer.gif', async (req, res) => {
  const cfg = sanitizeConfig(parseConfigParam(req));
  try {
    const gif = await renderCountdownGIF(cfg);
    res.set('Content-Type', 'image/gif');
    setNoCacheHeaders(res);
    res.send(gif);
  } catch (e) {
    res.status(500).send('Failed to render timer image');
  }
});

app.listen(PORT, () => {
  console.log(`Klavkit Countdown running at http://localhost:${PORT}`);
});
