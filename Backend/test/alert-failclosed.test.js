// Backend/test/alert-failclosed.test.js
// ALERTS_ENABLED without a key must stay disabled (fail closed), never send.

const test = require('node:test');
const assert = require('node:assert');

delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_PHONE_NUMBER;
delete process.env.SMTP_EMAIL;
delete process.env.SMTP_PASSWORD;
delete process.env.ALERT_API_KEY;
process.env.ALERTS_ENABLED = 'true';
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

test('enabled without a key fails closed', async () => {
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.strictEqual(health.alertsEnabled, false);
  assert.strictEqual(health.smsConfigured, false, 'test env leaked credentials');
  assert.strictEqual(health.emailConfigured, false, 'test env leaked credentials');

  const res = await fetch(`${baseUrl}/api/send-alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+15555550100' })
  });
  assert.strictEqual(res.status, 503);
  assert.strictEqual((await res.json()).code, 'ALERTS_DISABLED');
});
