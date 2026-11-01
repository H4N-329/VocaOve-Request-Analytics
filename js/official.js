/** Channel-level evidence. A matching title or 'Original PV' is NOT uploader verification. */
export const normalizeYoutubeChannel = raw => {
  try {
    const u=new URL(String(raw||''));
    if(u.protocol!=='https:' && u.protocol!=='http:')return null;
    if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname.toLowerCase()))return null;
    const path=decodeURIComponent(u.pathname).replace(/\/+$/,'');
    const id=path.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})$/i);
    if(id)return {key:'id:'+id[1],type:'id',value:id[1],url:`https://www.youtube.com/channel/${id[1]}`};
    const handle=path.match(/^\/@([^/\s?&#]+)$/);
    if(handle)return {key:'handle:'+handle[1].toLowerCase(),type:'handle',value:'@'+handle[1],url:`https://www.youtube.com/@${encodeURIComponent(handle[1])}`};
    const username=path.match(/^\/user\/([A-Za-z0-9_-]+)$/i);
    if(username)return {key:'user:'+username[1].toLowerCase(),type:'user',value:username[1],url:`https://www.youtube.com/user/${username[1]}`};
    return null;
  }catch{return null;}
};
export const youtubeVideoId = raw => {
  try{
    const u=new URL(String(raw||''));if(!['http:','https:'].includes(u.protocol))return '';
    const host=u.hostname.toLowerCase();let id='';
    if(host==='youtu.be')id=u.pathname.split('/')[1];
    else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)) {
      if(u.pathname==='/watch')id=u.searchParams.get('v');
      else id=u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:'';
  }catch{return '';}
};
export const songVideoIds = (song,edit={}) => {
  const urls=[...(song?.pvs||[]).map(p=>p.url),edit.youtubeUrl,song?.verifiedYoutubeUrl];
  return [...new Set(urls.map(youtubeVideoId).filter(Boolean))];
};
export const officialWebChannels = artist => {
  const links=artist?.webLinks||[];
  const channels=[];
  for(const l of links){
    // Only artist-controlled links. 'Reference' links do not verify ownership.
    if(String(l.category||'').toLowerCase()!=='official')continue;
    const c=normalizeYoutubeChannel(l.url);if(c&&!channels.some(x=>x.key===c.key))channels.push({...c,source:'VocaDB公式リンク'});
  }
  return channels;
};
export const consolidateChannels = (official=[],manual=[]) => {
  const byKey=new Map();
  for(const ch of [...official,...manual]){
    const normalized=normalizeYoutubeChannel(ch?.url||'');if(!normalized)continue;
    const entry={...normalized,source:ch.source||'手動登録'};
    // Manual confirmations do not replace VocaDB-official attribution.
    if(!byKey.has(entry.key)||entry.source==='VocaDB公式リンク')byKey.set(entry.key,entry);
  }
  return [...byKey.values()];
};
export const uploaderVerdict = (song,edit,channels,uploads={}) => {
  const ids=songVideoIds(song,edit);
  if(!ids.length)return {code:'no-video',label:'YouTube動画未登録',matchedVideo:''};
  if(!channels.length)return {code:'no-channel',label:'公式チャンネル未設定',matchedVideo:''};
  const known=ids.map(id=>({id,upload:uploads[id]})).filter(v=>v.upload?.channelId||v.upload?.channelKey);
  if(!known.length)return {code:'unknown',label:'投稿者未照合',matchedVideo:''};
  const matched=known.find(({upload})=>channels.some(c=>
    (c.type==='id' && upload.channelId===c.value) ||
    (upload.channelKey && c.key===upload.channelKey) ||
    (c.resolvedId && upload.channelId===c.resolvedId)
  ));
  if(matched){
    const channel=channels.find(c=>(c.type==='id' && matched.upload.channelId===c.value) || (matched.upload.channelKey && c.key===matched.upload.channelKey) || (c.resolvedId && matched.upload.channelId===c.resolvedId));
    const trusted=matched.upload.method==='api'&&channel?.source==='VocaDB公式リンク';
    return {code:trusted?'match':'manual-match',label:trusted?'本人チャンネル一致（VocaDB公式）':'登録チャンネル一致（要確認）',matchedVideo:matched.id,channelTitle:matched.upload.channelTitle||''};
  }
  if(known.length===ids.length)return {code:'other',label:'別チャンネル投稿（登録済み動画）',matchedVideo:''};
  return {code:'unknown',label:'一部動画は未照合',matchedVideo:''};
};
export const prioritizeWithChannels = (songs,artist,score,edits,channels,uploads) => [...songs].sort((a,b)=>{
  const rank=s=>({match:4000,'manual-match':3200,unknown:0,'no-channel':0,'no-video':0,other:-1000}[uploaderVerdict(s,edits[s.id]||{},channels,uploads).code]||0)+score(s,artist);
  return rank(b)-rank(a) || String(b.publishDate||'').localeCompare(String(a.publishDate||'')) || String(a.name||'').localeCompare(String(b.name||''),'ja');
});
