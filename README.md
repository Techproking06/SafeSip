# SafeSip

Smart community health monitoring and early warning system for water-borne
diseases. SafeSip combines a citizen symptom-reporting form, an environmental
risk model, a live analytics dashboard over 2,880 historical health records, and
opt-in SMS/email alert delivery.

Built for HackIgnite (MITS_HI25_001).

## Features

- **Citizen health reporting** with client-side validation, a transparent
  risk-score breakdown, and a generated session ID.
- **Environmental risk model** (`POST /api/predict`) driven by rainfall, flood
  status and stagnant-water risk.
- **Analytics dashboard** backed by real CSV data: dataset preview, rainfall
  trends, flood and stagnant-water distributions, disease totals, district and
  block rankings, and rainfall-vs-disease-burden comparisons.
- **Alert delivery** through Twilio SMS and Gmail SMTP, with per-channel success
  and failure reporting. Failures are shown as failures; the UI never claims a
  message was delivered when it was not. Dispatch is **disabled by default** and
  requires `ALERTS_ENABLED=true` plus a server-side `ALERT_API_KEY`.
- **IoT panel, heat map and control-room log** are explicitly labelled
  simulations and run in the browser only.

## Tech stack

| Layer     | Technology                                              |
| --------- | ------------------------------------------------------- |
| Frontend  | Static HTML, Tailwind CSS (CDN), Chart.js (CDN), vanilla JS |
| Backend   | Node.js 22.x, Express 4                              |
| Data      | CSV (`Backend/data/assam_comprehensive_health_data.csv`) parsed in memory |
| Alerts    | Twilio (SMS), Nodemailer + Gmail SMTP (email)           |
| Hosting   | Vercel (static frontend + one serverless API function)  |

## Architecture

```text
Browser
  │
  ├── /                 → Frontend/index.html        (landing + reporting + dashboard)
  ├── /dashboard.html   → Frontend/dashboard.html    (full analytics dashboard)
  └── /api/*            → api/index.js               (Vercel function)
                              │
                              └── Backend/app.js     (Express app)
                                    ├── Backend/data/*.csv
                                    ├── Twilio
                                    └── Gmail SMTP
```

`Backend/app.js` is the single Express app. It is reused by:

- `Backend/server.js` — local development (also serves `Frontend/` statically).
- `api/index.js` — Vercel serverless entry point.

There are no mock API responses: every chart, table and prediction is produced
from the CSV or the risk model at request time.

## Prerequisites

- Node.js **22.x** (pinned in the root `package.json` `engines` field; npm
  workspaces and `process.loadEnvFile` need 20.12 or newer)
- Optional: a Twilio account and a Gmail app password for live SMS/email

## Getting started

```bash
git clone <your-repo-url>
cd <repo>
npm install
```

Create the local environment file:

```bash
cp .env.example Backend/.env
```

Fill in the values you have, then start the server:

```bash
npm run dev
```

This runs `node --watch server.js`, so backend edits restart the server
automatically. Set `PORT` to use a different port
(`$env:PORT='3010'; npm run dev` on PowerShell), and use `npm start` for a
production-style run without the watcher.

Open <http://localhost:3000>. The API and the frontend share one origin, so no
API base URL configuration is needed.

### Environment variables

| Variable              | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `ALERTS_ENABLED`      | Set to `true` to allow real SMS/email dispatch (default off) |
| `ALERT_API_KEY`       | Required when alerts are enabled; callers send it as `x-alert-key` |
| `TWILIO_ACCOUNT_SID`  | Twilio account SID for SMS                           |
| `TWILIO_AUTH_TOKEN`   | Twilio auth token                                    |
| `TWILIO_PHONE_NUMBER` | Twilio sender number in E.164 format (`+1...`)       |
| `SMTP_EMAIL`          | Gmail address used as the sender                     |
| `SMTP_PASSWORD`       | Gmail **app password** (not the account password)    |
| `ALLOWED_ORIGINS`     | Optional comma-separated extra CORS origins          |
| `PORT`                | Local server port (default `3000`)                   |

All alert variables are optional to start the API. With the defaults, dispatch is
off: the API still runs, `/api/health` reports `alertsEnabled: false`, and
`/api/send-alert` returns `503 { "code": "ALERTS_DISABLED" }`. Enabling alerts
without a key also stays disabled (fail closed) and logs a warning.

When `ALERTS_ENABLED=true` and a key is set, `/api/send-alert` requires the key
in the `x-alert-key` header and returns `401 { "code": "ALERT_AUTH_REQUIRED" }`
when it is missing or wrong. The key is read from the server environment only;
it is never included in the frontend bundle, so the public page's alert button
is for the disabled demo mode. Trusted callers (curl, scripts) supply the header.

