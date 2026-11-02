import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {checkHeaders,isDuplicate,rowValues,validateRequest} from '../lib/registration.mjs';
import handler from '../api/register.js';
const VALID={date:'2026-11-01',user:'リクエストさん',song:'ラビット',artist:'Pさん',url:'https://x.com/example/status/123456789?t=abc'};
const HEAD=['日時','ユーザー','曲名','ボカロP','URL','動画URL'];
function mockRes() {return {statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}};}
async function post(body, extra={}) {const res=mockRes();await handler({method:'POST',headers:{host:'example.vercel.app',origin:'https://example.vercel.app'},body:{password:'a'.repeat(24),...body},...extra},res);return res;}
test('registration formats date and canonicalizes X links',()=>{
 const value=validateRequest(VALID);
 assert.deepEqual(rowValues(value),['2026/11/01','リクエストさん','ラビット','Pさん','https://x.com/i/status/123456789']);
});
test('registration rejects bad dates and malicious links',()=>{
 assert.throws(()=>validateRequest({...VALID,date:'2026-02-29'}),/日付/);
 assert.throws(()=>validateRequest({...VALID,url:'https://evil.example/status/123456789'}),/X/);
 assert.throws(()=>validateRequest({...VALID,url:'javascript:alert(1)'}),/X/);
 assert.throws(()=>validateRequest({...VALID,song:'=IMPORTXML("bad")\nnext'}),/不正/);
});
test('detects same X status + same song + artist even with tracking links',()=>{
 const row=validateRequest(VALID);
 assert.equal(isDuplicate([HEAD,['2026/01/01','A','ラビット','Pさん','https://twitter.com/other/status/123456789?x=y']],row),true);
 assert.equal(isDuplicate([HEAD,['2026/01/01','A','別の曲','Pさん','https://x.com/i/status/123456789']],row),false);
});
test('rejects unexpected spreadsheet header layout',()=>{
 assert.doesNotThrow(()=>checkHeaders(HEAD));
 assert.throws(()=>checkHeaders(['曲名','ボカロP','ユーザー','日時','URL']),/列構成/);
});
test('rejects GET and unauthenticated registration',async()=>{
 const orig=process.env.REGISTRATION_ADMIN_PASSWORD;const origSa=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 try {
 process.env.REGISTRATION_ADMIN_PASSWORD='a'.repeat(24);process.env.GOOGLE_SERVICE_ACCOUNT_JSON='{}';
 const r=mockRes();await handler({method:'GET',headers:{}},r);assert.equal(r.statusCode,405);
 const r2=await post(VALID,{body:{password:'wrong',...VALID}});assert.equal(r2.statusCode,401);
 const r3=await post(VALID,{headers:{host:'example.vercel.app',origin:'https://evil.example'}});assert.equal(r3.statusCode,403);
 } finally {restore('REGISTRATION_ADMIN_PASSWORD',orig);restore('GOOGLE_SERVICE_ACCOUNT_JSON',origSa);}
});
function restore(k,v) {if(v===undefined)delete process.env[k];else process.env[k]=v;}
test('writes to the exact A:E columns and handles duplicate attempts',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const original={};for(const k of ['GOOGLE_SERVICE_ACCOUNT_JSON','REGISTRATION_ADMIN_PASSWORD','SHEET_ID','SHEET_TAB_NAME']) original[k]=process.env[k];
 process.env.GOOGLE_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',client_email:'test@example.iam.gserviceaccount.com',private_key:privateKey.export({format:'pem',type:'pkcs8'}).toString()});
 process.env.REGISTRATION_ADMIN_PASSWORD='a'.repeat(24);
 process.env.SHEET_ID='10R20NZZYk4FzQ29HN8NcCr7oeSxUcceFKzdMpp9AkUU';process.env.SHEET_TAB_NAME='シート1';
 const fetchOriginal=globalThis.fetch;const requests=[];let duplicate=false;
 globalThis.fetch=async(url,opts={})=>{
 requests.push({url:String(url),opts});
 if (String(url).includes('oauth2.googleapis.com/token')) return {ok:true,json:async()=>({access_token:'fake-token'})};
 if(opts.method==='POST') return {ok:true,json:async()=>({updates:{updatedRows:1,updatedRange:'シート1!A3:E3'}})};
 return {ok:true,json:async()=>({values:duplicate?[HEAD,['2026/11/01','リクエストさん','ラビット','Pさん','https://twitter.com/example/status/123456789']]:[HEAD]})};
 };
 try {
  let res=await post(VALID);assert.equal(res.statusCode,201);assert.equal(res.body.ok,true);
  const append=requests.find(x=>String(x.url).includes(':append'));assert.ok(append);
  assert.match(append.url,/A%3AF.*append/);
  assert.deepEqual(JSON.parse(append.opts.body).values,[['2026/11/01','リクエストさん','ラビット','Pさん','https://x.com/i/status/123456789']]);
  assert.equal(append.opts.headers.Authorization,'Bearer fake-token');
  duplicate=true;res=await post(VALID);assert.equal(res.statusCode,409);
 } finally {globalThis.fetch=fetchOriginal;for(const [k,v] of Object.entries(original))restore(k,v);}
});
