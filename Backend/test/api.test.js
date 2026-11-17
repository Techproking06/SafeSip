// Backend/test/api.test.js
// Zero-dependency integration tests against the real Express app and CSV.
// Run with: npm test

const test = require('node:test');
const assert = require('node:assert');
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

test('GET /api/health reports the loaded dataset', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.records, 2880);
});

test('GET /api/data returns every CSV row', async () => {
  const res = await fetch(`${baseUrl}/api/data`);
  assert.strictEqual(res.status, 200);
  const rows = await res.json();
  assert.strictEqual(rows.length, 2880);
  assert.ok(Object.prototype.hasOwnProperty.call(rows[0], 'Rainfall_mm'));
});

test('GET /api/stats aggregates the dataset', async () => {
  const res = await fetch(`${baseUrl}/api/stats`);
  assert.strictEqual(res.status, 200);
  const stats = await res.json();
  assert.strictEqual(stats.totalRecords, 2880);
  assert.strictEqual(stats.floodStatus.Severe, 151);
});

test('POST /api/predict scores the maximum-risk combination as High', async () => {
  const res = await fetch(`${baseUrl}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Rainfall_mm: 80,
      Flood_Status: 'Yes',
      Stagnant_Water_Risk: 'High'
    })
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.riskScore, 7);
  assert.strictEqual(body.riskLevel, 'High');
});

test('POST /api/predict rejects non-numeric rainfall', async () => {
  const res = await fetch(`${baseUrl}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Rainfall_mm: 'lots',
      Flood_Status: 'No',
      Stagnant_Water_Risk: 'Low'
    })
  });
  assert.strictEqual(res.status, 400);
});

test('POST /api/send-alert requires a contact', async () => {
  const res = await fetch(`${baseUrl}/api/send-alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', area: 'Ward 1', symptoms: [] })
  });
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.strictEqual(body.success, false);
});

test('unknown API routes return JSON 404', async () => {
  const res = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.strictEqual(res.status, 404);
  const body = await res.json();
  assert.ok(body.error);
});
