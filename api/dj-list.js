import { authenticate, credentials, googleAccessToken, googleValues } from '../lib/google-sheets.mjs';
import { keyFor, replayDjList, validateOperation } from '../lib/v4.mjs';

const PUBLIC_SHEET_ID = '10R20NZZYk4FzQ29HN8NcCr7oeSxUcceFKzdMpp9AkUU';
const RANGE = "'DJ選曲候補'!A:F";

function reply(res, code, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(body);
}

function isConfigured(env) {
  return Boolean(env.REGISTRATION_ADMIN_PASSWORD?.length >= 16 && env.GOOGLE_SERVICE_ACCOUNT_JSON &&
    /^[A-Za-z0-9_-]{20,120}$/.test(env.DJ_LIST_SHEET_ID || '') &&
    env.DJ_LIST_SHEET_ID !== (env.SHEET_ID || PUBLIC_SHEET_ID));
}

export default async function handler(req, res) {
  res.setHeader('Allow', 'GET, POST');
  const env = process.env;
  if (req.method === 'GET') return reply(res, 200, { configured: isConfigured(env) });
  if (req.method !== 'POST') return reply(res, 405, { error: 'GET・POSTのみ対応しています。' });
  if (req.headers?.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (origin.protocol !== 'https:' || origin.host !== req.headers.host) throw new Error();
    } catch {
      return reply(res, 403, { error: '外部サイトからは操作できません。' });
    }
  }
  if (Number(req.headers?.['content-length'] || 0) > 8192) return reply(res, 413, { error: '送信データが大きすぎます。' });
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || Array.isArray(body) || typeof body !== 'object' || Buffer.byteLength(JSON.stringify(body)) > 8192) throw new Error();
  } catch {
    return reply(res, 400, { error: '送信内容を確認してください。' });
  }
  if (!isConfigured(env)) return reply(res, 503, { error: 'クラウド保存の管理者設定が未完了です。' });
  if (!authenticate(body.password, env.REGISTRATION_ADMIN_PASSWORD)) return reply(res, 401, { error: '管理パスワードが正しくありません。' });
  let operation;
  if (body.action !== 'list') {
    try { operation = validateOperation(body); }
    catch (error) { return reply(res, 400, { error: error.message }); }
  }
  try {
    const token = await googleAccessToken(credentials(env));
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${env.DJ_LIST_SHEET_ID}/values/`;
    const existing = await googleValues(base + encodeURIComponent(RANGE), token);
    const current = replayDjList(existing.values || []);
    if (body.action === 'list') return reply(res, 200, { items: current.items });
    // 同じ操作IDの再送は何度届いても一度の操作として扱う。
    if (current.operationIds.has(operation.operationId)) return reply(res, 200, { ok: true });
    const exists = current.items.some(item => keyFor(item.song, item.artist) === keyFor(operation.song, operation.artist));
    if (operation.action === 'add' && !exists && current.items.length >= 500) {
      return reply(res, 400, { error: '候補は最大500曲です。' });
    }
    const values = [[operation.operationId, operation.song, operation.artist, operation.status, operation.action, new Date().toISOString()]];
    const target = base + encodeURIComponent(RANGE) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    const saved = await googleValues(target, token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ majorDimension: 'ROWS', values })
    });
    if (saved.updates?.updatedRows !== 1) throw new Error('保存結果を確認できませんでした。同じ操作を再試行してください。');
    return reply(res, 200, { ok: true });
  } catch (error) {
    console.error('DJ list API failed');
    return reply(res, 502, { error: error.message || 'クラウドとの通信に失敗しました。' });
  }
}
