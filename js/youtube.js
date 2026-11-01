/** Optional official YouTube Data API v3 client. API key lives only in sessionStorage. */
const KEY='vocafinder.youtube.key.session';
const CACHE='vocafinder.youtube.meta.v5';
const DAY=24*3600*1000;
const validKey = key => /^[A-Za-z0-9_-]{20,120}$/.test(String(key||''));
export const readYoutubeKey = () => {try {return sessionStorage.getItem(KEY)||'';}catch{return '';}};
export const saveYoutubeKey = key => {
  if(key && !validKey(key))throw new Error('APIキーの形式を確認してください。');
  try {if(key)sessionStorage.setItem(KEY,key);else sessionStorage.removeItem(KEY);return true;}
  catch{return false;}
};
export const readYoutubeCache = () => {
  try{
    const obj=JSON.parse(sessionStorage.getItem(CACHE)||'{}');
    return Object.fromEntries(Object.entries(obj).filter(([id,v])=>/^[\w-]{11}$/.test(id)&&v&&typeof v==='object'&&Date.now()-v.checkedAt<DAY).slice(0,1000));
  }catch{return {};}
};
export const saveYoutubeCache = object => {
  try{sessionStorage.setItem(CACHE,JSON.stringify(Object.fromEntries(Object.entries(object).slice(-1000))));return true;}catch{return false;}
};
const apiFetch=async(url,key,signal)=>{
  if(!validKey(key))throw new Error('YouTube Data APIキーが未設定です。');
  const u=new URL(url);u.searchParams.set('key',key);
  const response=await fetch(u,{signal,referrerPolicy:'strict-origin-when-cross-origin'});
  let data;try{data=await response.json();}catch{throw new Error('YouTube APIの応答形式が不正です。');}
  if(!response.ok)throw new Error('YouTube API: '+(data.error?.message||response.status));
  return data;
};
export const resolveChannel = async(ch,key,signal) => {
  if(ch.type==='id')return ch.value;
  const u=new URL('https://www.googleapis.com/youtube/v3/channels');
  u.searchParams.set('part','id');
  if(ch.type==='handle')u.searchParams.set('forHandle',ch.value);
  else if(ch.type==='user')u.searchParams.set('forUsername',ch.value);
  else return '';
  const data=await apiFetch(u,key,signal);
  return String(data.items?.[0]?.id||'');
};
export const fetchVideoOwners = async(ids,key,signal,onBatch) => {
  const unique=[...new Set(ids)].filter(v=>/^[A-Za-z0-9_-]{11}$/.test(v));
  let processed=0;
  const results={};
  for(let i=0;i<unique.length;i+=50){
    const batch=unique.slice(i,i+50);
    const u=new URL('https://www.googleapis.com/youtube/v3/videos');
    u.searchParams.set('part','snippet');u.searchParams.set('id',batch.join(','));u.searchParams.set('maxResults','50');
    const data=await apiFetch(u,key,signal);
    for(const item of data.items||[]){
      const id=item.id,ch=item.snippet?.channelId;
      if(/^[\w-]{11}$/.test(id)&&/^UC[\w-]{22}$/.test(ch||'')){
        results[id]={channelId:ch,channelTitle:String(item.snippet.channelTitle||''),method:'api',checkedAt:Date.now()};
      }
    }
    processed+=batch.length;
    if(onBatch)onBatch(processed,unique.length,results);
  }
  return results;
};
