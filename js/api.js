/** External, read-only API clients. All calls run in the visitor's browser. */
const ROOT='https://vocadb.net/api';
const FIELDS='Artists,MainPicture,ThumbUrl,PVs,Bpm,WebLinks,Albums';
const memo=new Map();
const CACHED_MS=5*60_000;
const inCache=key=>{const hit=memo.get(key);return hit&&Date.now()-hit.time<CACHED_MS?hit.data:null;};
const saveCache=(key,data)=>{if(memo.size>=60)memo.delete(memo.keys().next().value);memo.set(key,{time:Date.now(),data});return data;};
const cachedFetch=async(url,signal)=>{
  const key=url.toString(),hit=inCache(key);if(hit)return hit;
  const response=await fetch(key,{signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('HTTP '+response.status);
  return saveCache(key,await response.json());
};
export const findSongs=({query='',artistId=null,offset=0,limit=20,sort='None',signal})=>{
  const u=new URL(ROOT+'/songs');
  if(query)u.searchParams.set('query',query);
  if(artistId){u.searchParams.set('artistId',String(artistId));u.searchParams.set('artistParticipationStatus','Everything');}
  u.searchParams.set('start',String(offset));
  u.searchParams.set('maxResults',String(limit));
  u.searchParams.set('getTotalCount','true');
  u.searchParams.set('nameMatchMode','Partial');
  u.searchParams.set('fields',FIELDS);
  u.searchParams.set('lang','Japanese');
  if(sort!=='None')u.searchParams.set('sort',sort);
  return cachedFetch(u,signal);
};
export const findArtists=(term,signal)=>{
  const u=new URL(ROOT+'/artists');
  u.searchParams.set('query',term);
  u.searchParams.set('nameMatchMode','Partial');
  u.searchParams.set('maxResults','15');
  u.searchParams.set('lang','Japanese');
  return cachedFetch(u,signal);
};
export const fetchArtist=(id,signal)=>{
  const u=new URL(ROOT+'/artists/'+encodeURIComponent(id));
  u.searchParams.set('fields','WebLinks');u.searchParams.set('lang','Japanese');
  return cachedFetch(u,signal);
};
export const fetchSong=(id,signal)=>{
  const u=new URL(ROOT+'/songs/'+encodeURIComponent(id));
  u.searchParams.set('fields',FIELDS);u.searchParams.set('lang','Japanese');
  return cachedFetch(u,signal);
};

// Apple explicitly supports JSONP callback for website cross-origin searches.
// The fixed endpoint is trusted; callback and script are removed after completion.
let jsonpCounter=0;
export const findITunes=(term)=>{
  const u=new URL('https://itunes.apple.com/search');
  u.searchParams.set('term',term);
  u.searchParams.set('media','music');
  u.searchParams.set('entity','song');
  u.searchParams.set('country','jp');
  u.searchParams.set('lang','ja_jp');
  u.searchParams.set('limit','15');
  const cacheKey=u.toString();const cached=inCache(cacheKey);
  if(cached)return Promise.resolve(cached);
  return new Promise((resolve,reject)=>{
    const callback='__vocafinderApple'+(++jsonpCounter),script=document.createElement('script');
    let finished=false;
    const finish=(error,payload)=>{
      if(finished)return;finished=true;clearTimeout(timer);
      script.remove();delete window[callback];
      if(error)reject(error);else resolve(saveCache(cacheKey,payload));
    };
    window[callback]=payload=>{
      try{const data=typeof payload==='string'?JSON.parse(payload):payload;
        if(!data||!Array.isArray(data.results))throw new Error('Appleの応答形式が不明です');
        finish(null,data.results);
      }catch(e){finish(e);}
    };
    u.searchParams.set('callback',callback);
    script.src=u.toString();script.async=true;
    script.onerror=()=>finish(new Error('iTunesに接続できませんでした'));
    const timer=setTimeout(()=>finish(new Error('iTunesがタイムアウトしました')),10000);
    document.head.append(script);
  });
};

// Official snapshot search v2. It may not allow cross-origin browser access
// at all times: caller must keep an external-search fallback available.
export const findNico=async(term,signal)=>{
  const u=new URL('https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search');
  u.searchParams.set('q',term);
  u.searchParams.set('targets','title');
  u.searchParams.set('_fields','contentId,title,startTime,thumbnailUrl');
  u.searchParams.set('_sort','-viewCounter');
  u.searchParams.set('_limit','12');
  u.searchParams.set('_context','VocaFinder');
  const data=await cachedFetch(u,signal);
  if(!Array.isArray(data.data))throw new Error('ニコニコAPIの応答形式が不明です');
  return data.data;
};
