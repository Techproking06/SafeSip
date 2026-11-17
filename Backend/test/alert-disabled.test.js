// Backend/test/alert-disabled.test.js
// Default public-demo behaviour: the alert endpoint is off, truthful 503, and
// the rest of the API keeps working. Credentials are stubbed out first, so this
// file cannot contact Twilio or Gmail even if the gate regresses.

const test = require('node:test');
const assert = require('node:assert');

delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_PHONE_NUMBER;
delete process.env.SMTP_EMAIL;
delete process.env.SMTP_PASSWORD;
delete process.env.ALERTS_ENABLED;
delete process.env.ALERT_API_KEY;
process.loadEnvFile = () => {};

const app = require('../app');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

function sendAlert(body) {
  return fetch(`${baseUrl}/api/send-alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('alerts stay disabled by default and say so', async () => {
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.strictEqual(health.records, 2880);
  assert.strictEqual(health.alertsEnabled, false);
  // Safety gate: if credentials leaked into this process, fail before posting.
  assert.strictEqual(health.smsConfigured, false, 'test env leaked credentials');
  assert.strictEqual(health.emailConfigured, false, 'test env leaked credentials');

  // Validation still runs first, so a bad request is a 400 rather than a 503.
  const invalid = await sendAlert({ name: 'Test', area: 'Ward 1' });
  assert.strictEqual(invalid.status, 400);

  const res = await sendAlert({ phone: '+15555550100', name: 'Test' });
  assert.strictEqual(res.status, 503);
  const body = await res.json();
  assert.strictEqual(body.success, false);
  assert.strictEqual(body.code, 'ALERTS_DISABLED');
  assert.match(body.error, /disabled/i);
  assert.deepStrictEqual(body.channels, { sms: null, email: null });

  // An off switch has no side effects, so it is not throttled: still a 503.
  const again = await sendAlert({ phone: '+15555550100' });
  assert.strictEqual(again.status, 503);
  assert.strictEqual((await again.json()).code, 'ALERTS_DISABLED');

  // Prediction and analytics are unaffected by the alert gate.
  const predict = await fetch(`${baseUrl}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Rainfall_mm: 80,
      Flood_Status: 'Yes',
      Stagnant_Water_Risk: 'High'
    })
  });
  assert.strictEqual(predict.status, 200);
  assert.strictEqual((await predict.json()).riskLevel, 'High');
});
