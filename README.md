# SafeSip

**Community water-safety intelligence — citizen reports, environmental risk scoring, and a district-level analytics workspace for water-borne disease early warning.**

[**Live Demo**](https://safesip-live.vercel.app/) · [**Source Code**](https://github.com/Techproking06/SafeSip)

SafeSip is a full-stack prototype built for **HackIgnite (MITS_HI25_001)**. It combines a citizen symptom-reporting form, a transparent environmental risk model, and an analytics dashboard over **2,880 monthly surveillance records** from six districts of Assam (2014–2023).

---

## Table of contents

- [Problem](#problem)
- [Solution](#solution)
- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [API](#api)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Limitations](#limitations)
- [Future scope](#future-scope)
- [Team](#team)

---

## Problem

Water-borne diseases such as diarrhoea, cholera, typhoid and hepatitis remain a recurring public-health burden in flood-prone regions. The warning signs are usually scattered across disconnected sources: rainfall and flood records, stagnant-water reports, water-source conditions, and symptom reports from clinics and field workers.

Without a shared operating picture, outbreaks are often recognised only after cases have already clustered — when response is reactive instead of preventive.

## Solution

SafeSip puts the signals in one place:

1. A citizen or field worker submits symptoms, water-source details and local conditions.
2. A transparent rule-based model scores environmental risk from rainfall, flood status and stagnant-water risk.
3. A live analytics workspace turns the historical surveillance dataset into charts, rankings, filters and a district hotspot map.
4. Responders get a prioritised view of where risk is concentrating, with optional SMS/email alert delivery that stays disabled unless explicitly configured.

Every chart, table and score is produced from the bundled dataset or the risk model at request time — there are no mock API responses.

---

## Features

- **Citizen health report** — validated form (name, age, area, contact, water source, hygiene score, concerns) that returns a risk readout with a visible factor breakdown and a session ID.
- **Transparent risk model** — rainfall > 50 mm adds 2 points, flood status `Yes` adds 3, stagnant-water risk `High` adds 2; `>= 5` is High, `>= 3` Medium, otherwise Low.
- **Analytics workspace** — KPI cards, click-to-focus filtering (by district or disease), nine Chart.js visualisations (rainfall over records, flood and stagnant-water distributions, disease totals, district and block rankings, geo-type split, and two rainfall-versus-cases comparisons), plus a 50-row dataset preview.
- **District hotspot map** — an interactive SVG map of Assam districts driven by the same filtered dataset.
- **Environmental panel and IoT simulation** — turbidity, pH and TDS readings with a live-style feed. These panels are labelled simulations and run entirely in the browser.
- **Responsive navigation** — a semicircular scroll progress rail with keyboard-accessible section markers.
- **Smooth scrolling with fallback** — Lenis is loaded from a CDN; native scrolling is used when it is unavailable or when the visitor prefers reduced motion.
- **Optional alert dispatch** — Twilio SMS and Gmail SMTP, disabled by default, key-gated and rate limited.
- **Tested API** — ten integration tests against the real Express app and CSV using Node's built-in test runner.

---

## Architecture

```text
Browser
  │
  ├── /                  Frontend/index.html       landing, report form, simulations, team
  ├── /dashboard.html    Frontend/dashboard.html   full analytics workspace
  └── /api/*             Vercel Function
                            │
                            └── api/index.js
                                  └── Backend/app.js      Express app
                                        ├── Backend/data/assam_comprehensive_health_data.csv
                                        ├── Twilio (optional)
                                        └── Gmail SMTP (optional)
```

`Backend/app.js` is the single Express application. It is reused by two entry points:

| Entry point | Purpose |
| --- | --- |
| `Backend/server.js` | Local development. Also serves `Frontend/` statically. |
| `api/index.js` | Vercel serverless function. Restores the `/api/*` path and delegates to the app. |

### Data flow

1. The frontend loads `index.html` or `dashboard.html` from the CDN.
2. On load, the page fetches `/api/data`; the landing page also fetches `/api/stats`. The API parses the CSV once per process and reuses it.
3. `analytics.js` aggregates the filtered records in the browser and renders the charts and table; the hotspot map consumes the same aggregated district risk.
4. A citizen report is scored by `POST /api/predict`, and the result is rendered as a risk card.
5. If alerts are explicitly enabled and a trusted caller supplies `x-alert-key`, `POST /api/send-alert` dispatches SMS/email and reports per-channel results truthfully.

The frontend uses relative API paths (`/api/...`), so the same-origin deployment needs no API base URL configuration.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Semantic HTML, hand-written CSS, vanilla JavaScript |
| Data visualisation | Chart.js 4.4.7 (CDN), custom SVG district map |
| Motion | Lenis 1.1.18 (CDN), SVG scroll rail, `IntersectionObserver`, CSS transitions |
| Typography | Google Fonts — Instrument Sans, Instrument Serif, IBM Plex Mono |
| Backend | Node.js 22, Express 4, CORS |
| Data | CSV (`csv-parser`) parsed in memory — 2,880 rows, 19 columns |
| Alerts | Twilio 5 (SMS), Nodemailer 10 + Gmail SMTP (email) |
| Hosting | Vercel — static CDN + one Node serverless function |
| Testing | Node.js built-in test runner (`node:test`) |

---

## Project structure

```text
.
├── api/
│   └── index.js                  Vercel serverless entry point
├── Backend/
│   ├── app.js                    Express app (routes, dataset, risk model)
│   ├── server.js                 Local entry point
│   ├── data/
│   │   └── assam_comprehensive_health_data.csv
│   ├── test/                     API and alert integration tests
│   └── package.json
├── Frontend/
│   ├── index.html                Landing page, report form, team
│   ├── dashboard.html            Full analytics workspace
│   ├── style.css                 Design system and responsive layout
│   ├── landing.js                Interactions, form, smooth scrolling
│   ├── analytics.js              Aggregation and chart renderers
│   ├── script.js                 Dashboard bootstrap
│   ├── geo-assam.js              District geometry for the map
│   ├── hotspot-map.js            Map rendering and interaction
│   ├── sensor-sim.js             Simulated IoT readings
│   ├── sensor-live.js            Live-style sensor panel
│   └── scroll-rail.js            Semicircular scroll rail
├── .env.example                  Environment template (no secrets)
├── package.json                  npm workspaces and scripts
├── vercel.json                   Build, rewrite, function and header config
└── README.md
```

---

## Local setup

**Prerequisites:** Node.js **22.x** (the pinned engine; `process.loadEnvFile` requires 20.12+).

```bash
git clone https://github.com/Techproking06/SafeSip.git
cd SafeSip
npm install
```

Create the local environment file — every value is optional:

**Linux / macOS**

```bash
cp .env.example Backend/.env
```

**Windows (PowerShell)**

```powershell
Copy-Item .env.example Backend/.env
```

Start the development server:

```bash
npm run dev
```

Open <http://localhost:3000>. The frontend and API share one origin, so no API URL configuration is needed.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts `node --watch Backend/server.js` (auto-reload) |
| `npm start` | Production-style local run without the watcher |
| `npm test` | Runs the API test suite |

Set `PORT` to change the local port (`$env:PORT=3010; npm run dev` on PowerShell, `PORT=3010 npm run dev` on Linux/macOS).

---

## Environment variables

Copy `.env.example` to `Backend/.env` for local runs. On Vercel, add variables under **Settings → Environment Variables**; the platform injects them and no `.env` file is bundled.

| Variable | Required | Purpose | Example placeholder |
| --- | --- | --- | --- |
| `ALERTS_ENABLED` | No | Enables real dispatch when set to `true` | `false` |
| `ALERT_API_KEY` | No | Server-side key required by `POST /api/send-alert` | `<long-random-string>` |
| `TWILIO_ACCOUNT_SID` | No | Twilio account SID for SMS | `<twilio-account-sid>` |
| `TWILIO_AUTH_TOKEN` | No | Twilio auth token | `<twilio-auth-token>` |
| `TWILIO_PHONE_NUMBER` | No | Twilio sender number in E.164 format | `+1XXXXXXXXXX` |
| `SMTP_EMAIL` | No | Gmail address used as sender | `<address>@gmail.com` |
| `SMTP_PASSWORD` | No | Gmail app password (not the account password) | `<google-app-password>` |
| `ALLOWED_ORIGINS` | No | Extra CORS origins, comma separated | `https://example.com` |
| `PORT` | No | Local port only (ignored on Vercel) | `3000` |

**Core features need no environment variables.** With defaults, alerts are off: `/api/health` reports `alertsEnabled: false` and `/api/send-alert` returns `503` with the code `ALERTS_DISABLED`. Enabling alerts without a key also fails closed and logs a warning. Variables are read at startup, so a redeploy is required after changing them.

---

## API

Base URL: `https://safesip-live.vercel.app` (or `http://localhost:3000` locally).

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, dataset size, alert mode and configured channels |
| `GET` | `/api/data` | All 2,880 records as JSON |
| `GET` | `/api/stats` | Aggregated rainfall, flood, stagnant-water and disease totals |
| `POST` | `/api/predict` | Risk score for a hypothetical environmental reading |
| `POST` | `/api/send-alert` | Opt-in, key-gated SMS/email dispatch (off by default) |

**`GET /api/health`**

```json
{
  "message": "HackIgnite water risk backend is running.",
  "records": 2880,
  "alertsEnabled": false,
  "smsConfigured": false,
  "emailConfigured": false
}
```

**`GET /api/stats`** returns `totalRecords`, `averageRainfall`, `minRainfall`, `maxRainfall`, `floodStatus`, `stagnantWaterRiskDistribution` and `totalDiarrheaCases`.

**`POST /api/predict`** accepts JSON:

```json
{ "Rainfall_mm": 80, "Flood_Status": "Yes", "Stagnant_Water_Risk": "High" }
```

and returns the inputs plus `riskScore` (0–7) and `riskLevel` (`Low`, `Medium`, `High`). Missing or invalid fields return `400`.

**`POST /api/send-alert`** requires a phone number or email address. Responses:

| Status | Meaning |
| --- | --- |
| `200` | Dispatched; includes per-channel `sms` / `email` results |
| `400` | No valid contact, or malformed phone/email |
| `401` | Missing or wrong `x-alert-key` (alerts enabled) |
| `429` | More than 5 alerts from one client in 10 minutes |
| `502` | Delivery attempted but both channels failed |
| `503` | Alerts disabled, or delivery credentials not configured |

Unknown `/api/*` routes return a JSON `404`.

---

## Testing

```bash
npm test
```

Ten integration tests run against the real Express app and CSV: dataset loading, statistics, risk scoring, input rejection, alert-disabled behaviour, fail-closed configuration, key authentication, rate limiting and JSON 404s. The alert tests delete delivery credentials in-process, so they never contact Twilio or Gmail.

---

## Deployment

SafeSip deploys as **one Vercel project** (framework preset: **Other**): static frontend on the CDN, one Node function for the API.

| Path | Served by |
| --- | --- |
| `/`, `/dashboard.html`, CSS/JS | `Frontend/` — static output |
| `/api/*` | `api/index.js` → `Backend/app.js` |

### From GitHub

1. Push the repository to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Leave the build command and output directory empty — `vercel.json` sets `outputDirectory` to `Frontend` and `framework` to `null`.
4. Add environment variables only if you need alerts.
5. Deploy.

### Configuration notes

- `vercel.json` rewrites `/api/:path*` to the function and forwards the remaining path as `?path=`, which `api/index.js` restores before Express routes it.
- `includeFiles: "Backend/data/**"` bundles the CSV with the function.
- Responses carry `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` headers. A strict CSP is omitted because the pages use CDN scripts and inline styles.
- Function timeout is 30 seconds, which covers cold-start CSV parsing and alert delivery.

### Verification

The deployed API was checked directly at the time of writing (not assumed):

```bash
curl -s https://safesip-live.vercel.app/api/health
# records: 2880, alertsEnabled: false, smsConfigured: false, emailConfigured: false

curl -s https://safesip-live.vercel.app/api/stats
# totalRecords: 2880
```

Locally, `/api/data` returns 2,880 records (~1.09 MB) in roughly 150 ms after the dataset is parsed.

---

## Security

- Secrets live only in environment variables. `.env` is gitignored and excluded from Vercel CLI uploads; only `.env.example` (placeholders) is committed.
- Alert dispatch is off unless `ALERTS_ENABLED=true` **and** a non-empty `ALERT_API_KEY` are configured. The key is compared in constant time, never sent to the browser.
- Alert requests are validated, length-capped, and rate limited to 5 per client per 10 minutes.
- User-supplied text is HTML-escaped before being placed in emails.
- CORS uses an explicit allowlist rather than a wildcard.
- Contact details posted to `/api/send-alert` are used for the request only; they are not persisted and no patient records are stored.

---

## Limitations

- The dataset is **historical monthly surveillance data** (2014–2023) for six districts, not live telemetry.
- The IoT sensor panel and control-room log are **labelled simulations** that run in the browser. The map heat layer is a visual interpolation of the real dataset, not modelled sensor coverage.
- No user accounts, authentication or audit trail; this is a public prototype.
- In-memory state is per serverless instance: the CSV is re-parsed on cold starts and rate-limit counters reset with each instance.
- Alert delivery is intended for controlled demo/testing, not unsupervised public use.

## Future scope

Not implemented yet, but natural next steps:

- Persistent storage and role-based access for district health officers.
- Real sensor ingestion (MQTT/HTTP) in place of the browser simulation.
- Offline-first field reporting and multilingual UI.
- Shared rate limiting and an outbound alert queue with delivery receipts.
- Geospatial clustering to detect emerging hotspots across districts.

---

## Team

Built for **HackIgnite — MITS_HI25_001** by **ENIGMA DECODERS**:

| Member | Role |
| --- | --- |
| Amrit | Development & coding · Speech & delivery · Research |
| Aditya | Lead developer · Full stack · Research |
| Disha | Development & coding · Research · Speech |
| Aryaman | Presentation design |
| Anirudh | Video generation |
| Shreyas | Graphic design |

Public-health decisions remain with qualified professionals; SafeSip is a decision-support prototype.

**License:** No `LICENSE` file is included in this repository yet; `package.json` declares MIT.
