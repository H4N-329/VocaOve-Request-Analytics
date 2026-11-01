import {numericBpm, isoDate, validSiteUrl} from './utils.js';
const KEY='vocafinder.edits.v2';
const MAX=5000;
export const cleanEdit=raw=>{
  const e={};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return e;
  if(raw.bpm!==undefined && raw.bpm!=='' && raw.bpm!==null){const n=numericBpm(raw.bpm);if(n!==null)e.bpm=n;}
  if(validSiteUrl(raw.youtubeUrl,'youtube'))e.youtubeUrl=raw.youtubeUrl;
  if(validSiteUrl(raw.nicoUrl,'nico'))e.nicoUrl=raw.nicoUrl;
  if(validSiteUrl(raw.spotifyUrl,'spotify'))e.spotifyUrl=raw.spotifyUrl;
  if(validSiteUrl(raw.streamingUrl,'apple')||validSiteUrl(raw.streamingUrl,'spotify'))e.streamingUrl=raw.streamingUrl;
  if(isoDate(raw.streamingDate))e.streamingDate=raw.streamingDate;
  if(['Apple Music / iTunes','Spotify (手入力)','その他 (手入力)'].includes(raw.streamingSource))e.streamingSource=raw.streamingSource;
  if(isoDate(raw.youtubePublished))e.youtubePublished=raw.youtubePublished;
  if(isoDate(raw.nicoPublished))e.nicoPublished=raw.nicoPublished;
  return e;
};
export const loadEdits=()=>{
  try{
    const value=JSON.parse(localStorage.getItem(KEY)||'{}');
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    return Object.fromEntries(Object.entries(value).filter(([id])=>/^(?:\d{1,10}|local:[a-z0-9-]{5,60})$/.test(id)).slice(0,MAX).map(([id,v])=>[id,cleanEdit(v)]));
  }catch{return {};}
};
export const saveEdits=edits=>{
  try{localStorage.setItem(KEY,JSON.stringify(edits));return true;}catch{return false;}
};
export const validateImport=obj=>{
  if(!obj||!['vocafinder-edits-v2','vocafinder-backup-v4','vocafinder-backup-v5'].includes(obj.format)||typeof obj.edits!=='object'||!obj.edits||Array.isArray(obj.edits))throw new Error('VocaFinder v2用のバックアップではありません。');
  const entries=Object.entries(obj.edits);
  if(entries.length>MAX)throw new Error('登録曲数の上限を超えています。');
  return Object.fromEntries(entries.filter(([id])=>/^(?:\d{1,10}|local:[a-z0-9-]{5,60})$/.test(id)).map(([id,v])=>[id,cleanEdit(v)]));
};
export const backupJson = (edits,addedSongs=[],channels={},uploaders={}) => JSON.stringify({format:'vocafinder-backup-v5',exportedAt:new Date().toISOString(),edits,addedSongs,channels,uploaders},null,2);
