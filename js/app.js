import {safeUrl,validSiteUrl,dateString,isoDate,numericBpm,effectiveBpm,bpmLabel,artistString,getLinks,videoDate,coverUrl,createCsv,matchesBpm,sortSongs,likelySameTitle} from './utils.js';
import {loadEdits,saveEdits,cleanEdit,validateImport,backupJson} from './storage.js';
import {findSongs,findArtists,fetchSong,fetchArtist,findITunes,findNico} from './api.js';
import {reviewedUploads} from './supplement.js';
import {artistKey,uploadKind,isOfficialPv,artistPriority,mergeArtistExtras} from './artist.js';
import {sanitizeAdded,loadManual,saveManual,manualForArtist,cleanManualList} from './manual.js';
import {officialWebChannels,consolidateChannels,normalizeYoutubeChannel,youtubeVideoId,songVideoIds,uploaderVerdict,prioritizeWithChannels} from './official.js';
import {readYoutubeKey,saveYoutubeKey,readYoutubeCache,saveYoutubeCache,resolveChannel,fetchVideoOwners} from './youtube.js';
import {sanitizeManualChannels,sanitizeUploaders,loadManualChannels,loadManualUploaders,saveManualChannels,saveManualUploaders} from './channel-data.js';

const $=id=>document.getElementById(id);
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node;};
const appendLink=(parent,url,label)=>{const href=safeUrl(url);if(!href)return null;const a=el('a','',label);a.href=href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);return a;};
const row=(container,label,value)=>{container.append(el('dt','',label));const dd=el('dd');if(value instanceof Node)dd.append(value);else dd.textContent=String(value??'未登録');container.append(dd);return dd;};
const API_PAGE=40, ARTIST_PAGE=50, MAX_AUTO_ARTIST=500;
let manualUploads=loadManual();
let edits=loadEdits();
let manualChannels=loadManualChannels();
let manualUploaders=loadManualUploaders();
let youtubeCache=readYoutubeCache();
let artistWebChannels=[];
let matchedChannels=[];
let scanBusy=false;
let scanController=null;
let detailEpoch=0; // Ignore responses from previously opened songs.
const state={term:'',mode:'song',artist:null,artists:[],songs:[],total:0,offset:0,busy:false,reqVersion:0,controller:null,detailVersion:0,artistLoadToken:0};
const editFor=song=>edits[song.id]||{};
const videoUploads=()=>({...manualUploaders,...youtubeCache});
const artistChannels=()=>consolidateChannels(artistWebChannels,manualChannels[String(state.artist?.id)]||[]);
const verdict=song=>uploaderVerdict(song,editFor(song),matchedChannels.length?matchedChannels:artistChannels(),videoUploads());
const isVerified=song=>['match','manual-match'].includes(verdict(song).code);
function updateChannelStatus(message){if(message)$('channelStatus').textContent=message;else{
 const chans=artistChannels();const all=allSongs(),verified=all.filter(isVerified).length;
 $('channelStatus').textContent=`公式チャンネル ${chans.length} 件 / 照合一致（手動含む）${verified} 曲 / 動画情報 ${Object.keys(videoUploads()).length} 件${readYoutubeKey()?'（APIキー設定あり）':'（APIキー未設定）'}`;
 }}
