import {normalizeYoutubeChannel} from './official.js';
const CHANNEL_KEY='vocafinder.artist.channels.v5';
const OWNER_KEY='vocafinder.manual.videoowners.v5';
const parseSaved = key=>{try{const x=JSON.parse(localStorage.getItem(key)||'{}');return x&&typeof x==='object'&&!Array.isArray(x)?x:{};}catch{return {};}};
export const sanitizeManualChannels = raw => {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  const result={};
  for(const [artistId,list] of Object.entries(raw).slice(0,2000)){
    if(!/^\d{1,10}$/.test(artistId)||!Array.isArray(list))continue;
    const channels=[];
    for(const v of list.slice(0,20)){
      const c=normalizeYoutubeChannel(typeof v==='string'?v:v?.url);
      if(c&&!channels.some(x=>x.key===c.key))channels.push({...c,source:'手動登録'});
    }
    if(channels.length)result[artistId]=channels;
  }
  return result;
};
export const sanitizeUploaders = raw => {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  const result={};
  for(const [videoId,data] of Object.entries(raw).slice(0,2000)){
    if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))continue;
    const ch=normalizeYoutubeChannel(typeof data==='string'?data:data?.url);
    if(ch)result[videoId]={channelId:ch.type==='id'?ch.value:'',channelKey:ch.key,channelTitle:'（手動入力）',url:ch.url,method:'manual'};
  }
  return result;
};
export const loadManualChannels=()=>sanitizeManualChannels(parseSaved(CHANNEL_KEY));
export const loadManualUploaders=()=>sanitizeUploaders(parseSaved(OWNER_KEY));
export const saveManualChannels = obj=>{try{localStorage.setItem(CHANNEL_KEY,JSON.stringify(sanitizeManualChannels(obj)));return true;}catch{return false;}};
export const saveManualUploaders = obj=>{try{localStorage.setItem(OWNER_KEY,JSON.stringify(sanitizeUploaders(obj)));return true;}catch{return false;}};
