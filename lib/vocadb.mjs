import { normalizeName } from './analytics.mjs';
import { trustedVideoUrl } from './video.mjs';

/** VocaDB's user-maintained metadata is only a candidate source, never proof of official upload. */
function comparison(raw) {
  return normalizeName(raw).replace(/[\s\p{P}\p{S}]/gu, '');
}
function similarity(reference, candidate) {
  const a=comparison(reference), b=comparison(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length,b.length)/Math.max(a.length,b.length) >= .65 ? .75 : .4;
  // Do not mistake partly matching titles for an exact match.
  return 0;
}
const safeString = (v, max=180) => typeof v === 'string' ? v.slice(0,max).trim() : '';
export function scoreSong(song, wantedSong, wantedArtist) {
  const names=[song.name,song.defaultName,...String(song.additionalNames??'').split(',')].filter(Boolean);
  const titleScore=Math.max(0,...names.map(n=>similarity(wantedSong,n)));
  const artistName = safeString(song.artistString,300);
  const artistValues = [artistName, ...(Array.isArray(song.artists)?song.artists.map(a=>a.name || a.artist?.name):[])].filter(Boolean);
  const artistScore= wantedArtist ? Math.max(0,...artistValues.map(n=>similarity(wantedArtist,n))) : 0;
  const songType=safeString(song.songType,50);
  const score=Math.max(0, Math.round(titleScore*70 + artistScore*30) - (/^(?:Cover|Remix|Remaster)$/i.test(songType) ? 12 : 0));
  return {score, titleMatch:titleScore, artistMatch:artistScore, songType};
}
export function mapVocaDbResults(payload, wantedSong, wantedArtist) {
  const songs=Array.isArray(payload?.items)?payload.items:[];
  return songs.slice(0,20).map(song=>{
    if (!Number.isSafeInteger(song?.id) || song.id<1) return null;
    const score=scoreSong(song,wantedSong,wantedArtist);
    // PV can be missing when some legacy/partial records are returned.
    const videos=(Array.isArray(song.pvs)?song.pvs:[]).map(pv=>{
      const safe=trustedVideoUrl(pv?.url);
      if (!safe) return null;
      return {url:safe.url, platform:safe.platform, title:safeString(pv.name,150), type:safeString(pv.pvType,30), author:safeString(pv.author,100)};
    }).filter(Boolean);
    const unique=[...new Map(videos.map(x=>[x.url,x])).values()].slice(0,12);
    return {
      id:song.id, title:safeString(song.name||song.defaultName,180),
      artist:safeString(song.artistString || (Array.isArray(song.artists)?song.artists.map(a=>a.name || a.artist?.name).filter(Boolean).join(', '):''),180), songType:score.songType,
      score:score.score,
      // Strict tag: a matched song/producer does not imply the PV is an official upload.
      confidence:score.titleMatch===1 && score.artistMatch===1 ? '曲名・アーティスト一致' :
        score.titleMatch===1 ? '曲名一致（投稿者要確認）' : '類似候補（要確認）',
      url:`https://vocadb.net/S/${song.id}`, videos:unique
    };
  }).filter(Boolean).filter(x=>x.score>=28)
    .sort((a,b)=>b.score-a.score || b.videos.length-a.videos.length || a.id-b.id)
    .slice(0,12);
}
// Persist confirmed links per normalized song+artist, never just by song title.
export function cleanVideoMap(input) {
  const result={};
  if (!input || typeof input!=='object' || Array.isArray(input)) return result;
  for (const [key,value] of Object.entries(input).slice(0,3000)) {
    if (!key.includes('\0') || key.length>400 || typeof value!=='object') continue;
    const safe=trustedVideoUrl(value?.url);
    if (safe) result[key]={url:safe.url, platform:safe.platform};
  }
  return result;
}
export function chosenVideoFor(record, globalMap, localMap) {
  const explicit=[record.youtube,record.niconico,record.video].map(trustedVideoUrl).find(Boolean);
  if (explicit) return {...explicit, origin:'sheet'};
  const key=record.songKey;
  const selected=trustedVideoUrl(localMap?.[key]?.url) || trustedVideoUrl(globalMap?.[key]?.url);
  return selected ? {...selected,origin:'chosen'} : null;
}
