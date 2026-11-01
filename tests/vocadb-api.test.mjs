import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/vocadb.js';
function response() {return {statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(d){this.data=d;return this;}};}
test('valid request uses fixed trusted VocaDB host and parses candidates',async()=>{
  const old=globalThis.fetch;
  let calledUrl;
  globalThis.fetch=async url=>{calledUrl=String(url);return {ok:true,headers:new Map([['content-length','1000']]),text:async()=>JSON.stringify({items:[{id:1,name:'メルト',artistString:'ryo',pvs:[{url:'https://www.nicovideo.jp/watch/sm12345678'}]}]})};};
  try {const res=response();await handler({method:'GET',query:{song:'メルト',artist:'ryo'}},res);
    assert.equal(res.statusCode,200); assert.equal(res.data.candidates[0].videos.length,1);
    assert.equal(new URL(calledUrl).hostname,'vocadb.net');
    assert.equal(new URL(calledUrl).searchParams.get('fields'),'Artists,PVs,AdditionalNames');
  }finally{globalThis.fetch=old;}
});
test('bad query rejected before request',async()=>{
  const res=response();await handler({method:'GET',query:{song:'',artist:'a'}},res);assert.equal(res.statusCode,400);
});
test('upstream error returns neutral message',async()=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('private backend info')};
  try{const res=response();await handler({method:'GET',query:{song:'メルト'}},res);assert.equal(res.statusCode,502);assert.ok(!JSON.stringify(res.data).includes('private'));}finally{globalThis.fetch=old;}
});
