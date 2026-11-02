import { createPrivateKey, sign, timingSafeEqual } from 'node:crypto';
import { checkHeaders, isDuplicate, rowValues, validateRequest } from '../lib/registration.mjs';

const DEFAULT_SHEET_ID = '10R20NZZYk4FzQ29HN8NcCr7oeSxUcceFKzdMpp9AkUU';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const b64url = data => Buffer.from(data).toString('base64url');
const json = (res,code,value) => {res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.status(code).json(value);};

function authenticate(password, envPassword) {
  if (typeof password !== 'string' || password.length > 256 || !envPassword || envPassword.length < 16) return false;
  const a = Buffer.from(password), b = Buffer.from(envPassword);
  return a.length === b.length && timingSafeEqual(a,b);
}
function credentials(env) {
  let data;
  try { data = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || ''); } catch { throw new Error('サービスアカウントJSONの形式が不正です。'); }
  if (!data || data.type !== 'service_account' || typeof data.client_email !== 'string' || typeof data.private_key !== 'string' || !data.private_key.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Googleサービスアカウントの設定を確認してください。');
  }
  return data;
}
async function googleAccessToken(creds) {
  const now = Math.floor(Date.now()/1000);
  const header = b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload = b64url(JSON.stringify({iss:creds.client_email,scope:SCOPE,aud:TOKEN_ENDPOINT,iat:now,exp:now+3600}));
  const unsigned = `${header}.${payload}`;
  const signature = sign('RSA-SHA256',Buffer.from(unsigned),createPrivateKey(creds.private_key.replace(/\\n/g,'\n'))).toString('base64url');
  const response = await fetch(TOKEN_ENDPOINT,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`}),
    signal:AbortSignal.timeout(12000)
  });
  const token = await response.json();
  if(!response.ok || !token.access_token) throw new Error('Google認証に失敗しました。サービスアカウント設定を確認してください。');
  return token.access_token;
}
async function googleValues(url,token,options={}) {
  const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,...(options.headers||{})},signal:AbortSignal.timeout(12000)});
  const body=await response.json().catch(()=>({}));
  if (!response.ok) {
    if (response.status===403 || response.status===404) throw new Error('Google Sheetsへの編集権限がありません。サービスアカウントを編集者として共有してください。');
    throw new Error(`Google Sheetsへの書き込みに失敗しました（${response.status}）。`);
  }
  return body;
}
export default async function handler(req,res) {
  res.setHeader('Allow','POST');
  if (req.method !== 'POST') return json(res,405,{error:'POSTのみ対応しています。'});
  const origin=req.headers?.origin, host=req.headers?.host;
  if (origin && host) {
    try {if (new URL(origin).host !== host || new URL(origin).protocol !== 'https:') return json(res,403,{error:'外部サイトからの登録はできません。'});} catch { return json(res,403,{error:'アクセス元を確認してください。'}); }
  }
  const len=Number(req.headers?.['content-length']??0);
  if (len>8192) return json(res,413,{error:'送信データが大きすぎます。'});
  const env=process.env;
  if (!env.REGISTRATION_ADMIN_PASSWORD || !env.GOOGLE_SERVICE_ACCOUNT_JSON) return json(res,503,{error:'登録機能の管理者設定が未完了です。Vercelの環境変数を設定してください。'});
  let body;
  try {body=typeof req.body==='string'?JSON.parse(req.body):req.body; } catch {return json(res,400,{error:'送信内容がJSONではありません。'});}
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > 8192) return json(res,400,{error:'送信内容を確認してください。'});
  if (!authenticate(body.password,env.REGISTRATION_ADMIN_PASSWORD)) return json(res,401,{error:'管理用パスワードが正しくありません。'});
  let entry;
  try {entry=validateRequest(body);} catch (err) {return json(res,400,{error:err.message});}
  const sheetId = env.SHEET_ID || DEFAULT_SHEET_ID;
  const tab = env.SHEET_TAB_NAME || 'シート1';
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(sheetId) || !tab || tab.length>100 || /[\u0000-\u001f]/.test(tab)) return json(res,503,{error:'対象シートの設定が不正です。'});
  const a1Tab = `'${tab.replaceAll("'","''")}'`;
  const base=`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/`;
  try {
    const token = await googleAccessToken(credentials(env));
    const existing = await googleValues(base+encodeURIComponent(a1Tab+'!A1:F'),token);
    checkHeaders(existing.values?.[0]);
    if (isDuplicate(existing.values||[],entry)) return json(res,409,{error:'同じX投稿・同じ曲名・ボカロPの登録が既にあります。'});
    const target=base+encodeURIComponent(a1Tab+'!A:F')+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    const result=await googleValues(target,token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({majorDimension:'ROWS',values:[rowValues(entry)]})});
    if (result.updates?.updatedRows !== 1) throw new Error('追記結果を確認できませんでした。重複登録せずシートを確認してください。');
    return json(res,201,{ok:true,message:'スプレッドシートに1件登録しました。',updatedRange:result.updates.updatedRange});
  } catch(err) {
    console.error('Sheet register error:',err?.message); // do not log secrets or submitted values
    return json(res,502,{error:err?.message || '登録に失敗しました。シートの状態を確認してください。'});
  }
}
