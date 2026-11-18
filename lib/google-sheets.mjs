import { createPrivateKey, sign, timingSafeEqual } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const b64url = data => Buffer.from(data).toString('base64url');
export function authenticate(password, envPassword) {
  if (typeof password !== 'string' || password.length > 256 || !envPassword || envPassword.length < 16) return false;
  const a = Buffer.from(password), b = Buffer.from(envPassword);
  return a.length === b.length && timingSafeEqual(a,b);
}
export function credentials(env) {
  let data;
  try { data = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || ''); } catch { throw new Error('サービスアカウントJSONの形式が不正です。'); }
  if (!data || data.type !== 'service_account' || typeof data.client_email !== 'string' || typeof data.private_key !== 'string' || !data.private_key.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Googleサービスアカウントの設定を確認してください。');
  }
  return data;
}
export async function googleAccessToken(creds) {
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
export async function googleValues(url,token,options={}) {
  const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,...(options.headers||{})},signal:AbortSignal.timeout(12000)});
  const body=await response.json().catch(()=>({}));
  if (!response.ok) {
    if (response.status===403 || response.status===404) throw new Error('Google Sheetsへの編集権限がありません。サービスアカウントを編集者として共有してください。');
    throw new Error(`Google Sheetsへの書き込みに失敗しました（${response.status}）。`);
  }
  return body;
}
