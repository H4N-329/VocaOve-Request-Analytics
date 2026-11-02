export const REQUIRED_HEADERS = ['日時', 'ユーザー', '曲名', 'ボカロP', 'URL'];
const CONTROL = /[\u0000-\u001f\u007f]/;

export function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('登録内容を確認してください。');
  const fields = { date: 10, user: 100, song: 200, artist: 160, url: 500 };
  const row = {};
  for (const [key,max] of Object.entries(fields)) {
    if (typeof input[key] !== 'string') throw new Error('すべての項目を入力してください。');
    const value = input[key].trim();
    if (!value || value.length > max || CONTROL.test(value)) throw new Error('入力内容が空欄、長すぎる、または不正な文字を含んでいます。');
    row[key] = value;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error('日付は年月日で入力してください。');
  const [y,m,d] = row.date.split('-').map(Number);
  const check = new Date(Date.UTC(y,m-1,d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m-1 || check.getUTCDate() !== d || y < 2000 || y > 2100) throw new Error('有効な日付を指定してください。');
  let url;
  try { url = new URL(row.url); } catch { throw new Error('有効なX投稿URLを入力してください。'); }
  if (url.protocol !== 'https:' || !['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(url.hostname.toLowerCase()) || !/^\/(?:[^/]+\/)?status\/\d+(?:\/.*)?$/i.test(url.pathname)) {
    throw new Error('URLはX（Twitter）の投稿URLを入力してください。');
  }
  const id = url.pathname.match(/\/status\/(\d+)/i)[1];
  row.url = `https://x.com/i/status/${id}`;
  row.date = row.date.replaceAll('-', '/');
  return row;
}

export function checkHeaders(actual) {
  if (!Array.isArray(actual) || REQUIRED_HEADERS.some((name,i)=> String(actual[i] ?? '').trim().normalize('NFKC') !== name.normalize('NFKC'))) {
    throw new Error('シートの列構成が変更されています。A〜E列が「日時／ユーザー／曲名／ボカロP／URL」の順か確認してください。');
  }
}
export function rowValues(data) { return [data.date,data.user,data.song,data.artist,data.url]; }
const clean = x=>String(x??'').trim().normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/g,'');
export function isDuplicate(rows, entry) {
  const current = clean(entry.song)+'\u0000'+clean(entry.artist);
  const id = entry.url.match(/\/status\/(\d+)/)?.[1];
  return rows.slice(1).some(r => {
    const oldId = String(r[4]??'').match(/\/status\/(\d+)/)?.[1];
    return id && id === oldId && current === clean(r[2])+'\u0000'+clean(r[3]);
  });
}
