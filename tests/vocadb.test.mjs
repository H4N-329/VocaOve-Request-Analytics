import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSong, mapVocaDbResults, cleanVideoMap, chosenVideoFor } from '../lib/vocadb.mjs';
const VIDEO='https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const NICO='https://www.nicovideo.jp/watch/sm12345678';
const payload={items:[
  {id:123,name:'Rabbit!?。',artistString:'A₄。',songType:'Original',pvs:[{url:VIDEO,pvType:'Original',name:'Rabbit Original'},{url:NICO,pvType:'Reprint'}]},
  {id:124,name:'Rabbit!?。',artistString:'別の人',songType:'Cover',pvs:[{url:'https://evil.com/x'}]},
  {id:125,name:'無関係の曲',artistString:'無関係',pvs:[{url:VIDEO}]},
]};
test('actual song+artist candidate first',()=>{
  const out=mapVocaDbResults(payload,'Rabbit!?。','A₄。');
  assert.equal(out[0].id,123);
  assert.equal(out[0].score,100);
  assert.equal(out[0].videos.length,2);
  assert.equal(out[0].videos[0].platform,'YouTube');
});
test('unrelated songs excluded',()=>{
  const out=mapVocaDbResults(payload,'Rabbit!?。','A₄。');
  assert.ok(!out.some(x=>x.id===125));
});
test('untrusted video URL removed',()=>{
  const out=mapVocaDbResults(payload,'Rabbit!?。','A₄。');
  assert.equal(out.find(x=>x.id===124).videos.length,0);
});
test('title and artist are both considered',()=>{
  assert.ok(scoreSong(payload.items[0],'Rabbit!?。','A₄。').score > scoreSong(payload.items[1],'Rabbit!?。','A₄。').score);
});
test('chosen video never overrides explicit sheet URL',()=>{
  const r={songKey:'rabbit\u0000artist',youtube:NICO,video:'',niconico:''};
  const chosen=chosenVideoFor(r,{}, {'rabbit\u0000artist':{url:VIDEO}});
  assert.equal(chosen.url,NICO); assert.equal(chosen.origin,'sheet');
});
test('selected local confirmed video overrides global',()=>{
  const r={songKey:'rabbit\u0000artist',youtube:'',video:'',niconico:''};
  const chosen=chosenVideoFor(r,{'rabbit\u0000artist':{url:NICO}}, {'rabbit\u0000artist':{url:VIDEO}});
  assert.equal(chosen.url,VIDEO);assert.equal(chosen.origin,'chosen');
});
test('invalid saved URLs removed and song key validated',()=>{
  const links=cleanVideoMap({'bad':{url:VIDEO},'rabbit\u0000artist':{url:VIDEO},'bad\u0000artist':{url:'https://bad.example/foo'}});
  assert.deepEqual(Object.keys(links),['rabbit\u0000artist']);
});
