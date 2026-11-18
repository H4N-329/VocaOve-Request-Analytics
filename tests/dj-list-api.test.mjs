import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import handler from '../api/dj-list.js';
import { DJ_HEADERS, replayDjList } from '../lib/v4.mjs';

const password = 'test-password-for-fixtures';
const operation = { action: 'add', operationId: '00000000-0000-4000-8000-000000000001', song: '曲(Remix)', artist: 'P' };
function response() {
  return { statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}
async function request(body, extra = {}) {
  const res = response();
  await handler({ method: 'POST', headers: { host: 'example.vercel.app', origin: 'https://example.vercel.app' }, body: { password, ...body }, ...extra }, res);
  return res;
}

test('cloud API authenticates, appends once after retry, and preserves existing rows', async () => {
  const keys = ['REGISTRATION_ADMIN_PASSWORD', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'DJ_LIST_SHEET_ID', 'SHEET_ID'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rows = [DJ_HEADERS];
  const calls = [];
  let failAfterAppend = false;
  let invalidHeaders = false;
  try {
    delete process.env.REGISTRATION_ADMIN_PASSWORD;
    const missing = await request({}, { method: 'GET' });
    assert.deepEqual(missing.body, { configured: false });
    process.env.REGISTRATION_ADMIN_PASSWORD = password;
    process.env.DJ_LIST_SHEET_ID = 'dedicated-private-test-sheet-123456';
    process.env.SHEET_ID = 'public-test-sheet-1234567890123456';
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: 'service_account', client_email: 'test@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      if (url.includes('oauth2.googleapis.com')) return { ok: true, json: async () => ({ access_token: 'fixture' }) };
      if (options.method === 'POST') {
        assert.match(url, /dedicated-private-test-sheet/);
        assert.match(url, /:append\?valueInputOption=RAW/);
        rows.push(...JSON.parse(options.body).values);
        if (failAfterAppend) { failAfterAppend = false; throw new Error('fixture: response lost'); }
        return { ok: true, json: async () => ({ updates: { updatedRows: 1 } }) };
      }
      return { ok: true, json: async () => ({ values: invalidHeaders ? [['日時', '曲名']] : rows.map(row => [...row]) }) };
    };
    assert.equal((await request({}, { method: 'GET' })).body.configured, true);
    assert.equal((await request(operation, { body: { ...operation, password: 'wrong' } })).statusCode, 401);
    assert.equal((await request(operation, { headers: { host: 'example.vercel.app', origin: 'https://evil.invalid' } })).statusCode, 403);
    assert.equal(calls.length, 0);
    failAfterAppend = true;
    assert.equal((await request(operation)).statusCode, 502);
    assert.equal((await request(operation)).statusCode, 200);
    assert.equal(rows.length, 2);
    assert.deepEqual((await request({ action: 'list' })).body.items, [{ song: '曲(Remix)', artist: 'P', status: '確認中' }]);
    assert.equal((await request({ ...operation, song: '別曲', operationId: '00000000-0000-4000-8000-000000000002' })).statusCode, 200);
    assert.equal(replayDjList(rows).items.length, 2);
    assert.ok(calls.every(call => !['PUT', 'DELETE'].includes(call.method)));
    invalidHeaders = true;
    assert.equal((await request(operation)).statusCode, 502);
    process.env.DJ_LIST_SHEET_ID = process.env.SHEET_ID;
    assert.equal((await request({}, { method: 'GET' })).body.configured, false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
