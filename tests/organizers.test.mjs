import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrganizerName, visibleUserRanking, ORGANIZER_NAMES } from '../lib/organizers.mjs';
import { parseSheetCSV, createRecords, guessMapping, aggregateAll } from '../lib/analytics.mjs';
import { makeTrends } from '../lib/v3.mjs';

const names = ['芋太郎','キュア時雨','星野ぼび','はん'];
test('staff names are recognized, including @handle decorations', () => {
  assert.deepEqual(ORGANIZER_NAMES,names);
  for(const name of names) {
    assert.equal(isOrganizerName(name),true);
    assert.equal(isOrganizerName(`  ${name}  `),true);
    assert.equal(isOrganizerName(`${name}（@VOCALOID_ORG）`),true);
    assert.equal(isOrganizerName(`${name} @voca_staff`),true);
  }
  assert.equal(isOrganizerName('はんこ'),false);
  assert.equal(isOrganizerName('芋太郎ファン'),false);
  assert.equal(isOrganizerName('@someone'),false);
  assert.equal(isOrganizerName('キュア時雨のファン'),false);
});

test('display filter defaults to staff exclusion, reranks, is immutable and reversible',()=>{
  const groups=[{key:'芋太郎',label:'芋太郎',rank:1,count:8},{key:'listener',label:'一般リスナー',rank:2,count:6},{key:'キュア時雨',label:'キュア時雨',rank:3,count:4},{key:'fan',label:'別のリスナー',rank:4,count:3},{key:'はん',label:'はん',rank:5,count:2},{key:'星野ぼび',label:'星野ぼび',rank:6,count:1}];
  const normal=visibleUserRanking(groups);
  assert.deepEqual(normal.map(x=>[x.rank,x.label]),[[1,'一般リスナー'],[2,'別のリスナー']]);
  const shown=visibleUserRanking(groups,true);
  assert.deepEqual(shown.map(x=>x.rank),[1,2,3,4,5,6]);
  assert.equal(groups[1].rank,2);
  assert.deepEqual(visibleUserRanking(groups),normal);
});

test('organizer exclusion does not affect songs, artists, months or total posts',()=>{
 const csv=`楽曲名,アーティスト,ユーザー名,投稿日,投稿URL\nA,P,芋太郎,2026-10-04,https://x.com/x/status/1\nB,P,キュア時雨,2026-10-05,https://x.com/y/status/2\nA,P,一般の方,2026-10-05,https://x.com/z/status/3\nC,Q,星野ぼび,2026-10-15,https://x.com/z/status/4\nD,Q,はん,2026-10-15,https://x.com/z/status/5`;
 const parsed=parseSheetCSV(csv);
 const items=createRecords(parsed.data,guessMapping(parsed.headers,parsed.data));
 const all=aggregateAll(items),shown=visibleUserRanking(all.users,true),hidden=visibleUserRanking(all.users,false);
 assert.equal(all.rowCount,5);
 assert.equal(all.songs.length,4);
 assert.equal(all.artists.length,2);
 assert.equal(all.months[0].count,5);
 assert.equal(shown.length,5);
 assert.equal(hidden.length,1);
 assert.equal(hidden[0].label,'一般の方');
});

test('relative ranking changes use matching hidden-staff cohort',()=>{
 const previous=[{key:'staff',label:'芋太郎',rank:1},{key:'fanA',label:'リスナーA',rank:2},{key:'fanB',label:'リスナーB',rank:3}];
 const current=[{key:'staff',label:'芋太郎',rank:1},{key:'fanB',label:'リスナーB',rank:2},{key:'fanA',label:'リスナーA',rank:3}];
 const prevHidden=visibleUserRanking(previous,false),currentHidden=visibleUserRanking(current,false);
 const trends=makeTrends(currentHidden,prevHidden,[], '2026-10-01','user');
 assert.equal(trends.get('fanA').change,-1);
 assert.equal(trends.get('fanB').change,1);
});
