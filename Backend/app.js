// Backend/app.js
// Express application shared by the local server (server.js) and the Vercel
// serverless entry point (api/index.js). It never calls listen() itself.

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const twilio = require('twilio');
const nodemailer = require('nodemailer');

// Load Backend/.env for local runs. On Vercel the platform injects real env vars.
const envPath = path.join(__dirname, '.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  SMTP_EMAIL,
  SMTP_PASSWORD,
  ALERTS_ENABLED = '',
  ALERT_API_KEY = '',
  ALLOWED_ORIGINS = ''
} = process.env;

// Real dispatch is opt-in. It needs both a server-side switch and a key that
// trusted callers send in the x-alert-key header; nothing reaches the browser.
const alertsRequested = ALERTS_ENABLED.trim().toLowerCase() === 'true';
const alertsActive = alertsRequested && ALERT_API_KEY.length > 0;
if (alertsRequested && !alertsActive) {
  console.warn(
    '[WARN] ALERTS_ENABLED=true but ALERT_API_KEY is empty. Alerts stay disabled.'
  );
}

// Hash both sides first so timingSafeEqual gets equal-length buffers and the
// comparison does not leak the key length.
function isValidAlertKey(provided) {
  if (!alertsActive || typeof provided !== 'string' || !provided) return false;
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(provided), digest(ALERT_API_KEY));
}

// Alert channels are optional: the API still runs (and reports clearly) when
// credentials are absent instead of crashing at startup.
const smsClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

const emailTransporter =
  SMTP_EMAIL && SMTP_PASSWORD
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: SMTP_EMAIL, pass: SMTP_PASSWORD }
      })
    : null;

const app = express();

if (process.env.VERCEL) app.set('trust proxy', 1);

const DATA_FILE_NAME = 'assam_comprehensive_health_data.csv';

// Vercel does not guarantee that a required module keeps its repo path inside
// the function bundle, so __dirname alone is not safe. `includeFiles` keeps the
// repo-relative layout under process.cwd() (/var/task); __dirname covers local
// runs and builds that preserve the source tree.
const DATA_FILE_CANDIDATES = [
  path.join(__dirname, 'data', DATA_FILE_NAME),
  path.join(process.cwd(), 'Backend', 'data', DATA_FILE_NAME),
  path.join(process.cwd(), 'data', DATA_FILE_NAME)
];

let dataset = [];
let datasetPromise = null;

// Same-origin is always allowed; extra origins come from ALLOWED_ORIGINS.
const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  ...ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
]);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header = same-origin navigation, curl, or server-to-server.
      callback(null, !origin || allowedOrigins.has(origin));
    }
  })
);
app.use(express.json({ limit: '16kb' }));

// Vercel serves Frontend/ from its CDN; local runs use this static mount.
if (!process.env.VERCEL) {
  const frontendDir = path.join(__dirname, '..', 'Frontend');
  if (fs.existsSync(frontendDir)) app.use(express.static(frontendDir));
}

// -------------------- Dataset --------------------

function convertRow(row) {
  const converted = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === '' || value === null || value === undefined) {
      converted[key] = null;
      continue;
    }
    const num = Number(value);
    if (!Number.isNaN(num) && String(value).trim() !== '') {
      converted[key] = num;
    } else {
      converted[key] = value;
    }
  }
  return converted;
}

function loadDataset() {
  return new Promise((resolve) => {
    const filePath = DATA_FILE_CANDIDATES.find((candidate) =>
      fs.existsSync(candidate)
    );

    if (!filePath) {
      console.warn(
        `[WARN] CSV not found. Tried: ${DATA_FILE_CANDIDATES.join(' | ')}`
      );
      dataset = [];
      return resolve(dataset);
    }

    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => results.push(convertRow(row)))
      .on('end', () => {
        dataset = results;
        console.log(`[INFO] Loaded ${dataset.length} records from ${filePath}`);
        resolve(dataset);
      })
      .on('error', (err) => {
        console.error('[ERROR] Failed to read CSV:', err.message);
        dataset = [];
        resolve(dataset);
      });
  });
}

// Parsed once per process (cold start on serverless) and reused afterwards.
function ensureDataset() {
  if (!datasetPromise) datasetPromise = loadDataset();
  return datasetPromise;
}

