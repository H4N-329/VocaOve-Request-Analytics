import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendHiddenGems } from '../lib/discovery.mjs';

function req(song, artist, n=1) {
  return Array.from({length:n},()=>({song,artist,artistKey:artist.toLowerCase(),songKey: song.toLowerCase()+'\u0000'+artist.toLowerCase()}));
}
const rows=(...sets)=>sets.flat();

test('returns up to five unique rare tracks',()=>{
  const data=rows(req('A','P1',1),req('B','P2',2),req('C','P3',1),req('D','P4',1),req('E','P5',1),req('F','Big',9),req('G','Big',3));
  const out=recommendHiddenGems(data,{rng:()=>0});
  assert.equal(out.recommendations.length,5);
  assert.equal(new Set(out.recommendations.map(s=>s.key)).size,5);
  assert(out.recommendations.every(s=>s.songCount<=2));
  assert(!out.recommendations.some(s=>s.label==='F'));
  assert.equal(out.totalSongs,7);
  assert.equal(out.eligibleCount,5);
});

test('counts producer requests across all tracks (not just rare candidates)',()=>{
  const data=rows(req('Minor by Popular','Popular',1), req('Hit','Popular',13),req('Unique','NewP',1));
  const out=recommendHiddenGems(data,{count:2,rng:()=>0});
  const popular=out.recommendations.find(s=>s.artist==='Popular');
  assert.equal(popular?.artistCount,14);
  assert.equal(out.recommendations.find(s=>s.artist==='NewP')?.artistCount,1);
});

test('broadens the song count cutoff if fewer than requested rare songs exist',()=>{
  const data=rows(req('Once','One',1),req('Twice','Two',2),req('Thrice','Three',3),req('Four','Four',4),req('Five','Five',5));
  const out=recommendHiddenGems(data,{rng:()=>0});
  assert.equal(out.recommendations.length,5);
  assert.equal(out.cutoff,5);
});

test('selects at most one track per producer while other producers remain',()=>{
  const data=rows(req('Song 1','Same'),req('Song 2','Same'),req('Song 3','Same'),req('Song 4','Different'));
  const out=recommendHiddenGems(data,{count:2,rng:()=>0});
  assert.equal(new Set(out.recommendations.map(s=>s.artistKey)).size,2);
});

test('recognizes same title with different producer as different songs',()=>{
  const data=rows(req('Same','A'),req('Same','B'));
  const out=recommendHiddenGems(data,{rng:()=>.1});
  assert.equal(out.recommendations.length,2);
  assert.equal(new Set(out.recommendations.map(s=>s.key)).size,2);
});

test('empty and incomplete rows are excluded safely',()=>{
  const out=recommendHiddenGems([...req('A','P1'),{song:'',artist:'P2',artistKey:'p2',songKey:'\u0000p2'},{song:'B',artist:'',artistKey:'',songKey:'b\u0000'}],{rng:()=>0});
  assert.equal(out.recommendations.length,1);
  assert.equal(out.eligibleCount,1);
  assert.deepEqual(recommendHiddenGems([]).recommendations,[]);
});

test('reroll uses previous songs as lower weight, not forbidden',()=>{
  const data=rows(...Array.from({length:12},(_,i)=>req(`Track${i}` , `P${i}`)));
  const first=recommendHiddenGems(data,{rng:()=>0});
  const second=recommendHiddenGems(data,{rng:()=>0,previousKeys:first.recommendations.map(g=>g.key)});
  assert.notDeepEqual(first.recommendations.map(g=>g.key), second.recommendations.map(g=>g.key));
  assert.equal(second.recommendations.length,5);
});

test('sampling favors less-requested producers over frequent ones',()=>{
  const data=rows(req('Minor','Rare'),req('MinorOther','Frequent'),req('Hit','Frequent',60));
  let rare=0,frequent=0;
  for (let i=0;i<1000;i++) {
    const picked=recommendHiddenGems(data,{count:1,rng:()=> (i+.5)/1000}).recommendations[0];
    if(picked.artist==='Rare') rare++; else if(picked.artist==='Frequent') frequent++;
  }
  assert(rare>frequent*10);
});
