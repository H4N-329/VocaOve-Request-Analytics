import {numericBpm,isoDate,validSiteUrl,normalizedName} from './utils.js';
const MANUAL_KEY='vocafinder.additionalUploads.v4';
const MANUAL_MAX=300;
export const validLocalId=id=>/^local:[a-z0-9-]{5,60}$/.test(String(id));
export const sanitizeAdded=raw=>{
  const originalUrl=raw?.url||raw?.sourceUrl||raw?.pvs?.[0]?.url;
  if(!raw||!validLocalId(raw.id)||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>160||
    !/^[0-9]{1,10}$/.test(String(raw.artistId||''))||!validSiteUrl(originalUrl,'youtube')&&!validSiteUrl(originalUrl,'nico'))return null;
  const n={id:raw.id,artistId:String(raw.artistId),artistKey:normalizedName(raw.artistName),name:raw.name.trim(),
    artistString:String(raw.artistName||'').slice(0,160),songType:['Original','Cover','Remix','Other'].includes(raw.songType)?raw.songType:'Other',
    userAdded:true,sourceUrl:String(originalUrl),pvs:[{service:validSiteUrl(originalUrl,'youtube')?'Youtube':'NicoNicoDouga',url:originalUrl,pvType:'Original'}]};
  if(isoDate(raw.publishDate)){n.publishDate=raw.publishDate;n.pvs[0].publishDate=raw.publishDate;}
  const videoId=(String(originalUrl).match(/(?:v=|youtu\.be\/)([\w-]{11})/)||[])[1];
  if(videoId)n.thumbUrl=`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return n;
};
export const cleanManualList=list=>!Array.isArray(list)?[]:list.slice(0,MANUAL_MAX).map(sanitizeAdded).filter(Boolean);
export const loadManual=()=>{try{return cleanManualList(JSON.parse(localStorage.getItem(MANUAL_KEY)||'[]'));}catch{return [];}};
export const saveManual=list=>{try{localStorage.setItem(MANUAL_KEY,JSON.stringify(cleanManualList(list)));return true;}catch{return false;}};
export const manualForArtist=(all,artist)=>all.filter(a=>a.artistId===String(artist.id)||a.artistKey===normalizedName(artist.name));
