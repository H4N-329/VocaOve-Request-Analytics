export const safeUrl = (value) => {
  try {
    if (!value || typeof value !== 'string') return '';
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
};
export const validSiteUrl = (value, service) => {
  const url = safeUrl(value);
  if (!url) return false;
  const host = new URL(url).hostname.toLowerCase();
  const allowed = {
    youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
    nico: ['nicovideo.jp', 'nico.ms'],
    spotify: ['spotify.com'],
    apple: ['apple.com', 'itunes.apple.com'],
  }[service] || [];
  return allowed.some(domain => host === domain || host.endsWith('.' + domain));
};
export const dateString = value => {
  const m = String(value || '').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  return m ? `${m[1]}/${m[2]}${m[3] ? '/' + m[3] : ''}` : (String(value || '').match(/^\d{4}$/) ? String(value) : '未登録');
};
export const isoDate = value => {
  const v = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const [y,m,d] = v.split('-').map(Number);
  const date = new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d ? v : '';
};
export const numericBpm = value => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 20 && n <= 400 ? Math.round(n * 100) / 100 : null;
};
export const serverBpm = song => {
  const a = Number(song?.minMilliBpm || 0)/1000;
  const b = Number(song?.maxMilliBpm || 0)/1000;
  if (!(a > 0 || b > 0)) return null;
  return {min: +(a||b).toFixed(2), max: +(b||a).toFixed(2)};
};
export const effectiveBpm = (song, edit={}) => {
  const manual = numericBpm(edit.bpm);
  if (manual !== null) return {min:manual,max:manual,manual:true};
  const b = serverBpm(song); return b ? {...b,manual:false} : null;
};
export const bpmLabel = bpm => bpm ? (bpm.min === bpm.max ? String(bpm.min) : `${bpm.min}–${bpm.max}`) : '未登録';
export const artistString = song => song?.artistString || (song?.artists||[]).map(a=>a.name || a.artist?.name).filter(Boolean).join(' / ') || '未登録';
export const pvsByService = (song, name) => (song?.pvs || []).filter(p => String(p.service||'').toLowerCase().includes(name.toLowerCase()) && safeUrl(p.url));
export const getLinks = (song, edit={}) => {
  const nico = edit.nicoUrl || pvsByService(song,'nico').sort((a,b)=>Number(b.pvType==='Original')-Number(a.pvType==='Original'))[0]?.url || '';
  const youtube = edit.youtubeUrl || song.verifiedYoutubeUrl || pvsByService(song,'youtube').sort((a,b)=>Number(b.pvType==='Original')-Number(a.pvType==='Original'))[0]?.url || '';
  return {nico: safeUrl(nico), youtube: safeUrl(youtube)};
};
export const videoDate = (song, edit={}) => {
  const dates = [...(song?.pvs||[]).map(v=>v.publishDate).filter(Boolean),edit.nicoPublished,edit.youtubePublished].filter(Boolean).sort();
  return dates[0] || '';
};
export const coverUrl = song => safeUrl(song.mainPicture?.url) || safeUrl(song.thumbUrl) || safeUrl(song.pvs?.find(p=>p.thumbUrl)?.thumbUrl) || '';
export const formatCsvCell = value => {
  let s = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'"+s; // Spreadsheet formula injection protection.
  return '"' + s.replaceAll('"','""') + '"';
};
export const createCsv = (rows, headers) => '\uFEFF'+[headers,...rows].map(row=>row.map(formatCsvCell).join(',')).join('\r\n');
export const matchesBpm = (song, edit, min, max, onlyKnown=false) => {
  const b = effectiveBpm(song,edit);
  if(!b) return !(onlyKnown || min !== null || max !== null);
  return (min===null || b.max>=min) && (max===null || b.min<=max);
};
export const sortSongs = (songs, mode, edits={}) => [...songs].sort((a,b)=>{
  if(mode==='bpmAsc'||mode==='bpmDesc'){
    const x=effectiveBpm(a,edits[a.id])?.min;
    const y=effectiveBpm(b,edits[b.id])?.min;
    if(x === undefined)return y === undefined?0:1;
    if(y === undefined)return -1;
    return mode==='bpmAsc'?x-y:y-x;
  }
  if(mode==='dateAsc'||mode==='dateDesc'||mode==='uploadAsc'||mode==='uploadDesc'){
    const videoSort=mode==='uploadAsc'||mode==='uploadDesc';
    const x=(videoSort?(videoDate(a,edits[a.id])||a.publishDate):a.publishDate||'').slice(0,10);
    const y=(videoSort?(videoDate(b,edits[b.id])||b.publishDate):b.publishDate||'').slice(0,10);
    if(!x)return y?1:0;
    if(!y)return -1;
    return ['dateAsc','uploadAsc'].includes(mode)?x.localeCompare(y):y.localeCompare(x);
  }
  if(mode==='name') return String(a.name||'').localeCompare(String(b.name||''),'ja');
  return 0;
});
export const normalizedName = s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\-_.・()（）\[\]【】]/g,'');
export const likelySameTitle = (a,b) => {
  const x=normalizedName(a),y=normalizedName(b);
  return x && y && (x===y || x.includes(y) && y.length>=5 || y.includes(x) && x.length>=5);
};