## API

| Method | Endpoint          | Description                                        |
| ------ | ----------------- | -------------------------------------------------- |
| GET    | `/api/health`     | Liveness, dataset size, alert mode and configured channels |
| GET    | `/api/data`       | All 2,880 records as JSON                          |
| GET    | `/api/stats`      | Aggregate rainfall, flood and disease statistics   |
| POST   | `/api/predict`    | Risk score from `Rainfall_mm`, `Flood_Status`, `Stagnant_Water_Risk` |
| POST   | `/api/send-alert` | Opt-in, key-gated SMS/email dispatch; off by default |

Risk model: rainfall > 50 mm adds 2 points, flood status `Yes` adds 3, stagnant
water risk `High` adds 2. `>= 5` is High, `>= 3` is Medium, otherwise Low.

`POST /api/send-alert` requires a valid phone number or email address, validates
both formats, escapes user text before building the HTML email, and rate limits
each client to 5 alerts per 10 minutes. Rate limiting is in memory and therefore
per serverless instance — a speed bump, not a global quota.

## Testing

```bash
npm test
```

Runs ten integration tests against the real Express app and CSV using Node's
built-in test runner (no extra dependencies). They cover dataset loading, stats,
risk scoring, input rejection, the disabled alert gate, fail-closed config, key
authentication, rate limiting and JSON 404s. The alert tests stub out delivery
credentials and delete `ALERTS_ENABLED`/`ALERT_API_KEY`, so they can never
contact Twilio or Gmail.

## Deployment (Vercel)

The project deploys as **one Vercel project**: the frontend is static, the API is
a single Node serverless function. No separate backend host is required.

```text
/                  Frontend/index.html      (static, CDN)
/dashboard.html    Frontend/dashboard.html  (static, CDN)
/api/*             api/index.js             (one function → Backend/app.js)
```

There is no SPA router: both pages are separate HTML files, so no catch-all HTML
rewrite is needed.

### From GitHub

1. Push the repository to GitHub.
2. In Vercel, import the repository (framework preset: **Other**).
3. Leave the build command and output directory alone — `vercel.json` sets the
   output directory to `Frontend` and `framework` to `null`.
4. Add the environment variables from the table above under
   **Settings → Environment Variables** (Production and Preview). For a public
   demo leave `ALERTS_ENABLED` unset (or `false`); prediction, analytics and the
   dataset need no variables at all.
5. Deploy.

### From the CLI

```bash
npm i -g vercel
vercel link          # once per machine
vercel --prod
```

Add environment variables with `vercel env add ALERT_API_KEY production` (repeat
per variable and per environment), or set them in the dashboard before promoting
the deployment.

### Verify the deployment

```bash
curl -s https://<your-domain>/api/health   # records: 2880
curl -s https://<your-domain>/api/stats     # totalRecords: 2880
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/dashboard.html   # 200
```

Also check that the landing page loads the dataset table and that
`/dashboard.html` renders all charts.

`vercel.json`:

- rewrites `/api/*` to the function and passes the remaining path as `?path=`,
  which `api/index.js` restores before Express routes it (a rewrite replaces the
  path the function would otherwise see);
- allows up to 30 seconds per request for alert delivery and bundles
  `Backend/data/**` with the function;
- adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
  `Permissions-Policy` headers to every response. A strict CSP is intentionally
  omitted because the pages load Tailwind, Chart.js, Lenis and Google Fonts from
  CDNs and use inline styles.

### Twilio and Gmail notes

- A Twilio trial account can only send to verified recipient numbers.
- Gmail requires 2-Step Verification plus an app password; regular account
  passwords will not work.

## Security

- Secrets are read from environment variables only. `.env` is gitignored and
  excluded from `vercel` CLI uploads by `.vercelignore`.
- Alert dispatch is off unless `ALERTS_ENABLED=true` and a non-empty
  `ALERT_API_KEY` are set. The key is compared in constant time and never sent
  to the browser.
- CORS is an explicit allowlist; wildcard origins are not used.
- Alert input is validated, length-capped and rate limited.
- User-supplied text is HTML-escaped before being placed in emails.

## Limitations

- The dataset is monthly district-level surveillance data, not live telemetry.
- The IoT panel, heat map, risk donut and report feed are simulated demo data
  and are labelled as such in the UI.
- In-memory state is per serverless instance; the dataset is re-parsed on cold
  starts (about 250 KB) and alert throttling counters reset with each instance.
- The alert API is for demo/testing only; there is no user account system and
  no persistent audit trail.
