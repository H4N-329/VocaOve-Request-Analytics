/** Pure aggregation helpers: no browser dependencies. One spreadsheet row equals one request. */
export const FIELDS = ['song', 'artist', 'user', 'date', 'url'];

export function parseCSV(input) {
  const csv = String(input ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(value); value = ''; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      row.push(value); value = '';
      if (row.some(cell => String(cell).trim())) rows.push(row);
      row = [];
    } else value += c;
  }
  if (value || row.length) { row.push(value); if (row.some(cell => String(cell).trim())) rows.push(row); }
  return rows;
}

export function makeHeaders(row) {
  const counts = new Map();
  return row.map((item, i) => {
    const value = String(item ?? '').trim() || `列 ${i + 1}`;
    const n = (counts.get(value) || 0) + 1;
    counts.set(value, n);
    return n === 1 ? value : `${value} (${n})`;
  });
}

export function parseSheetCSV(csv) {
  const raw = parseCSV(csv);
  if (!raw.length) throw new Error('CSVが空です。1行目に項目名を入力してください。');
  const headers = makeHeaders(raw[0]);
  const data = raw.slice(1).map((cells, index) => ({
    index: index + 2,
    cells: headers.map((_, i) => String(cells[i] ?? '').trim())
  }));
  return { headers, data };
}

export function normalizeName(raw) {
  return String(raw ?? '').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/g, ' ').trim();
}
export function userKey(raw) {
  let text = normalizeName(raw).replace(/^@/, '');
  const m = text.match(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([a-z0-9_]+)\/?(?:\?.*)?$/i);
  if (m) text = m[1];
  return text;
}

