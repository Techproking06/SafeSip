// Backend/test/alert-auth.test.js
// Alerts enabled + key required, but delivery credentials stubbed out, so this
// file never contacts Twilio or Gmail. Covers 401, 503 and the throttle.

const test = require('node:test');
const assert = require('node:assert');

delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_PHONE_NUMBER;
delete process.env.SMTP_EMAIL;
delete process.env.SMTP_PASSWORD;
process.env.ALERTS_ENABLED = 'true';
process.env.ALERT_API_KEY = 'test-only-key-not-a-real-secret';
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

function sendAlert(key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['x-alert-key'] = key;
  return fetch(`${baseUrl}/api/send-alert`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone: '+15555550100', name: 'Test' })
  });
}

test('enabled alerts require the key, then report unconfigured delivery', async () => {
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.strictEqual(health.alertsEnabled, true);
  // Safety gate: if credentials leaked into this process, fail before posting.
  assert.strictEqual(health.smsConfigured, false, 'test env leaked credentials');
  assert.strictEqual(health.emailConfigured, false, 'test env leaked credentials');

  const missing = await sendAlert();
  assert.strictEqual(missing.status, 401);
  const missingBody = await missing.json();
  assert.strictEqual(missingBody.code, 'ALERT_AUTH_REQUIRED');
  assert.strictEqual(missingBody.success, false);

  const wrong = await sendAlert('wrong-key');
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual((await wrong.json()).code, 'ALERT_AUTH_REQUIRED');

  // Key is valid, but no Twilio/SMTP credentials exist in this process.
  const first = await sendAlert('test-only-key-not-a-real-secret');
  assert.strictEqual(first.status, 503);
  const firstBody = await first.json();
  assert.match(firstBody.error, /Delivery not configured \(SMS\)/);

  // 5 requests per window get through the throttle; the 6th is blocked.
  for (let i = 0; i < 2; i++) {
    assert.strictEqual(
      (await sendAlert('test-only-key-not-a-real-secret')).status,
      503
    );
  }

  const blocked = await sendAlert('test-only-key-not-a-real-secret');
  assert.strictEqual(blocked.status, 429);
  assert.match((await blocked.json()).error, /Too many alerts/);
});
