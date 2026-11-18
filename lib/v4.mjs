import { normalizeName } from './analytics.mjs';

export const DJ_STATUSES = ['確認中', '次回流したい', '使用済み'];
export const DJ_HEADERS = ['操作ID', '曲名', 'ボカロP', '状態', '操作', '更新日時'];

export function keyFor(song, artist) {
  return normalizeName(song) + '\u0000' + normalizeName(artist);
}

export function dailyCounts(records) {
  const counts = new Map();
  for (const record of records) {
    if (record.date) counts.set(record.date, (counts.get(record.date) || 0) + 1);
  }
  return counts;
}

export function heatmapWindow(start, end, page = 0) {
  const dayMs = 86400000;
  const pageSize = 366;
  const first = Date.parse(start + 'T00:00:00Z');
  const last = Date.parse(end + 'T00:00:00Z');
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return { dates: [], page: 0, pages: 0 };
  const pages = Math.ceil((Math.floor((last - first) / dayMs) + 1) / pageSize);
  const current = Math.max(0, Math.min(Number.isInteger(page) ? page : 0, pages - 1));
  const pageEnd = last - current * pageSize * dayMs;
  const pageStart = Math.max(first, pageEnd - (pageSize - 1) * dayMs);
  const dates = [];
  for (let timestamp = pageStart; timestamp <= pageEnd; timestamp += dayMs) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return { dates, page: current, pages };
}

// 記号の違いだけを候補にする。Remix / Live / カバーなどの語句は残す。
function suggestionKey(label) {
  return normalizeName(label).replace(/[\s\-‐‑–—_・･.。!！?？'"「」『』()（）\[\]]/g, '');
}

export function aliasCandidates(records) {
  const suggestions = [];
  for (const type of ['songs', 'artists']) {
    const field = type === 'songs' ? 'song' : 'artist';
    const groups = new Map();
    const songArtists = new Map();
    for (const record of records) {
      const label = record[field];
      if (!label || (type === 'songs' && !record.artist)) continue;
      const normalized = normalizeName(label);
      if (!songArtists.has(normalized)) songArtists.set(normalized, new Set());
      songArtists.get(normalized).add(normalizeName(record.artist));
      const key = suggestionKey(label) + (type === 'songs' ? '\u0000' + normalizeName(record.artist) : '');
      if (!suggestionKey(label)) continue;
      if (!groups.has(key)) groups.set(key, { artist: record.artist, labels: new Map() });
      const group = groups.get(key);
      group.labels.set(label, (group.labels.get(label) || 0) + 1);
    }
    for (const group of groups.values()) {
      const labels = [...group.labels].map(([label, count]) => ({ label, count }));
      if (new Set(labels.map(item => normalizeName(item.label))).size < 2) continue;
      // 曲名ルールは既存仕様で全体に適用されるため、別Pにも現れる曲名は候補から外す。
      if (type === 'songs' && labels.some(item => songArtists.get(normalizeName(item.label)).size > 1)) continue;
      labels.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'));
      suggestions.push({ type, artist: type === 'songs' ? group.artist : '', labels });
    }
  }
  return suggestions.slice(0, 80);
}

export function validateOperation(input) {
  if (!input || !['add', 'status', 'delete'].includes(input.action)) throw new Error('操作を確認してください。');
  if (typeof input.operationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.operationId)) {
    throw new Error('操作IDが不正です。');
  }
  const item = {};
  for (const [field, max] of [['song', 200], ['artist', 160]]) {
    const value = input[field];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error('曲名とボカロPを確認してください。');
    }
    item[field] = value.trim();
  }
  const status = input.action === 'add' ? '確認中' : input.status;
  if (input.action !== 'delete' && !DJ_STATUSES.includes(status)) throw new Error('状態を確認してください。');
  return { ...item, action: input.action, operationId: input.operationId, status: status || '' };
}

export function replayDjList(rows) {
  if (!Array.isArray(rows) || DJ_HEADERS.some((label, index) => rows[0]?.[index] !== label)) {
    throw new Error('DJ選曲候補シートの列構成を確認してください。');
  }
  const items = new Map();
  const operationIds = new Set();
  for (const row of rows.slice(1)) {
    if (!row.some(value => String(value).trim())) continue;
    const operation = validateOperation({ operationId: row[0], song: row[1], artist: row[2], status: row[3], action: row[4] });
    if (operationIds.has(operation.operationId)) continue;
    operationIds.add(operation.operationId);
    const key = keyFor(operation.song, operation.artist);
    if (operation.action === 'delete') items.delete(key);
    if (operation.action === 'add' && !items.has(key)) {
      items.set(key, { song: operation.song, artist: operation.artist, status: operation.status });
    }
    if (operation.action === 'status' && items.has(key)) items.get(key).status = operation.status;
  }
  return { items: [...items.values()], operationIds };
}
