/** Video destinations deliberately do not guess a watch ID from a title. */
export function trustedVideoUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!/^https:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    const youtube = ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host) &&
      ((path === '/watch' && /^[a-zA-Z0-9_-]{11}$/.test(u.searchParams.get('v') ?? '')) ||
       /^\/(?:shorts|live|embed)\/[a-zA-Z0-9_-]{11}\/?$/.test(path));
    const shortYouTube = host === 'youtu.be' && /^\/[a-zA-Z0-9_-]{11}\/?$/.test(path);
    if (youtube || shortYouTube) return { url: u.href, platform: 'YouTube' };
    const nico = ['www.nicovideo.jp', 'nicovideo.jp', 'sp.nicovideo.jp'].includes(host) &&
      /^\/watch\/(?:sm|nm|so)\d+\/?$/i.test(path);
    const nicoShort = host === 'nico.ms' && /^\/(?:sm|nm|so)\d+\/?$/i.test(path);
    if (nico || nicoShort) return { url: u.href, platform: 'ニコニコ動画' };
    return null;
  } catch { return null; }
}
export function youtubeSearchUrl(song, artist) {
  const q = [song, artist].map(v=>String(v ?? '').trim()).filter(Boolean).join(' ');
  return q ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : null;
}
export function niconicoSearchUrl(song, artist) {
  const q = [song, artist].map(v=>String(v ?? '').trim()).filter(Boolean).join(' ');
  return q ? `https://www.nicovideo.jp/search/${encodeURIComponent(q)}` : null;
}
/** Main link opens an exact supplied video if present, otherwise search results.
 * Extra link offers Niconico search for songs with no verified video URL.
 */
export function songVideoLinks(record) {
  if (!String(record.song ?? '').trim()) return { main: null, alternate: null };
  const direct = [record.youtube, record.niconico, record.video].map(trustedVideoUrl).find(Boolean);
  if (direct) return { main: { ...direct, mode: 'direct' }, alternate: null };
  return {
    main: { url: youtubeSearchUrl(record.song, record.artist), platform: 'YouTube', mode: 'search' },
    alternate: { url: niconicoSearchUrl(record.song, record.artist), platform: 'ニコニコ動画', mode: 'search' }
  };
}

/** Share one verified video destination with other requests for the *same* song+artist.
 * This allows the spreadsheet to carry the video's URL only once per song. */
export function inheritVideoUrls(records) {
  const bySong = new Map();
  for (const r of records) {
    if (!r.songKey || !String(r.song ?? '').trim()) continue;
    const shared = bySong.get(r.songKey) ?? {};
    for (const field of ['youtube','niconico','video']) {
      if (!shared[field] && trustedVideoUrl(r[field])) shared[field] = r[field];
    }
    bySong.set(r.songKey, shared);
  }
  return records.map(r => {
    const shared = bySong.get(r.songKey);
    if (!shared) return r;
    return { ...r,
      youtube: trustedVideoUrl(r.youtube) ? r.youtube : (shared.youtube ?? ''),
      niconico: trustedVideoUrl(r.niconico) ? r.niconico : (shared.niconico ?? ''),
      video: trustedVideoUrl(r.video) ? r.video : (shared.video ?? '')
    };
  });
}
