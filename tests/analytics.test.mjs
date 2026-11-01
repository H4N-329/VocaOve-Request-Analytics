import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseSheetCSV, parsePostDate, guessMapping, createRecords, filterRecords, aggregateAll, csvExport, safeHttpUrl } from '../lib/analytics.mjs';

const csv = '曲名,アーティスト,ユーザー名,投稿日,投稿URL\r\n' +
  '星屑エコー,Producer A,@alpha,2026/10/31,https://x.com/a/status/1\r\n' +
  '星屑エコー,Producer A,alpha,2026/11/01,https://x.com/a/status/2\r\n' +
  '夜明けの歌,Producer B,@beta,2026-11-02T01:00:00+09:00,https://x.com/b/status/3\r\n' +
  '星屑エコー,Producer B,@alpha,2026/11/03,https://x.com/a/status/4\r\n' +
  '星屑エコー,Producer A,@beta,不明,https://x.com/b/status/5\r\n';

test('CSV parser handles quoted commas, embedded newlines and escaped quotes', () => {
  assert.deepEqual(parseCSV('曲,作者\r\n"青,空","山田""氏"""\r\n"a\nb",c\r\n'), [['曲','作者'], ['青,空','山田"氏"'], ['a\nb','c']]);
});
test('date parser handles JST, Japanese dates, invalid dates, spreadsheet numbers', () => {
  assert.equal(parsePostDate('2026年11月1日 11:00'), '2026-11-01');
  assert.equal(parsePostDate('2026-10-31T16:30:00Z'), '2026-11-01');
  assert.equal(parsePostDate('2026/02/30'), null);
  assert.equal(parsePostDate('2026/11/1'), '2026-11-01');
  assert.equal(parsePostDate('44888'), '2022-11-23');
});
test('guesses columns and aggregates by song+artist, artist, user and month', () => {
  const parsed = parseSheetCSV(csv);
  const mapping = guessMapping(parsed.headers, parsed.data);
  assert.deepEqual(mapping, {song: 0, artist: 1, user: 2, date: 3, url: 4, cover: -1});
  const records = createRecords(parsed.data, mapping);
  const a = aggregateAll(records);
  assert.equal(a.rowCount, 5);
  assert.equal(a.songs.length, 3);
  assert.equal(a.songs[0].label, '星屑エコー');
  assert.equal(a.songs[0].detail, 'Producer A');
  assert.equal(a.songs[0].count, 3);
  assert.equal(a.artists[0].label, 'Producer A');
  assert.equal(a.artists[0].count, 3);
  assert.equal(a.users[0].count, 3);
  assert.equal(a.users[0].uniqueSongs, 2);
  assert.deepEqual(a.months, [{month:'2026-10',count:1},{month:'2026-11',count:3}]);
  assert.equal(a.undatedCount, 1);
  const f = filterRecords(records, {start:'2026-11-01', end:'2026-11-30'});
  assert.equal(f.length, 3);
  assert.equal(aggregateAll(filterRecords(records, {focus:{field:'song',key:records[0].songKey}})).rowCount, 3);
});
test('month gaps counted as zero; missing name excluded only from that grouping', () => {
  const {headers,data} = parseSheetCSV('曲名,アーティスト,ユーザー,日付\nA,,U,2026/01/01\nB,P,V,2026/03/03');
  const records = createRecords(data, guessMapping(headers, data));
  const a = aggregateAll(records);
  assert.deepEqual(a.months.map(v => v.count), [1,0,1]);
  assert.equal(a.artists.length, 1);
  assert.equal(a.songs.length, 2);
});
test('CSV export prevents spreadsheet formula injection; links reject scripts', () => {
  assert.match(csvExport([['title','count'],['=1+2',2]]), /"'=1\+2"/);
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.match(safeHttpUrl('https://x.com/name/status/1'), /^https:\/\//);
});
