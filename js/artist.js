import {getLinks, normalizedName, likelySameTitle, videoDate, artistString} from './utils.js';

export const artistKey = name => normalizedName(name);
export const uploadKind = song => String(song?.songType||'').toLowerCase();
export const isOfficialPv = song => (song?.pvs||[]).some(p=>String(p.pvType||p.type||'').toLowerCase()==='original');
export const matchingArtist = (song,artist)=>{
  const id=Number(artist?.id);
  return (song?.artists||[]).some(a=>Number(a.artist?.id||a.id)===id) ||
    normalizedName(artist?.name) && normalizedName(artistString(song)).includes(normalizedName(artist?.name));
};
export const artistPriority = (song,artist) => {
  if(song.reviewed||song.userAdded)return 1000;
  const credit=(song.artists||[]).find(a=>Number(a.artist?.id||a.id)===Number(artist?.id));
  const roles=String(credit?.roles||credit?.categories||'').toLowerCase();
  const main=credit?.isSupport===false||credit?.isSupport===undefined;
  return (isOfficialPv(song)?100:0) + (main?20:0) + (/producer|composer|arranger|lyricist/.test(roles)?30:0) + (uploadKind(song)==='original'?10:0);
};
export const sortArtistFirst = (songs,artist) => [...songs].sort((a,b)=>
  artistPriority(b,artist)-artistPriority(a,artist)||
  String(videoDate(b)||b.publishDate||'').localeCompare(String(videoDate(a)||a.publishDate||''))||
  String(a.name).localeCompare(String(b.name),'ja'));

// Merge externally reviewed/manual records into VocaDB records when they are the same track.
// A missing VocaDB record remains a separate result instead of silently disappearing.
export const mergeArtistExtras = (fromVocadb,extras) => {
  const songs=[...fromVocadb];
  for(const extra of extras){
    const merged=songs.find(s=>{
      const officialVideo=getLinks(extra).youtube;
      const sameVideo=officialVideo && getLinks(s).youtube===officialVideo;
      return sameVideo || (!!likelySameTitle(s.name,extra.name) &&
        (!s.songType||!extra.songType||String(s.songType).toLowerCase()===String(extra.songType).toLowerCase()) &&
        normalizedName(artistString(s)).includes(normalizedName((extra.artistString||'').split(' feat.')[0])));
    });
    if(merged){
      const urls=new Set((merged.pvs||[]).map(v=>v.url));
      for(const pv of extra.pvs||[]){if(!urls.has(pv.url)) (merged.pvs ||= []).push(pv);}
      merged.supplementalSource ||= extra.sourceUrl||'';
      merged.reviewed ||= !!extra.reviewed;
      if(extra.reviewed)merged.verifiedYoutubeUrl ||= getLinks(extra).youtube;
      merged.userAdded ||= !!extra.userAdded;
      if(!merged.thumbUrl && extra.thumbUrl)merged.thumbUrl=extra.thumbUrl;
    }else songs.push({...extra});
  }
  return songs;
};