const HEADER_HINTS = {
  song: ['楽曲名', 'リクエスト曲名', 'リクエスト曲', '曲名', '楽曲', 'ボカロ曲', 'タイトル', 'songtitle', 'song', 'track', 'music', 'title'],
  artist: ['アーティスト名', 'アーティスト', 'ボカロp', 'ボカロＰ', '作曲者', '制作者', 'プロデューサー', '作者', 'artistname', 'artist', 'producer', 'composer'],
  user: ['投稿ユーザー名', '投稿ユーザー', 'ユーザー名', '投稿者名', '投稿者', '投稿アカウント', 'リクエスト者', 'ユーザーid', 'ユーザー', 'アカウント名', 'アカウント', 'xユーザー', 'twitterid', 'username', 'handle', 'account', 'user'],
  date: ['投稿日時', '投稿日', 'ポスト日時', 'ツイート日時', '日付', '投稿時間', '作成日時', 'タイムスタンプ', 'createdat', 'timestamp', 'created', 'datetime', 'date', 'time'],
  url: ['投稿url', 'ポストurl', 'ツイートurl', 'xurl', '投稿リンク', 'ポストリンク', 'ツイートリンク', 'xリンク', 'url', 'リンク', 'tweeturl', 'posturl', 'permalink', 'link']
};
function compact(raw) { return normalizeName(raw).replace(/[\s\-_#:\[\]（）()・]/g, ''); }

export function parsePostDate(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  // Epoch timestamps and spreadsheet serial-date values.
  if (/^\d{13}$/.test(v) || /^\d{10}$/.test(v)) {
    const epoch = Number(v) * (v.length === 10 ? 1000 : 1);
    const d = new Date(epoch);
    if (!Number.isNaN(d.getTime())) return japanDate(d);
  }
  if (/^\d{5}(?:\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  // ISO timestamp with an explicit UTC offset. Group by Japan-local calendar date.
  if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d.*(?:Z|[+\-]\d\d:?\d\d)$/i.test(v)) {
    const d = new Date(v.replace(' ', 'T'));
    if (!Number.isNaN(d.getTime())) return japanDate(d);
  }
  const m = v.match(/^(\d{4})[\-/.年](\d{1,2})(?:[\-/.月](\d{1,2}))?(?:日)?(?:\b|\s|T|\(|（|$)/);
  if (m) {
    const y = Number(m[1]), mon = Number(m[2]), day = m[3] ? Number(m[3]) : 1;
    const d = new Date(Date.UTC(y, mon - 1, day));
    if (y >= 1900 && y < 2200 && d.getUTCFullYear() === y && d.getUTCMonth() + 1 === mon && d.getUTCDate() === day) {
      return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}
function japanDate(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}

export function guessMapping(headers, data = []) {
  const available = new Set(headers.map((_, i) => i));
  const picked = {};
  for (const field of FIELDS) {
    const scored = headers.map((h, idx) => {
      const val = compact(h);
      let score = 0;
      for (const name of HEADER_HINTS[field]) {
        const hint = compact(name);
        if (val === hint) score = Math.max(score, 100 + hint.length);
        else if (val.includes(hint)) score = Math.max(score, 45 + hint.length);
      }
      // Reduce collisions: song-url, artist-URL, or account-ID must not shadow actual columns.
      if (field !== 'url' && /(url|リンク)/.test(val)) score = 0;
      if (field === 'song' && /(アーティスト|artist|作者|作曲)/.test(val)) score = 0;
      if (field === 'user' && /(楽曲|曲名|アーティスト|artist)/.test(val)) score = 0;
      if (field !== 'date' && /(日時|投稿日|投稿時間|timestamp|date)/.test(val)) score = 0;
      return { idx, score };
    }).filter(x => available.has(x.idx)).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best?.score > 0) { picked[field] = best.idx; available.delete(best.idx); }
    else picked[field] = -1;
  }
  const sample = data.slice(0, 40);
  // Recover date and URL columns when headers are unhelpful.
  for (const field of ['date', 'url']) {
    if (picked[field] !== -1) continue;
    const candidates = [...available].map(idx => {
      const values = sample.map(item => item.cells[idx]).filter(Boolean);
      const score = values.length ? values.filter(v => field === 'date' ? !!parsePostDate(v) : /^https?:\/\//i.test(v)).length / values.length : 0;
      return { idx, score };
    }).sort((a,b) => b.score - a.score);
    if (candidates.length && candidates[0].score >= 0.65) {
      picked[field] = candidates[0].idx;
      available.delete(candidates[0].idx);
    }
  }
  return picked;
}

export function createRecords(data, mapping) {
  const col = (item, name) => Number.isInteger(mapping[name]) && mapping[name] >= 0 ? String(item.cells[mapping[name]] ?? '').trim() : '';
  return data.map(item => {
    const song = col(item, 'song'), artist = col(item, 'artist'), user = col(item, 'user');
    const rawDate = col(item, 'date');
    const date = parsePostDate(rawDate);
    return {
      index: item.index, song, artist, user, rawDate, date, month: date?.slice(0, 7) ?? '',
      url: col(item, 'url'), songKey: normalizeName(song) + '\u0000' + normalizeName(artist),
      artistKey: normalizeName(artist), userKey: userKey(user),
      search: normalizeName([song, artist, user, rawDate, col(item, 'url')].join(' '))
    };
  });
}

export function filterRecords(records, filters = {}) {
  const q = normalizeName(filters.query);
  return records.filter(r => {
    if (q && !r.search.includes(q)) return false;
    if (filters.start && (!r.date || r.date < filters.start)) return false;
    if (filters.end && (!r.date || r.date > filters.end)) return false;
    if (filters.focus?.field && filters.focus?.key != null) {
      const key = filters.focus.field === 'song' ? r.songKey : filters.focus.field === 'artist' ? r.artistKey : r.userKey;
      if (key !== filters.focus.key) return false;
    }
    return true;
  });
}

function aggregate(items, keyFn, labelFn, detailFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key || (typeof key === 'string' && !key.replace(/\u0000/g, '').trim())) continue;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: labelFn(item), detail: detailFn(item), count: 0, songKeys: new Set(), users: new Set() };
      groups.set(key, group);
    }
    group.count++;
    if (item.song) group.songKeys.add(item.songKey);
    if (item.userKey) group.users.add(item.userKey);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'))
    .map((g, i) => ({ rank: i + 1, key: g.key, label: g.label, detail: g.detail, count: g.count, uniqueSongs: g.songKeys.size, uniqueUsers: g.users.size }));
}

function enumerateMonths(start, end) {
  if (!start || !end) return [];
  const output = [], [sy, sm] = start.split('-').map(Number), [ey, em] = end.split('-').map(Number);
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m++) {
    if (m > 12) { y++; m = 1; }
    output.push(`${y}-${String(m).padStart(2, '0')}`);
    if (output.length >= 240) break;
  }
  return output;
}

export function aggregateAll(records) {
  const songs = aggregate(records.filter(r => r.song), r => r.songKey, r => r.song, r => r.artist || 'アーティスト未登録');
  const artists = aggregate(records.filter(r => r.artist), r => r.artistKey, r => r.artist, () => '');
  const users = aggregate(records.filter(r => r.user), r => r.userKey, r => r.user, () => '');
  const dated = records.filter(r => !!r.month);
  const countMonths = new Map();
  for (const row of dated) countMonths.set(row.month, (countMonths.get(row.month) || 0) + 1);
  const sortedMonths = [...countMonths.keys()].sort();
  const months = sortedMonths.length ? enumerateMonths(sortedMonths[0], sortedMonths.at(-1)).map(month => ({ month, count: countMonths.get(month) || 0 })) : [];
  return { songs, artists, users, months, datedCount: dated.length, undatedCount: records.length - dated.length, rowCount: records.length };
}

export function safeHttpUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}

export function csvExport(rows) {
  const encode = v => {
    let text = String(v ?? '');
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + rows.map(row => row.map(encode).join(',')).join('\r\n') + '\r\n';
}
