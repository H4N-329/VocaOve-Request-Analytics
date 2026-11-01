import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetCSV, createRecords, guessMapping, aggregateAll } from '../lib/analytics.mjs';
import { cleanAliases, combinedAliases, resolveAlias, removeDuplicateRequests, recordDedupeKey, periodFor, makeTrends, computeTrends } from '../lib/v3.mjs';

const data = parseSheetCSV(`曲名,アーティスト,ユーザー名,投稿日,投稿URL,ジャケットURL
"スター・ソング",Producer A,@abc,2026-10-18,https://x.com/abc/status/100,
"Star Song",Ｐｒｏｄｕｃｅｒ A,https://x.com/abc,2026-10-30,https://twitter.com/another/status/200?ref=abc,https://example.org/art.jpg
"スター・ソング",Producer A,@abc,2026-10-30,https://x.com/abc/status/200,
New Track,Producer B,@new,2026-10-31,https://x.com/new/status/300,
Other Track,Producer C,@u3,2026-10-05,https://x.com/u3/status/400,
Other Track,Producer C,@u3,2026-10-06,,
Other Track,Producer C,@u3,2026-10-22,https://x.com/u3/status/420,
`);

test('alias normalization combines user overrides and repo JSON, resolves chains and detects cover', () => {
  const a = combinedAliases({songs:{'Star Song':'スターソング'},artists:{'Ｐｒｏｄｕｃｅｒ A':'Producer A'}},
    {songs:{'Star Song':'スター・ソング'},users:{'https://x.com/old_abc':'@abc'}});
  assert.equal(resolveAlias('Star Song','songs',a),'スター・ソング');
  assert.equal(resolveAlias('Ｐｒｏｄｕｃｅｒ A','artists',a),'Ｐｒｏｄｕｃｅｒ A'); // NFKC同等名は手動統合不要
  assert.equal(resolveAlias('https://x.com/old_abc','users',a),'@abc');
  assert.equal(guessMapping(data.headers,data.data).cover,5);
  const records=createRecords(data.data,guessMapping(data.headers,data.data),a);
  assert.equal(records[1].cover,'https://example.org/art.jpg');
  assert.equal(records[0].songKey,records[1].songKey);
  assert.equal(records[0].artistKey,records[1].artistKey);
  assert.equal(records[0].userKey,records[1].userKey);
});
test('duplicate suppression compares X post ID + normalized song and artist, not timestamps or user strings', () => {
  const aliases=cleanAliases({songs:{'Star Song':'スター・ソング'}});
  const records=createRecords(data.data,guessMapping(data.headers,data.data),aliases);
  assert.equal(recordDedupeKey(records[1]),recordDedupeKey(records[2]));
  const out=removeDuplicateRequests(records);
  assert.equal(out.removed,1);
  assert.equal(out.records.length,6);
  assert.equal(removeDuplicateRequests(records,false).records.length,7);
  assert.equal(out.records.filter(r=>r.song==='Other Track').length,3); // no URL is not auto-deduped
  const mixed=createRecords(parseSheetCSV('曲名,アーティスト,投稿日,投稿URL\nTrack A,P,2026/11/1,https://x.com/u/status/1\nTrack B,P,2026/11/1,https://x.com/u/status/1').data,{song:0,artist:1,date:2,url:3});
  assert.equal(removeDuplicateRequests(mixed).removed,0);
});
test('period ranges use calendar days, and calculate prior matching interval', () => {
  assert.deepEqual(periodFor('7','2026-11-01'),{mode:'7',start:'2026-10-26',end:'2026-11-01',prevStart:'2026-10-19',prevEnd:'2026-10-25'});
  assert.deepEqual(periodFor('30','2026-11-01'),{mode:'30',start:'2026-10-03',end:'2026-11-01',prevStart:'2026-09-03',prevEnd:'2026-10-02'});
  assert.equal(periodFor('all','2026-11-01').start,'');
});
test('7-day trend flags a never-before-seen song as new, formerly seen as returning, and previous-period rank movement',()=>{
  const aliases=cleanAliases({songs:{'Star Song':'スター・ソング'}});
  const records=removeDuplicateRequests(createRecords(data.data,guessMapping(data.headers,data.data),aliases)).records;
  const trend=computeTrends(records,{mode:'7',today:'2026-11-01'});
  const recent=aggregateAll(records.filter(r=>r.date>='2026-10-26' && r.date<='2026-11-01'));
  const newTrack=recent.songs.find(r=>r.label==='New Track');
  const oldTrack=recent.songs.find(r=>r.label==='スター・ソング');
  assert.equal(trend.songs.get(newTrack.key).isNew,true);
  assert.equal(trend.songs.get(oldTrack.key).isReturning,true);
});
test('ranking changes are relative to previous same-length period, with ties stable',()=>{
  const mk = (key,rank)=>({key,rank});
  const t=makeTrends([mk('A',1),mk('B',2),mk('C',3)], [mk('B',1),mk('A',3)],
    [{songKey:'A',date:'2026-09-10'},{songKey:'B',date:'2026-09-15'}],'2026-10-26','song');
  assert.equal(t.get('A').change,2);
  assert.equal(t.get('B').change,-1);
  assert.equal(t.get('C').isNew,true);
});