function computeStats() {
  const stats = {
    totalRecords: dataset.length,
    averageRainfall: null,
    minRainfall: null,
    maxRainfall: null,
    floodStatus: {},
    stagnantWaterRiskDistribution: {},
    totalDiarrheaCases: 0
  };

  if (!dataset.length) return stats;

  let rainfallSum = 0;
  let rainfallCount = 0;
  let minR = Infinity;
  let maxR = -Infinity;

  dataset.forEach((row) => {
    const r = Number(row.Rainfall_mm);
    if (!Number.isNaN(r)) {
      rainfallSum += r;
      rainfallCount++;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }

    const flood = (row.Flood_Status || 'Unknown').toString();
    stats.floodStatus[flood] = (stats.floodStatus[flood] || 0) + 1;

    const stagnant = (row.Stagnant_Water_Risk || 'Unknown').toString();
    stats.stagnantWaterRiskDistribution[stagnant] =
      (stats.stagnantWaterRiskDistribution[stagnant] || 0) + 1;

    const dia = Number(row.Cases_Diarrhea_ADD);
    if (!Number.isNaN(dia)) stats.totalDiarrheaCases += dia;
  });

  if (rainfallCount > 0) {
    stats.averageRainfall = rainfallSum / rainfallCount;
    stats.minRainfall = minR;
    stats.maxRainfall = maxR;
  }

  return stats;
}

function calculateRisk({ Rainfall_mm, Flood_Status, Stagnant_Water_Risk }) {
  let score = 0;

  const rain = Number(Rainfall_mm);
  const flood = (Flood_Status || '').toString().trim().toLowerCase();
  const stagnant = (Stagnant_Water_Risk || '').toString().trim().toLowerCase();

  if (!Number.isNaN(rain) && rain > 50) score += 2;
  if (flood === 'yes') score += 3;
  if (stagnant === 'high') score += 2;

  let level = 'Low';
  if (score >= 5) level = 'High';
  else if (score >= 3) level = 'Medium';

  return {
    Rainfall_mm: Number.isNaN(rain) ? null : rain,
    Flood_Status,
    Stagnant_Water_Risk,
    riskScore: score,
    riskLevel: level
  };
}

// -------------------- Input helpers --------------------

function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizePhone(value) {
  const raw = cleanString(value, 25);
  if (!raw || raw.toUpperCase() === 'N/A') return null;
  const compact = raw.replace(/[\s().-]/g, '');
  return /^\+?\d{7,15}$/.test(compact) ? compact : null;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]
  );
}

// Small in-memory throttle so the public alert endpoint cannot be used as an
// SMS/email relay. Per instance on serverless, which is acceptable here.
const alertHits = new Map();
const ALERT_LIMIT = 5;
const ALERT_WINDOW_MS = 10 * 60 * 1000;

