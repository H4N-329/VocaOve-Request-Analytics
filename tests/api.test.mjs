import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/sheet.js';
function response() {
  return {
    statusCode:200, headers:{}, body:null,
    setHeader(name, value) { this.headers[name]=value; },
    status(code) { this.statusCode=code; return this; },
    json(payload) { this.body=payload; return this; },
    send(body) { this.body=body; return this; }
  };
}
test('API rejects bad gid and unsupported methods', async () => {
  const first = response();
  await handler({method:'GET',query:{gid:'../evil'}},first);
  assert.equal(first.statusCode,400);
  const second = response();
  await handler({method:'POST',query:{gid:'0'}},second);
  assert.equal(second.statusCode,405);
});
test('API returns CSV from Google Sheets and constrains source URL', async () => {
  const oldFetch = globalThis.fetch;
  let got;
  globalThis.fetch = async (url) => {got=url;return {ok:true,status:200,headers:new Headers({'content-type':'text/csv'}),text:async()=> '曲名,投稿者\nA,U\n'};};
  try {
    const res=response();
    await handler({method:'GET',query:{gid:'0',refresh:'1'}},res);
    assert.equal(res.statusCode,200);
    assert.match(res.body,/曲名/);
    assert.match(got,/docs\.google\.com\/spreadsheets/);
    assert.equal(res.headers['Cache-Control'],'no-store');
  } finally { globalThis.fetch=oldFetch; }
});
test('API reports 502 for inaccessible private sheet', async () => {
  const oldFetch=globalThis.fetch;
  globalThis.fetch = async()=>({ok:true,status:200,headers:new Headers({'content-type':'text/html'}),text:async()=>'<html>Sign in</html>'});
  try {const res=response();await handler({method:'GET',query:{gid:'0'}},res);assert.equal(res.statusCode,502);}
  finally{globalThis.fetch=oldFetch;}
});
