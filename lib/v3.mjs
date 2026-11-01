import { normalizeName, userKey, aggregateAll } from './analytics.mjs';

export const DEFAULT_ALIASES = { songs: {}, artists: {}, users: {} };
export function cleanAliases(source = {}) {
  const cleaned = { songs: {}, artists: {}, users: {} };
  for (const type of Object.keys(cleaned)) {
    const group = source?.[type];
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    for (const [raw, canonical] of Object.entries(group)) {
      const key = type === 'users' ? userKey(raw) : normalizeName(raw);
      const label = String(canonical ?? '').trim().slice(0, 200);
      if (key && label && key !== (type === 'users' ? userKey(label) : normalizeName(label))) cleaned[type][key] = label;
    }
  }
  return cleaned;
}
export function combinedAliases(global = DEFAULT_ALIASES, local = DEFAULT_ALIASES) {
  const base = cleanAliases(global), override = cleanAliases(local);
  for (const type of Object.keys(base)) Object.assign(base[type], override[type]);
  return base;
}
export function resolveAlias(raw, type, aliases = DEFAULT_ALIASES) {
  let label = String(raw ?? '').trim();
  const group = aliases?.[type] || {};
  const visited = new Set();
  for (let step = 0; step < 12; step++) {
    const key = type === 'users' ? userKey(label) : normalizeName(label);
    if (visited.has(key)) break;
    visited.add(key);
    const next = group[key];
    if (typeof next !== 'string' || !next.trim()) break;
    label = next.trim();
  }
  return label;
}
export function recordDedupeKey(record) {
  const raw = String(record.url ?? '').trim();
  if (!raw) return '';
  let post = '';
  try {
    const u = new URL(raw);
    if (!['https:','http:'].includes(u.protocol)) return '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
      const match = path.match(/^\/[a-z0-9_]+\/status\/(\d+)/);
      if (match) post = `x:${match[1]}`;
    }
    if (!post) post = `${host}${path}`;
  } catch { return ''; }
  return `${post}\u0000${record.songKey}`;
}
export function removeDuplicateRequests(records, enabled = true) {
  if (!enabled) return { records: [...records], removed: 0 };
  const seen = new Set(), kept = [];
  let removed = 0;
  for (const r of records) {
    const key = recordDedupeKey(r);
    if (key && seen.has(key)) { removed++; continue; }
    if (key) seen.add(key);
    kept.push(r);
  }
  return { records: kept, removed };
}
function offset(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) throw new Error('Invalid ISO date');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function periodFor(mode, today) {
  if (!['7','30'].includes(String(mode))) return {mode:'all', start:'', end:'', prevStart:'', prevEnd:''};
  const days = Number(mode);
  return { mode:String(mode), start:offset(today, 1-days), end: today,
    prevStart:offset(today, 1-2*days), prevEnd:offset(today, -days) };
}
export function inPeriod(row, start, end) { return !!row.date && row.date >= start && row.date <= end; }
export function makeTrends(current, previous, allRecords, start, type = 'song') {
  const keyName = type === 'song' ? 'songKey' : type === 'artist' ? 'artistKey' : 'userKey';
  const oldRank = new Map(previous.map(r=>[r.key, r.rank]));
  const earlier = new Set(allRecords.filter(r=> !r.date || r.date < start).map(r=>r[keyName]));
  return new Map(current.map(r=>{
    const prev = oldRank.get(r.key);
    return [r.key, {
      change: prev == null ? null : prev - r.rank,
      isNew: type === 'song' && prev == null && !earlier.has(r.key),
      isReturning: prev == null && earlier.has(r.key)
    }];
  }));
}
export function computeTrends(records, {mode, today, query = '', start = '', end = '', focus = null} = {}) {
  const p = periodFor(mode, today);
  if (p.mode === 'all') return {period:p, songs:new Map(), artists:new Map(), users:new Map()};
  const norm = normalizeName(query);
  const base = records.filter(r => {
    if (norm && !r.search.includes(norm)) return false;
    if (start && (!r.date || r.date < start)) return false;
    if (end && (!r.date || r.date > end)) return false;
    if (focus) {
      const k = focus.field === 'song' ? r.songKey : focus.field === 'artist' ? r.artistKey : r.userKey;
      if (k !== focus.key) return false;
    }
    return true;
  });
  const current = aggregateAll(base.filter(r=>inPeriod(r,p.start,p.end)));
  const previous = aggregateAll(base.filter(r=>inPeriod(r,p.prevStart,p.prevEnd)));
  return {period:p,
    songs:makeTrends(current.songs,previous.songs,base,p.start,'song'),
    artists:makeTrends(current.artists,previous.artists,base,p.start,'artist'),
    users:makeTrends(current.users,previous.users,base,p.start,'user')};
}