function isAlertRateLimited(ip) {
  const now = Date.now();
  const hits = (alertHits.get(ip) || []).filter((t) => now - t < ALERT_WINDOW_MS);
  if (hits.length >= ALERT_LIMIT) {
    alertHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  alertHits.set(ip, hits);
  if (alertHits.size > 1000) {
    for (const [key, times] of alertHits) {
      if (!times.some((t) => now - t < ALERT_WINDOW_MS)) alertHits.delete(key);
    }
  }
  return false;
}

// -------------------- Routes --------------------

app.get('/api/health', async (req, res) => {
  await ensureDataset();
  res.json({
    message: 'HackIgnite water risk backend is running.',
    records: dataset.length,
    alertsEnabled: alertsActive,
    smsConfigured: Boolean(smsClient),
    emailConfigured: Boolean(emailTransporter)
  });
});

app.get('/api/data', async (req, res) => {
  await ensureDataset();
  res.json(dataset);
});

app.get('/api/stats', async (req, res) => {
  await ensureDataset();
  res.json(computeStats());
});

app.post('/api/predict', (req, res) => {
  const { Rainfall_mm, Flood_Status, Stagnant_Water_Risk } = req.body || {};

  if (
    Rainfall_mm === undefined ||
    Flood_Status === undefined ||
    Stagnant_Water_Risk === undefined
  ) {
    return res.status(400).json({
      error: 'Missing fields. Required: Rainfall_mm, Flood_Status, Stagnant_Water_Risk'
    });
  }

  const rainfall = Number(Rainfall_mm);
  if (!Number.isFinite(rainfall) || rainfall < 0) {
    return res.status(400).json({
      error: 'Rainfall_mm must be a non-negative number.'
    });
  }

  const flood = cleanString(Flood_Status, 40);
  const stagnant = cleanString(Stagnant_Water_Risk, 40);
  if (!flood || !stagnant) {
    return res.status(400).json({
      error: 'Flood_Status and Stagnant_Water_Risk must be non-empty strings.'
    });
  }

  res.json(
    calculateRisk({
      Rainfall_mm: rainfall,
      Flood_Status: flood,
      Stagnant_Water_Risk: stagnant
    })
  );
});

app.post('/api/send-alert', async (req, res) => {
  const body = req.body || {};

  const name = cleanString(body.name, 80) || 'Citizen';
  const area = cleanString(body.area, 120) || 'Unknown area';
  const riskLevel = cleanString(body.riskLevel, 20).toUpperCase() || 'UNKNOWN';
  const riskScore = cleanString(String(body.riskScore ?? ''), 10) || 'n/a';
  const symptoms = Array.isArray(body.symptoms)
    ? body.symptoms
        .filter((s) => typeof s === 'string')
        .map((s) => cleanString(s, 60))
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const symptomList = symptoms.length ? symptoms.join(', ') : 'No symptoms';

  const rawPhone = cleanString(body.phone, 25);
  const phone = normalizePhone(rawPhone);
  if (rawPhone && rawPhone.toUpperCase() !== 'N/A' && !phone) {
    return res.status(400).json({ success: false, error: 'Invalid phone number.' });
  }

  const email = cleanString(body.email, 200);
  if (email && !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address.' });
  }

  if (!phone && !email) {
    return res.status(400).json({
      success: false,
      error: 'Provide a phone number or email address.'
    });
  }

  const channels = { sms: null, email: null };

  // Public demo default: no real SMS/email. Truthful 503 so the UI and any
  // caller can tell the difference between "off" and "misconfigured".
  if (!alertsActive) {
    return res.status(503).json({
      success: false,
      code: 'ALERTS_DISABLED',
      error:
        'Alert dispatch is disabled in this deployment. Prediction, analytics and dataset APIs remain available.',
      channels
    });
  }

  // Before the key check so repeated guesses are limited too. Per instance on
  // serverless: cold starts and other regions keep separate counters.
  if (isAlertRateLimited(req.ip || 'unknown')) {
    return res.status(429).json({
      success: false,
      error: 'Too many alerts from this client. Try again later.',
      channels
    });
  }

  if (!isValidAlertKey(req.get('x-alert-key'))) {
    return res.status(401).json({
      success: false,
      code: 'ALERT_AUTH_REQUIRED',
      error: 'A valid x-alert-key header is required to send alerts.',
      channels
    });
  }

  const canSms = Boolean(phone && smsClient);
  const canEmail = Boolean(email && emailTransporter);

  if (!canSms && !canEmail) {
    const missing = [phone && 'SMS', email && 'email'].filter(Boolean);
    return res.status(503).json({
      success: false,
      error: `Delivery not configured (${missing.join(
        ', '
      )}). Set the Twilio / SMTP environment variables.`,
      channels
    });
  }

  // Channels are independent: a bad phone number must not block the email.
  if (canSms) {
    try {
      await smsClient.messages.create({
        body: `ALERT: ${name} from ${area} reported symptoms: ${symptomList}. Risk Level: ${riskLevel} (Score: ${riskScore}).`,
        from: TWILIO_PHONE_NUMBER,
        to: phone
      });
      channels.sms = 'sent';
      console.log('[INFO] SMS sent.');
    } catch (error) {
      channels.sms = 'failed';
      console.error('[ERROR] SMS failed:', error.message);
    }
  }

  if (canEmail) {
    try {
      await emailTransporter.sendMail({
        from: `HackIgnite Alerts <${SMTP_EMAIL}>`,
        to: email,
        subject: 'Your Health Risk Assessment',
        html: `
          <h2>Health Risk Report</h2>
          <p>Hello <b>${escapeHtml(name)}</b>,</p>
          <p>Here is your health summary:</p>
          <ul>
            <li><b>Area:</b> ${escapeHtml(area)}</li>
            <li><b>Symptoms:</b> ${escapeHtml(symptomList)}</li>
            <li><b>Risk Level:</b> ${escapeHtml(riskLevel)}</li>
            <li><b>Risk Score:</b> ${escapeHtml(riskScore)}</li>
          </ul>
          <p>Please stay safe and hydrated.</p>
        `
      });
      channels.email = 'sent';
      console.log('[INFO] Email sent.');
    } catch (error) {
      channels.email = 'failed';
      console.error('[ERROR] Email failed:', error.message);
    }
  }

  const sent = Object.keys(channels).filter((c) => channels[c] === 'sent');
  const failed = Object.keys(channels).filter((c) => channels[c] === 'failed');

  if (!sent.length) {
    return res.status(502).json({
      success: false,
      error: `${failed.join(' + ') || 'Delivery'} failed`,
      channels
    });
  }

  return res.json({
    success: true,
    message: `Alert sent via ${sent.join(' + ')}${
      failed.length ? ` (${failed.join(', ')} failed)` : ''
    }`,
    channels
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

// JSON errors instead of Express' default HTML error page.
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message
  });
});

module.exports = app;
