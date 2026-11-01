import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedVideoUrl, songVideoLinks, youtubeSearchUrl, niconicoSearchUrl, inheritVideoUrls} from '../lib/video.mjs';
import {guessMapping, parseSheetCSV, createRecords} from '../lib/analytics.mjs';

test('accepts only valid YouTube and Niconico watch video URLs', () => {
  assert.equal(trustedVideoUrl('https://youtu.be/dQw4w9WgXcQ')?.platform,'YouTube');
  assert.equal(trustedVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.platform,'YouTube');
  assert.equal(trustedVideoUrl('https://www.nicovideo.jp/watch/sm12345678')?.platform,'ニコニコ動画');
  assert.equal(trustedVideoUrl('https://nico.ms/sm12345678')?.platform,'ニコニコ動画');
  assert.equal(trustedVideoUrl('https://evil.example/watch?v=dQw4w9WgXcQ'),null);
  assert.equal(trustedVideoUrl('javascript:alert(1)'),null);
  assert.equal(trustedVideoUrl('https://www.youtube.com/results?search_query=曲'),null);
  assert.equal(trustedVideoUrl('https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ'),null);
});
test('direct watch links beat search results; YouTube preferred when both URLs supplied', () => {
  const y='https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const n='https://www.nicovideo.jp/watch/sm12345678';
  assert.deepEqual(songVideoLinks({song:'曲名',artist:'作者',youtube:y,niconico:n}).main,{url:y,platform:'YouTube',mode:'direct'});
  assert.equal(songVideoLinks({song:'曲名',artist:'作者',video:n}).main.platform,'ニコニコ動画');
});
test('no video URL yields properly encoded YouTube and Niconico search links, not a fabricated video', () => {
  const result = songVideoLinks({song:'Rabbit!?。',artist:'A₄。'});
  assert.equal(result.main.mode,'search');
  assert.equal(result.main.url,youtubeSearchUrl('Rabbit!?。','A₄。'));
  assert.equal(result.alternate.url,niconicoSearchUrl('Rabbit!?。','A₄。'));
  assert.match(decodeURIComponent(result.main.url),/Rabbit!\?。 A₄。/);
  assert.equal(songVideoLinks({song:'',artist:'Producer'}).main,null);
});
test('auto-maps optional video URL columns without swallowing X post URL', () => {
  const parsed=parseSheetCSV('曲名,アーティスト,ユーザー,投稿日,投稿URL,動画URL,YouTube URL,ニコニコ動画URL,ジャケット画像URL\n曲,作者,ユーザー,2026/11/01,https://x.com/example/status/1,https://www.nicovideo.jp/watch/sm12345678,https://youtu.be/dQw4w9WgXcQ,https://www.nicovideo.jp/watch/sm12345678,https://example.org/a.jpg');
  const mapping=guessMapping(parsed.headers,parsed.data);
  assert.deepEqual(mapping,{song:0,artist:1,user:2,date:3,url:4,cover:8,video:5,youtube:6,niconico:7});
  const r=createRecords(parsed.data,mapping)[0];
  assert.equal(r.url,'https://x.com/example/status/1');
  assert.equal(r.youtube,'https://youtu.be/dQw4w9WgXcQ');
});

test('same song+artist rows inherit one supplied video URL, different artists do not', () => {
  const direct='https://www.nicovideo.jp/watch/sm12345678';
  const records=inheritVideoUrls([
    {song:'同名曲',artist:'P1',songKey:'同名曲\u0000p1',video:direct},
    {song:'同名曲',artist:'P1',songKey:'同名曲\u0000p1',video:''},
    {song:'同名曲',artist:'P2',songKey:'同名曲\u0000p2',video:''}
  ]);
  assert.equal(songVideoLinks(records[1]).main.mode,'direct');
  assert.equal(songVideoLinks(records[2]).main.mode,'search');
});
