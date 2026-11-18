import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecords, guessMapping, parseSheetCSV } from '../lib/analytics.mjs';
import { combinedAliases, removeDuplicateRequests } from '../lib/v3.mjs';
import { aliasCandidates, dailyCounts, heatmapWindow, DJ_HEADERS, keyFor, replayDjList, validateOperation } from '../lib/v4.mjs';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const event = (number, song, action = 'add', status = '確認中', artist = 'P') => [id(number), song, artist, status, action, '2026-11-18T00:00:00Z'];

test('daily totals use the same deduplicated, aliased records as rankings', () => {
  const csv = '日時,ユーザー,曲名,ボカロP,URL\n' + [
    '2026/11/18,u,テスト曲,P,https://x.com/u/status/123',
    '2026/11/18,u,別表記,P,https://twitter.com/u/status/123',
    '2026/11/18,u,テスト曲(Remix),P,https://x.com/u/status/123',
    '2026/11/18,u,テスト曲,別P,https://x.com/u/status/123',
    ',u,日付なし,P,'
  ].join('\n');
  const { headers, data } = parseSheetCSV(csv);
  const aliases = combinedAliases({ songs: { '別表記': 'テスト曲' } });
  const records = createRecords(data, guessMapping(headers, data), aliases);
  assert.equal(dailyCounts(removeDuplicateRequests(records).records).get('2026-11-18'), 3);
  assert.equal(dailyCounts(records).get('2026-11-18'), 4);
});

test('alias suggestions keep different artists and different versions separate', () => {
  const rows = [
    { song: 'Same Song', artist: 'P' }, { song: 'Same-Song', artist: 'P' },
    { song: 'Same Song (Remix)', artist: 'P' }, { song: 'SameSong', artist: 'Other P' }
  ];
  const suggestions = aliasCandidates(rows);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].artist, 'P');
  assert.deepEqual(suggestions[0].labels.map(item => item.label).sort(), ['Same Song', 'Same-Song'].sort());
  assert.equal(aliasCandidates([...rows, { song: 'Same Song', artist: 'Other P' }]).length, 0);
  assert.notEqual(keyFor('曲', 'P'), keyFor('曲(Remix)', 'P'));
  assert.notEqual(keyFor('曲', 'P'), keyFor('曲', '別P'));
});

test('independent concurrent edits and duplicate retries retain other songs', () => {
  const rows = [DJ_HEADERS, event(1, 'A'), event(2, 'B'), event(3, 'A', 'status', '次回流したい'),
    event(4, 'B', 'status', '使用済み'), event(1, 'A'), event(5, 'A', 'delete'), event(6, 'A'), event(5, 'A', 'delete')];
  assert.deepEqual(replayDjList(rows).items, [
    { song: 'B', artist: 'P', status: '使用済み' }, { song: 'A', artist: 'P', status: '確認中' }
  ]);
});

test('stale status changes do not revive deleted candidates', () => {
  const rows = [DJ_HEADERS, event(1, 'A'), event(2, 'A', 'delete'), event(3, 'A', 'status', '使用済み')];
  assert.deepEqual(replayDjList(rows).items, []);
  assert.throws(() => replayDjList([['曲名', 'ボカロP', '状態', '更新日時']]), /列構成/);
});

test('rejects invalid operations before calling cloud storage', () => {
  assert.throws(() => validateOperation({ operationId: id(1), song: '曲', artist: 'P', action: 'save' }), /操作/);
  assert.throws(() => validateOperation({ operationId: id(1), song: '曲', artist: 'P', action: 'status', status: 'invalid' }), /状態/);
  assert.throws(() => validateOperation({ operationId: id(1), song: '曲\n', artist: 'P', action: 'add' }), /確認/);
});

test('heatmap pagination bounds rendering and includes every day without overlaps', () => {
  const start = '2024-01-01', end = '2026-12-31';
  const first = heatmapWindow(start, end);
  assert.equal(first.dates.length, 366);
  assert.equal(first.dates.at(-1), end);
  const days = [];
  for (let page = 0; page < first.pages; page++) {
    const result = heatmapWindow(start, end, page);
    assert.ok(result.dates.length <= 366);
    days.push(...result.dates);
  }
  assert.equal(days.length, 1096);
  assert.equal(new Set(days).size, days.length);
  assert.equal(days.sort()[0], start);
  assert.equal(heatmapWindow(start, end, 999).page, first.pages - 1);
});

test('heatmap handles a 300-year range with bounded output and empty intervals', () => {
  assert.equal(heatmapWindow('1900-01-01', '2199-12-31').dates.length, 366);
  assert.deepEqual(heatmapWindow(undefined, undefined).dates, []);
  assert.deepEqual(heatmapWindow('2026-12-31', '2026-01-01').dates, []);
  assert.ok(heatmapWindow('2024-02-28', '2024-03-01').dates.includes('2024-02-29'));
});