const currentMode=()=>document.querySelector('input[name="searchMode"]:checked').value;
const isCurrent=seq=>seq===state.reqVersion;
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);$('status').hidden=false;}
function updateLoading(value){state.busy=value;$('searchBtn').disabled=value;$('loadMore').disabled=value;}
function startRequest(){state.controller?.abort();state.controller=new AbortController();state.reqVersion++;return {seq:state.reqVersion,signal:state.controller.signal};}
function filters(){
  const lo=$('minBpm').value.trim(),hi=$('maxBpm').value.trim();
  return {min:lo===''?null:Number(lo),max:hi===''?null:Number(hi),onlyKnown:$('onlyKnown').checked,sort:$('sort').value,includeCover:$('includeCover').checked,includeRemix:$('includeRemix').checked,onlyOfficial:$('onlyOfficial').checked};
}
function allSongs(){
  if(!state.artist)return state.songs;
  const artist=state.artist;
  const reviewed=reviewedUploads.filter(v=>v.artistKey===artistKey(artist.name));
  return mergeArtistExtras(state.songs,[...reviewed,...manualForArtist(manualUploads,artist)]);
}
function filteredSongs(){
  const f=filters();
  const selected=allSongs().filter(s=>matchesBpm(s,editFor(s),f.min,f.max,f.onlyKnown) &&
    (f.includeCover||uploadKind(s)!=='cover') && (f.includeRemix||uploadKind(s)!=='remix') && (!f.onlyOfficial||state.artist&&isVerified(s)));
  return f.sort==='officialFirst'&&state.artist?prioritizeWithChannels(selected,state.artist,artistPriority,edits,matchedChannels.length?matchedChannels:artistChannels(),videoUploads()):
    f.sort==='original'||f.sort==='officialFirst'?selected:sortSongs(selected,f.sort,edits);
}
function addImage(parent,song,detail=false){const url=coverUrl(song);if(url){const img=el('img',detail?'detail-cover':'cover');img.alt=`${song.name||'楽曲'}の登録画像`;img.loading='lazy';img.referrerPolicy='no-referrer';img.src=url;img.onerror=()=>img.replaceWith(el('div',detail?'detail-fallback':'cover-fallback','♫'));parent.append(img);}else parent.append(el('div',detail?'detail-fallback':'cover-fallback','♫'));}
function displayCards(){const shown=filteredSongs(),container=$('results');container.replaceChildren();$('exportCsv').disabled=!shown.length;
  if(!allSongs().length){status(state.term?'検索結果はまだありません。':'検索したい曲名・アーティスト名を入力してください。');}
  else if(!shown.length)status('読み込み済みの曲に該当するものがありません。「もっと読み込む」か絞り込み条件の変更をお試しください。');
  else $('status').hidden=true;
  for(const song of shown){const edit=editFor(song),card=el('article','song-card');addImage(card,song);const body=el('div','card-body');body.append(el('h3','',song.name||'曲名不明'),el('div','artist-line',artistString(song)));const chips=el('div','chips');const b=effectiveBpm(song,edit);chips.append(el('span',`chip hot${b?.manual?' user':''}`,`BPM ${bpmLabel(b)}${b?.manual?' ✎':''}`),
    el('span','chip',`投稿日 ${dateString(videoDate(song,edit)||song.publishDate)}`));
    const kind=uploadKind(song);
    if(kind==='cover')chips.append(el('span','chip type-chip','カバー'));
    if(kind==='remix')chips.append(el('span','chip type-chip','Remix'));
    if(song.reviewed)chips.append(el('span','chip verified-chip','外部資料で確認'));
    else if(song.userAdded)chips.append(el('span','chip verified-chip','手動追加'));
    else if(state.artist&&isOfficialPv(song))chips.append(el('span','chip verified-chip','公式PV登録'));
    if(state.artist){const result=verdict(song);chips.prepend(el('span',`chip owner-${result.code}`,result.label));}
    if(edit.streamingDate)chips.append(el('span','chip',`配信 ${dateString(edit.streamingDate)}`));body.append(chips);const actions=el('div','card-actions');const urls=getLinks(song,edit);appendLink(actions,urls.nico,'ニコニコ ↗');appendLink(actions,urls.youtube,'YouTube ↗');const more=el('button','','詳細・編集');more.type='button';more.addEventListener('click',()=>openDetail(song.id));actions.append(more);body.append(actions);card.append(body);container.append(card);}
  const filteredCount=shown.length;
  const suffix=state.total>state.songs.length?'（他の楽曲は未取得）':'';
  const additional=allSongs().length-state.songs.length;
  $('resultsSummary').textContent=`VocaDB ${state.total.toLocaleString()} 曲 / 取得 ${state.songs.length.toLocaleString()} 曲${additional?` ＋補完 ${additional} 曲`:''} / 表示 ${filteredCount} 曲 ${suffix}`;
  $('loadMore').hidden=state.offset>=state.total||state.offset>=500||!state.term;
  if(state.artist)updateChannelStatus();
  if(state.offset>=500&&state.total>500)$('scopeNote').textContent='※ 大規模なアーティストではAPI負荷を抑えるため上限500曲です。残りはVocaDBでご確認ください。並び替えは取得済みのみ対象です。';
}
function showExternalSearch(term){
  const box=$('externalSearchLinks');box.replaceChildren();box.hidden=!term;
  if(!term)return;
  box.append(el('span','', 'ほかのサイトでも検索：'));
  const query=encodeURIComponent(term);
  appendLink(box,`https://www.nicovideo.jp/search/${query}`,'ニコニコ ↗');
  appendLink(box,`https://music.apple.com/jp/search?term=${query}`,'Apple Music ↗');
  appendLink(box,`https://www.youtube.com/results?search_query=${query}`,'YouTube ↗');
}
function resetSongs(){state.songs=[];state.offset=0;state.total=0;$('results').replaceChildren();$('loadMore').hidden=true;$('exportCsv').disabled=true;$('resultsSummary').textContent='検索中…';}
async function loadSongs(reset=false){if(state.busy&&!reset)return;
  const {seq,signal}=startRequest();updateLoading(true);
  try{const result=await findSongs({query:state.artist?'':state.term,artistId:state.artist?.id||null,offset:state.offset,limit:state.artist?ARTIST_PAGE:API_PAGE,sort:state.artist?'PublishDate':'None',signal});if(!isCurrent(seq))return;
    const items=Array.isArray(result.items)?result.items:[];
    const seen=new Set(state.songs.map(x=>x.id));for(const s of items){if(!seen.has(s.id)){state.songs.push(s);seen.add(s.id);}}
    state.offset+=items.length;state.total=Number.isFinite(Number(result.totalCount))?Number(result.totalCount):state.songs.length;
    if(items.length===0)state.total=state.songs.length;
    displayCards();
    if(!allSongs().length)status('該当する楽曲が見つかりませんでした。表記を変えて試してください。');
    return items.length>0;
  }catch(e){if(!isCurrent(seq)||e.name==='AbortError')return;
    if(!allSongs().length){$('resultsSummary').textContent='データを取得できませんでした';status('VocaDBへの接続に失敗しました。時間を置いて再試行してください。('+e.message+')',true);}
    else status('続きの楽曲を取得できませんでした。再度「もっと読み込む」をお試しください。',true);
    console.error(e);return false;
  }finally{if(isCurrent(seq))updateLoading(false);}
}
function drawArtists(){const cont=$('artistResults');cont.replaceChildren();for(const artist of state.artists){const btn=el('button',`artist-choice${state.artist?.id===artist.id?' selected':''}`,artist.name||'名前不明');btn.type='button';btn.addEventListener('click',()=>chooseArtist(artist));cont.append(btn);}if(!state.artists.length)cont.append(el('p','subtle','候補が見つかりませんでした。別の表記で検索してください。'));$('artistSection').hidden=false;}
async function chooseArtist(artist){
  state.artist=artist;const token=++state.artistLoadToken;
  resetSongs();drawArtists();$('addArtistSong').hidden=false;
  $('artistNotice').hidden=false;
  $('artistNotice').textContent='公式YouTube投稿者と照合します。公式PV表記だけでは本人投稿と判定しません。';
  $('channelControls').hidden=false;artistWebChannels=[];matchedChannels=[];
  updateChannelStatus('VocaDBの公式チャンネルを取得中…');
  const webPromise=fetchArtist(artist.id).then(info=>{if(token!==state.artistLoadToken)return;artistWebChannels=officialWebChannels(info);matchedChannels=artistChannels();displayCards();}).catch(err=>{if(token===state.artistLoadToken){console.warn('アーティスト外部リンクを取得できませんでした',err);updateChannelStatus('VocaDBの公式チャンネル取得に失敗しました。手動登録が利用できます。');}});
  $('resultsHeading').textContent=`${artist.name} の楽曲`;
  $('resultsSummary').textContent='楽曲を読み込み中…';
  $('sort').value='officialFirst';
  displayCards();
  // Fetch all artist-attributed tracks (up to a bounded 500) to avoid dropping newer releases after page one.
  do {
    if(token!==state.artistLoadToken||state.artist!==artist)return;
    const pageOk=await loadSongs(true);
    if(!pageOk)break;
    if(token!==state.artistLoadToken||state.artist!==artist)return;
    if(state.total<=state.offset||state.offset>=MAX_AUTO_ARTIST||!state.songs.length)break;
  }while(true);
  await webPromise;
  if(token===state.artistLoadToken&&readYoutubeKey()&&!scanBusy)await runChannelCheck();
}
async function search(){const term=$('query').value.trim();if(!term)return;
  document.body.classList.add('has-results');state.term=term;state.mode=currentMode();state.artist=null;state.artists=[];++state.artistLoadToken;scanController?.abort();resetSongs();
  $('channelControls').hidden=true;$('onlyOfficial').checked=false;artistWebChannels=[];matchedChannels=[];$('addArtistSong').hidden=true;$('artistNotice').hidden=true; if($('sort').value==='officialFirst')$('sort').value='original';showExternalSearch(term);$('artistSection').hidden=true;$('resultsHeading').textContent=`「${term}」の検索`;
  const query=new URL(window.location.href);query.searchParams.set('q',term);query.searchParams.set('mode',state.mode);history.replaceState(null,'',query);
  if(state.mode==='song'){status('VocaDBで曲名検索しています…');await loadSongs(true);return;}
  const {seq,signal}=startRequest();updateLoading(true);status('VocaDBでアーティスト名検索しています…');
  try{const data=await findArtists(term,signal);if(!isCurrent(seq))return;state.artists=Array.isArray(data.items)?data.items:[];drawArtists();$('resultsSummary').textContent=`アーティスト候補 ${state.artists.length} 件`;if(state.artists.length){
      const exact=state.artists.filter(a=>artistKey(a.name)===artistKey(term));
      if(exact.length===1)await chooseArtist(exact[0]);
      else status('アーティストを選択してください。完全一致の候補がない場合は候補一覧をご確認ください。');
    }else status('アーティストが見つかりませんでした。');}
  catch(e){if(!isCurrent(seq)||e.name==='AbortError')return;status('アーティスト検索に失敗しました。通信状態をご確認ください。('+e.message+')',true);console.error(e);}
  finally{if(isCurrent(seq))updateLoading(false);}
}
function csvExport(){const songs=filteredSongs();if(!songs.length)return;
  const header=['投稿者判定','判定動画ID','曲名','アーティスト','種類','VocaDB初公開日','動画投稿日（登録分）','配信日','配信日出典','BPM下限','BPM上限','BPM手動修正','ニコニコ動画URL','YouTube URL','配信URL','VocaDB URL','データ出典','ID'];
  const records=songs.map(s=>{const ed=editFor(s),b=effectiveBpm(s,ed),links=getLinks(s,ed);const v=state.artist?verdict(s):{label:'未照合',matchedVideo:''};return [v.label,v.matchedVideo,s.name,artistString(s),s.songType||'',dateString(s.publishDate),dateString(videoDate(s,ed)),dateString(ed.streamingDate),ed.streamingSource||'',b?.min??'',b?.max??'',b?.manual?'はい':'いいえ',links.nico,links.youtube,ed.streamingUrl||ed.spotifyUrl||'',typeof s.id==='number'?`https://vocadb.net/S/${s.id}`:'',s.userAdded?'手動登録':s.supplementalSource||s.sourceUrl||'VocaDB',s.id];});
  download('vocafinder_'+new Date().toISOString().slice(0,10)+'.csv',createCsv(records,header),'text/csv;charset=utf-8');
}
function download(filename,contents,mime){const blob=new Blob([contents],{type:mime});const url=URL.createObjectURL(blob);const anchor=el('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);}
function formField(form,id,label,value='',type='text',placeholder='',wide=false){const div=el('div',`field${wide?' wide':''}`),lbl=el('label','',label),input=el('input');lbl.htmlFor=id;input.id=id;input.name=id;input.type=type;input.value=value??'';input.placeholder=placeholder;if(type==='number'){input.min='20';input.max='400';input.step='0.01';}div.append(lbl,input);form.append(div);return input;}
const setFeedback=(elem,text,isError=false)=>{elem.textContent=text;elem.style.color=isError?'#ffc7c8':'#b1efdf';};
function updateSaved(id,newEdit,feedback){const val=cleanEdit(newEdit);if(Object.keys(val).length)edits[id]=val;else delete edits[id];const ok=saveEdits(edits);if(feedback)setFeedback(feedback,ok?'保存しました。検索結果・CSVにも反映されます。':'このブラウザでは保存できません。ストレージの空きを確認してください。',!ok);displayCards();}
function externalSearchUrl(service,s){const q=[s.name,artistString(s)==='未登録'?'':artistString(s)].filter(Boolean).join(' ');return service==='nico'?`https://www.nicovideo.jp/search/${encodeURIComponent(q)}`:service==='youtube'?`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`:service==='spotify'?`https://open.spotify.com/search/${encodeURIComponent(q)}`:`https://music.apple.com/jp/search?term=${encodeURIComponent(q)}`;}
function createVideoLinks(song,edit){const box=el('div'),links=getLinks(song,edit);if(links.nico)appendLink(box,links.nico,'ニコニコ動画 ↗');if(links.youtube)appendLink(box,links.youtube,'YouTube ↗');if(!box.childNodes.length)box.textContent='未登録';return box;}
async function openDetail(id){const version=++state.detailVersion,dialog=$('detailDialog'),body=$('detailBody');body.replaceChildren(el('p','subtle','詳細を読み込み中…'));if(!dialog.open)dialog.showModal();
  let song=allSongs().find(x=>x.id===id);
  try{if(typeof id==='number'){
    const detail=await fetchSong(id);if(version!==state.detailVersion||!dialog.open)return;
    const extra=allSongs().find(s=>s.id===id);
    song=extra?mergeArtistExtras([detail],[extra])[0]:detail;
  }}
  catch(e){console.warn('VocaDB詳細APIが使えないため検索結果を表示',e);}
  if(version!==state.detailVersion||!dialog.open)return;
  if(!song){body.replaceChildren(el('p','subtle','楽曲の詳細が取得できませんでした。'));return;}
  renderDetail(song);
}
function renderDetail(song){const epoch=++detailEpoch;const body=$('detailBody');body.replaceChildren();const ed=editFor(song);
  const hd=el('div','detail-header'),titleArea=el('div');addImage(hd,song,true);titleArea.append(el('h2','',song.name||'曲名不明'),el('div','subtle',artistString(song)));if(typeof song.id==='number')appendLink(titleArea,`https://vocadb.net/S/${song.id}`,'VocaDBで確認 ↗');
    if(song.sourceUrl)appendLink(titleArea,song.sourceUrl,'補完データの出典 ↗');
    if(song.supplementalSource)appendLink(titleArea,song.supplementalSource,'補完データの出典 ↗');hd.append(titleArea);body.append(hd);
  const meta=el('dl','detail-meta');row(meta,'VocaDB初公開日',dateString(song.publishDate));row(meta,'登録動画投稿日',dateString(videoDate(song,ed)));row(meta,'BPM',bpmLabel(effectiveBpm(song,ed)));row(meta,'配信日',ed.streamingDate?`${dateString(ed.streamingDate)}（${ed.streamingSource||'手動登録'}）`:'未登録・未確認');row(meta,'楽曲分類',song.songType||'未登録');
  if(state.artist){const v=verdict(song);row(meta,'投稿チャンネル判定',`${v.label}${v.channelTitle?' / '+v.channelTitle:''}`);}
  row(meta,'登録動画',createVideoLinks(song,ed));if(ed.streamingUrl||ed.spotifyUrl){const box=el('div');appendLink(box,ed.streamingUrl||ed.spotifyUrl,'配信ページ ↗');row(meta,'配信リンク',box);}
  body.append(el('hr'),meta,el('p','info-box','初公開日はVocaDBが持つ「楽曲が初めて公になった日」です。Spotify等の配信開始日とは異なる場合があります。登録画像も正式なジャケットとは限りません。'));
  body.append(el('hr'),el('h3','','手動登録・修正'));const editBox=el('div','edit-section');const form=el('form','edit-grid');form.id='songEditForm';const bpm=formField(form,'editBpm','BPM（20〜400、空欄でVocaDB値）',ed.bpm??'','number','例：128');const nico=formField(form,'editNico','ニコニコ動画URL',ed.nicoUrl||'','url','https://www.nicovideo.jp/watch/...',true);const youtube=formField(form,'editYoutube','YouTube URL',ed.youtubeUrl||'','url','https://www.youtube.com/watch?v=...',true);const release=formField(form,'editRelease','配信日（手動または候補から確認）',ed.streamingDate||'','date');const sourceField=el('div','field'),sourceLabel=el('label','','配信日出典'),source=el('select');sourceLabel.htmlFor='editSource';source.id='editSource';for(const text of ['その他 (手入力)','Apple Music / iTunes','Spotify (手入力)']){const opt=el('option','',text);opt.value=text;source.append(opt);}source.value=ed.streamingSource||'その他 (手入力)';sourceField.append(sourceLabel,source);form.append(sourceField);const dist=formField(form,'editStreamingUrl','配信ストアURL（Apple Music / Spotify）',ed.streamingUrl||ed.spotifyUrl||'','url','https://music.apple.com/... または https://open.spotify.com/...',true);editBox.append(form);const buttonBar=el('div','button-row');const save=el('button','primary','入力内容を保存');save.type='submit';save.setAttribute('form','songEditForm');const clear=el('button','outlined','この曲の手動登録を削除');clear.type='button';buttonBar.append(save,clear);editBox.append(buttonBar);const feedback=el('p','hint','手動修正はこのブラウザのみに保存されます。');feedback.setAttribute('role','status');editBox.append(feedback);body.append(editBox);
  if(song.userAdded){const remove=el('button','outlined','この手動追加曲を削除');remove.type='button';
    remove.addEventListener('click',()=>{manualUploads=manualUploads.filter(v=>v.id!==song.id);if(!saveManual(manualUploads)){setFeedback(feedback,'削除に失敗しました。',true);return;}$('detailDialog').close();displayCards();});
    editBox.append(remove);
  }
  form.addEventListener('submit',e=>{e.preventDefault();const entered={...editFor(song)};
    if(bpm.value.trim() && numericBpm(bpm.value)===null){setFeedback(feedback,'BPMは20〜400で入力してください。',true);return;}
    for(const [input,kind] of [[nico,'nico'],[youtube,'youtube']]){if(input.value.trim()&&!validSiteUrl(input.value.trim(),kind)){setFeedback(feedback,kind==='nico'?'ニコニコ動画のURLを入力してください。':'YouTubeのURLを入力してください。',true);return;}}
    if(dist.value.trim()&&!validSiteUrl(dist.value.trim(),'apple')&&!validSiteUrl(dist.value.trim(),'spotify')){setFeedback(feedback,'配信URLはApple MusicまたはSpotifyのURLを入力してください。',true);return;}
    if(release.value.trim()&&!isoDate(release.value)){setFeedback(feedback,'正しい配信日を入力してください。',true);return;}
    entered.bpm=bpm.value.trim();entered.nicoUrl=nico.value.trim();entered.youtubeUrl=youtube.value.trim();entered.streamingDate=release.value;entered.streamingSource=source.value;entered.streamingUrl=dist.value.trim();
    if(!entered.streamingDate)delete entered.streamingSource;
    if(!entered.nicoUrl)delete entered.nicoPublished;
    if(!entered.youtubeUrl)delete entered.youtubePublished;
    delete entered.spotifyUrl;
    updateSaved(song.id,entered,feedback);
  });
  clear.addEventListener('click',()=>{delete edits[song.id];const ok=saveEdits(edits);if(ok){setFeedback(feedback,'この曲の手動登録を削除しました。');renderDetail(song);displayCards();}else setFeedback(feedback,'削除後の保存に失敗しました。',true);});
  if(state.artist)drawUploaderControls(body,song);
  body.append(el('hr'),el('h3','','ニコニコ・iTunesから自動で情報を補完'));
  body.append(el('p','subtle','詳細を開くと2つの無料APIで候補を検索します。別楽曲・カバー・Remixが混じるため、内容を確認して「採用」してください。採用前に情報が上書きされることはありません。'));
  const nicoArea=el('section','source-section'),appleArea=el('section','source-section');
  nicoArea.append(el('h4','','ニコニコ動画：投稿日・動画URL'));
  appleArea.append(el('h4','','iTunes：配信日・配信ストアURL'));
  const nicoResults=el('div','candidate-list'),appleResults=el('div','candidate-list');
  nicoArea.append(nicoResults);appleArea.append(appleResults);
  body.append(nicoArea,appleArea);
  loadCandidates('nico',song,nicoResults,epoch);
  loadCandidates('apple',song,appleResults,epoch);
  const searchLinks=el('div','button-row');
  for(const [service,text] of [['nico','ニコニコで直接検索 ↗'],['youtube','YouTubeで検索 ↗'],['apple','Apple Musicで検索 ↗'],['spotify','Spotifyで検索 ↗']])appendLink(searchLinks,externalSearchUrl(service,song),text);
  body.append(el('p','hint','YouTubeはAPIキーなしの補助検索として利用します。VocaDBに登録済みのYouTube動画URLは上部に表示します。APIに接続できないときは直接検索で調べられます。'),searchLinks);
}
async function loadCandidates(kind,song,container,epoch){
  container.replaceChildren(el('p','subtle','自動検索中…'));
  let results=[];
  try{
    // Using just the title on Nico avoids overly strict searches.
    if(kind==='nico'){
      const data=await findNico(song.name);
      results=data.filter(v=>/^(sm|nm|so)\d+$/.test(String(v.contentId||'')))
        .map(v=>({title:v.title,url:`https://www.nicovideo.jp/watch/${v.contentId}`,date:(v.startTime||'').slice(0,10),source:'nico'}));
    }
    if(kind==='apple'){
      // Title-only is more tolerant of differing artist and feat. credits.
      const data=await findITunes(song.name);
      results=data.filter(v=>v.kind==='song' && v.trackViewUrl)
        .map(v=>({title:v.trackName,url:v.trackViewUrl,date:(v.releaseDate||'').slice(0,10),channel:v.artistName,source:'apple'}));
    }
    if(epoch!==detailEpoch||!$('detailDialog').open)return;
    container.replaceChildren();
    if(!results.length){container.append(el('p','subtle','候補が見つかりませんでした。下部の外部検索をご利用ください。'));return;}
    const ranked=results.map(v=>({...v,similar:!!likelySameTitle(song.name,v.title)}))
      .sort((a,b)=>Number(b.similar)-Number(a.similar)).slice(0,8);
    for(const item of ranked){
      if(!safeUrl(item.url))continue;
      const wrapper=el('div','candidate-item'),info=el('div');
      info.append(el('strong','',item.title||'タイトル不明'));
      info.append(el('small','',`${item.channel||''}　${dateString(item.date)}${item.similar?'　● 曲名が近い候補':'　⚠ 曲名要確認'}`));
      appendLink(info,item.url,kind==='apple'?'iTunesで曲を確認 ↗':'動画を確認 ↗');
      const button=el('button','','確認して採用');button.type='button';
      button.addEventListener('click',()=>{
        if(epoch!==detailEpoch)return;
        const current={...editFor(song)};
        if(item.source==='nico'&&validSiteUrl(item.url,'nico')){
          current.nicoUrl=item.url;if(isoDate(item.date))current.nicoPublished=item.date;
        }
        if(item.source==='apple'&&validSiteUrl(item.url,'apple')){
          current.streamingUrl=item.url;
          if(isoDate(item.date)){
            current.streamingDate=item.date;current.streamingSource='Apple Music / iTunes';
          }
        }
        updateSaved(song.id,current);
        renderDetail(song); // Show saved values and fresh candidate panels.
      });
      wrapper.append(info,button);container.append(wrapper);
    }
  }catch(e){
    if(epoch!==detailEpoch||!$('detailDialog').open)return;
    console.warn(kind+'候補API',e);
    const source=kind==='nico'?'ニコニコ':'iTunes';
    container.replaceChildren(el('p','hint',`${source} APIの自動検索に失敗しました。接続制限・一時停止などの可能性があります。下部の外部検索は利用できます。(${e.message})`));
  }
}

function drawUploaderControls(body,song){
  const ids=songVideoIds(song,editFor(song));
  const section=el('section','source-section');section.append(el('hr'),el('h3','','YouTube投稿者チャンネル照合'));
  section.append(el('p','hint','APIキーなしの場合はYouTubeの動画を開き、投稿者チャンネルURLを確認して手動登録できます。手動確認は公式APIによる判定とは区別します。'));
  if(!ids.length){section.append(el('p','hint','この曲にはYouTube動画が登録されていません。'));body.append(section);return;}
  for(const id of ids){
    const area=el('div','upload-check-row');const info=el('div','');appendLink(info,`https://www.youtube.com/watch?v=${id}`,`動画 ${id} ↗`);
    const owner=videoUploads()[id];info.append(el('small','',owner?.channelId?` 投稿者ID: ${owner.channelId}（${owner.method==='manual'?'手動登録':'YouTube API'}）`:owner?.channelKey?` 投稿者: ${owner.channelKey}（手動登録）`:' 投稿者未照合'));
    const form=el('form','upload-check-form');const input=el('input');input.type='url';input.placeholder='動画の投稿者チャンネルURL (youtube.com/@... 等)';input.value=manualUploaders[id]?.url||'';input.setAttribute('aria-label',`動画 ${id} 投稿者チャンネルURL`);
    const save=el('button','outlined','手動照合');save.type='submit';form.append(input,save);
    const note=el('small','hint','');form.addEventListener('submit',event=>{event.preventDefault();const channel=normalizeYoutubeChannel(input.value.trim());
      if(!channel){note.textContent='YouTubeのチャンネルURLを入力してください。';return;}
      manualUploaders[id]={channelId:channel.type==='id'?channel.value:'',channelKey:channel.key,channelTitle:'（手動入力）',url:channel.url,method:'manual'};
      if(!saveManualUploaders(manualUploaders)){note.textContent='保存に失敗しました。';return;}
      note.textContent='投稿者URLを手動登録しました（APIによる確認ではありません）。';displayCards();renderDetail(song);
    });
    area.append(info,form,note);section.append(area);
  }
  body.append(section);
}
function openChannelDialog(){if(!state.artist)return;
  $('channelArtistName').textContent=state.artist.name;
  const list=$('autoChannelList');list.replaceChildren();
  if(!artistWebChannels.length)list.append(el('p','hint','VocaDBに「Official」区分のYouTubeチャンネルリンクはありません。'));
  for(const ch of artistWebChannels){const div=el('div','channel-item');appendLink(div,ch.url,ch.url+' ↗');div.append(el('small','',' VocaDB公式リンク'));list.append(div);}
  const manual=manualChannels[String(state.artist.id)]||[];
  $('manualChannelUrls').value=manual.map(c=>c.url).join('\n');
  $('channelMessage').textContent='';$('channelDialog').showModal();
}
async function runChannelCheck(){
  if(!state.artist||scanBusy)return;
  const key=readYoutubeKey();if(!key){updateChannelStatus('YouTube APIキー未設定です。設定画面から任意で追加できます（キーなしなら手動照合）。');return;}
  const artistId=state.artist.id,token=state.artistLoadToken;
  scanBusy=true;scanController?.abort();scanController=new AbortController();$('runChannelCheck').disabled=true;
  try{
    const chans=artistChannels(),resolved=[];
    if(!chans.length){updateChannelStatus('公式チャンネルが未登録です。「公式チャンネルを管理」から追加してください。');return;}
    updateChannelStatus('公式チャンネルのIDを照会中…');
    for(const ch of chans){
      const id=await resolveChannel(ch,key,scanController.signal);
      if(id)resolved.push({...ch,resolvedId:id});
    }
    if(token!==state.artistLoadToken||artistId!==state.artist.id)return;
    matchedChannels=resolved;
    if(!matchedChannels.length){updateChannelStatus('公式チャンネルIDを解決できませんでした。URLやAPIキーをご確認ください。');return;}
    const ids=[...new Set(allSongs().flatMap(s=>songVideoIds(s,editFor(s))))];
    const unchecked=ids.filter(id=>!youtubeCache[id]);
    updateChannelStatus(`動画 ${ids.length} 件中 ${unchecked.length} 件をYouTubeで照合中…`);
    await fetchVideoOwners(unchecked,key,scanController.signal,(done,total,part)=>{
      Object.assign(youtubeCache,part);saveYoutubeCache(youtubeCache);
      if(token===state.artistLoadToken){updateChannelStatus(`YouTube照合中：${done}/${total} 件`);displayCards();}
    });
    if(token!==state.artistLoadToken)return;
    saveYoutubeCache(youtubeCache);displayCards();
  }catch(error){if(error.name!=='AbortError'){console.warn(error);updateChannelStatus(`照合できませんでした：${error.message}`);}}
  finally{scanBusy=false;$('runChannelCheck').disabled=false;}
}
$('manageChannels').addEventListener('click',openChannelDialog);
$('channelForm').addEventListener('submit',event=>{
  event.preventDefault();if(!state.artist)return;
  const urls=$('manualChannelUrls').value.split(/\n+/).map(v=>v.trim()).filter(Boolean);
  if(urls.length>20){$('channelMessage').textContent='登録上限は20件です。';return;}
  const channels=urls.map(normalizeYoutubeChannel);
  if(channels.some(c=>!c)){$('channelMessage').textContent='YouTubeの /channel/UC…、/@ハンドル、/user/… 形式のURLを入力してください。';return;}
  manualChannels[String(state.artist.id)]=channels.map(c=>({...c,source:'手動登録'}));
  if(!saveManualChannels(manualChannels)){$('channelMessage').textContent='保存できませんでした。';return;}
  matchedChannels=artistChannels();displayCards();$('channelDialog').close();
});
$('runChannelCheck').addEventListener('click',runChannelCheck);
$('applyYoutubeKey').addEventListener('click',()=>{
  const key=$('youtubeApiKey').value.trim();
  try{if(!saveYoutubeKey(key))throw new Error('セッションに保存できませんでした。');
    $('youtubeKeyMessage').textContent=key?'このタブのセッションに設定しました。公式チャンネルを選んで「YouTube投稿者を照合」してください。':'APIキーを削除しました。';
  }catch(e){$('youtubeKeyMessage').textContent=e.message;}
});
$('removeYoutubeKey').addEventListener('click',()=>{saveYoutubeKey('');$('youtubeApiKey').value='';$('youtubeKeyMessage').textContent='APIキーを削除しました。';});

$('searchForm').addEventListener('submit',e=>{e.preventDefault();search();});
for(const btn of document.querySelectorAll('[data-sample]'))btn.addEventListener('click',()=>{
  $('query').value=btn.dataset.sample;const mode=btn.dataset.mode||'song';document.querySelector(`input[name="searchMode"][value="${mode}"]`).checked=true;search();
});
for(const input of document.querySelectorAll('input[name="searchMode"]'))input.addEventListener('change',()=>{$('query').placeholder=input.value==='artist'?'例：DECO*27':'例：ゴーストルール';});
$('loadMore').addEventListener('click',()=>loadSongs());
$('exportCsv').addEventListener('click',csvExport);
for(const elem of [$('minBpm'),$('maxBpm'),$('onlyKnown'),$('includeCover'),$('includeRemix'),$('onlyOfficial'),$('sort')])elem.addEventListener(elem.tagName==='SELECT'||elem.type==='checkbox'?'change':'input',displayCards);
$('resetFilters').addEventListener('click',()=>{$('minBpm').value='';$('maxBpm').value='';$('onlyKnown').checked=false;$('includeCover').checked=true;$('includeRemix').checked=true;$('onlyOfficial').checked=false;$('sort').value=state.artist?'officialFirst':'original';displayCards();});
$('openSettings').addEventListener('click',()=>{$('youtubeApiKey').value=readYoutubeKey();$('settingsDialog').showModal();});
for(const btn of document.querySelectorAll('[data-close]'))btn.addEventListener('click',()=>$(btn.dataset.close).close());
$('exportBackup').addEventListener('click',()=>download('vocafinder-backup-'+new Date().toISOString().slice(0,10)+'.json',backupJson(edits,manualUploads,manualChannels,manualUploaders),'application/json;charset=utf-8'));
$('importBackup').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;
  try{if(file.size>1024*1024)throw new Error('ファイルが大きすぎます（上限1 MB）。');
    const data=JSON.parse(await file.text());
    const imported=validateImport(data),restored=cleanManualList(data.addedSongs||[]);
    edits={...edits,...imported};
    manualUploads=cleanManualList([...manualUploads.filter(t=>!restored.some(v=>v.id===t.id)),...restored]);
    if(data.format==='vocafinder-backup-v5'){
      manualChannels={...manualChannels,...sanitizeManualChannels(data.channels)};
      manualUploaders={...manualUploaders,...sanitizeUploaders(data.uploaders)};
    }
    if(!saveEdits(edits)||!saveManual(manualUploads)||!saveManualChannels(manualChannels)||!saveManualUploaders(manualUploaders))throw new Error('ローカル保存に失敗しました。');
    matchedChannels=artistChannels();
    $('settingsMessage').textContent=`編集 ${Object.keys(imported).length} 曲・不足曲 ${restored.length} 曲を取り込みました。`;displayCards();
  }catch(err){$('settingsMessage').textContent='取り込みに失敗しました：'+err.message;}
  finally{e.target.value='';}
});
$('addArtistSong').addEventListener('click',()=>{$('addSongMessage').textContent='';$('addSongForm').reset();$('addDialog').showModal();});
$('addSongForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!state.artist)return;
  const source=$('addSongUrl').value.trim();
  if(!validSiteUrl(source,'youtube')&&!validSiteUrl(source,'nico')){$('addSongMessage').textContent='YouTubeまたはニコニコの正しいURLを入力してください。';return;}
  const item=sanitizeAdded({
    id:'local:'+Date.now().toString(36)+Math.random().toString(36).slice(2,10),artistId:state.artist.id,artistName:state.artist.name,
    name:$('addSongName').value, url:source,publishDate:$('addSongDate').value,songType:$('addSongType').value
  });
  if(!item){$('addSongMessage').textContent='入力内容を確認してください。';return;}
  manualUploads.push(item);
  if(!saveManual(manualUploads)){$('addSongMessage').textContent='ブラウザに保存できませんでした。';manualUploads.pop();return;}
  $('addDialog').close();displayCards();
});
const params=new URLSearchParams(location.search);const q=(params.get('q')||'').slice(0,100);
if(q){$('query').value=q;if(params.get('mode')==='artist')document.querySelector('input[name="searchMode"][value="artist"]').checked=true;search();}
