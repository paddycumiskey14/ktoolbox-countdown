const express = require('express');
const path = require('path');
const sharp = require('sharp');

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

function renderCountdownSVG(cfg) {
  const now = new Date();
  const target = new Date(cfg.target);
  let diffMs = target.getTime() - now.getTime();
  const expired = diffMs <= 0;
  if (expired) diffMs = 0;

  const totalSeconds = Math.floor(diffMs / 1000);
  const values = {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };

  const size = SIZE_MAP.medium;

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

  const units = cfg.units;
  const boxesWidth = units.length * size.boxW + (units.length - 1) * size.gap;
  const width = boxesWidth + size.pad * 2;

  const labelsBlockHeight = cfg.labels.enabled ? labelsSize + 16 : 8;
  const height = size.pad + size.boxH + labelsBlockHeight + size.pad;

  const boxesTop = size.pad;

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

function parseConfigParam(req) {
  try {
    return req.query.config ? JSON.parse(req.query.config) : {};
  } catch (e) {
    return {};
  }
}

app.get('/timer.svg', (req, res) => {
  const cfg = sanitizeConfig(parseConfigParam(req));
  const svg = renderCountdownSVG(cfg);
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'no-store');
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
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (e) {
    res.status(500).send('Failed to render timer image');
  }
});

app.listen(PORT, () => {
  console.log(`Klavkit Countdown running at http://localhost:${PORT}`);
});
