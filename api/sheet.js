// Server-side access to public Google Sheets. The browser never needs to know the source export endpoint.
const DEFAULT_SHEET_ID = '10R20NZZYk4FzQ29HN8NcCr7oeSxUcceFKzdMpp9AkUU';
const MAX_BYTES = 5 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GETのみ対応しています。' });
  }
  const gid = String(req.query?.gid ?? '0');
  if (!/^\d{1,20}$/.test(gid)) return res.status(400).json({error:'gidは数字のみ指定できます。'});
  const sheetId = process.env.SHEET_ID || DEFAULT_SHEET_ID;
  if (!/^[a-zA-Z0-9_-]{20,120}$/.test(sheetId)) return res.status(500).json({error:'スプレッドシートIDが不正です。'});
  try {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    const response = await fetch(url, {redirect:'follow',signal:AbortSignal.timeout(15000),cache:'no-store'});
    const mime = response.headers.get('content-type') || '';
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_BYTES) return res.status(413).json({error:'CSVは5MB以下にしてください。'});
    const body = await response.text();
    if (!response.ok || /text\/html/i.test(mime) || /^\s*<(?:!doctype|html)/i.test(body)) {
      res.setHeader('Cache-Control','no-store');
      return res.status(502).json({error:'Google Sheetsを取得できませんでした。シートの共有設定が「リンクを知っている全員：閲覧者」になっているか、gidが正しいかを確認してください。'});
    }
    if (Buffer.byteLength(body,'utf8') > MAX_BYTES) return res.status(413).json({error:'CSVは5MB以下にしてください。'});
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control',req.query?.refresh ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(body);
  } catch (error) {
    res.setHeader('Cache-Control','no-store');
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(502).json({error: timeout ? 'Google Sheetsへの接続がタイムアウトしました。' : 'Google Sheetsからの取得中にエラーが発生しました。'});
  }
}
