import { FIELDS, parseSheetCSV, guessMapping, createRecords, filterRecords, aggregateAll, safeHttpUrl, csvExport, normalizeName, userKey } from './lib/analytics.mjs';
import { combinedAliases, cleanAliases, removeDuplicateRequests, periodFor, computeTrends, makeTrends } from './lib/v3.mjs';
import { visibleUserRanking, ORGANIZER_NAMES } from './lib/organizers.mjs';
import { songVideoLinks, inheritVideoUrls } from './lib/video.mjs';
import { cleanVideoMap, chosenVideoFor } from './lib/vocadb.mjs';
import { recommendHiddenGems } from './lib/discovery.mjs';

const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('ja-JP');
const STATE = {
  headers: [], data: [], records: [], filtered: [], analysis: null, mapping: {},
  loading: false, source: 'sheet', gid: '0', page: 0, focus: null,
  showAll: { songs: false, artists: false, users: false },
  period: 'all', trend: null, aliases: {songs:{},artists:{},users:{}},
  globalAliases:{songs:{},artists:{},users:{}}, localAliases:{songs:{},artists:{},users:{}},
  dedupe: true, duplicateCount: 0, lastFetchedAt: 0, lastAttemptAt: 0,
  lastCSV: null, lastGid: null, showOrganizers: false,
  globalVideos:{}, localVideos:{}, videoCache:new Map(), activeVideoRecord:null, videoRequestId:0,
  hiddenGems:[], gemStats:null, previousGems:[]
};
const MAP_IDS = { song: 'mapSong', artist: 'mapArtist', user: 'mapUser', date: 'mapDate', url: 'mapUrl', cover: 'mapCover', video: 'mapVideo', youtube: 'mapYoutube', niconico: 'mapNiconico' };
const RANK_FIELDS = { songs: 'song', artists: 'artist', users: 'user' };
const MAX_CSV_SIZE = 5 * 1024 * 1024;
const DEMO = `曲名,アーティスト,ユーザー名,投稿日,投稿URL
星屑エコー,Producer A,@miku_melody,2026/08/03,https://x.com/example/status/1
夜明けのリズム,Producer B,@dance_voca,2026/08/15,https://x.com/example/status/2
星屑エコー,Producer A,@voca_lover,2026/09/04,https://x.com/example/status/3
透明な世界,Producer C,@miku_melody,2026/09/16,https://x.com/example/status/4
星屑エコー,Producer A,@dance_voca,2026/09/30,https://x.com/example/status/5
夜明けのリズム,Producer B,@miku_melody,2026/10/05,https://x.com/example/status/6
流星ドライブ,Producer D,@voca_lover,2026/10/09,https://x.com/example/status/7
星屑エコー,Producer A,@miku_melody,2026/10/12,https://x.com/example/status/8
透明な世界,Producer C,@dance_voca,2026/10/19,https://x.com/example/status/9
夜明けのリズム,Producer B,@voca_lover,2026/10/22,https://x.com/example/status/10
流星ドライブ,Producer D,@dance_voca,2026/11/01,https://x.com/example/status/11`;

function elt(tag, cls = '', txt = null) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== null) e.textContent = String(txt);
  return e;
}
function status(message, kind = 'neutral') {
  $('status').textContent = message;
  $('status').className = 'status ' + kind;
}
function text(id, value) { $(id).textContent = value; }
function clear(el) { el.replaceChildren(); }
function formatMonth(ym) { return ym ? ym.replace('-', '年') + '月' : '—'; }
function todayJST() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date()); const obj = Object.fromEntries(parts.map(p=>[p.type,p.value])); return `${obj.year}-${obj.month}-${obj.day}`; }
function readableTime(when) {return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(when);}
function storageGet(key, fallback) { try { const item=localStorage.getItem(key); return item === null ? fallback : JSON.parse(item); } catch {return fallback;} }
function storageSet(key, value) { try {localStorage.setItem(key,JSON.stringify(value));} catch {} }
function refreshAliasState() { STATE.aliases=combinedAliases(STATE.globalAliases, STATE.localAliases); }
async function loadGlobalAliases() {
  try { const response=await fetch('/aliases.json',{cache:'no-store'}); if(response.ok) STATE.globalAliases=cleanAliases(await response.json()); } catch {}
  STATE.localAliases=cleanAliases(storageGet('voca-v3-aliases',{})); refreshAliasState(); renderAliasList();
}
async function loadVideoLinks() {
  try {
    const res=await fetch('/video-links.json',{cache:'no-store'});
    if(res.ok) STATE.globalVideos=cleanVideoMap(await res.json());
  } catch { STATE.globalVideos={}; }
  STATE.localVideos=cleanVideoMap(storageGet('voca-v3-confirmed-videos',{}));
  updateVideoCount();
}
function updateVideoCount(){
  text('confirmedVideoCount', `このブラウザでの確定：${nf.format(Object.keys(STATE.localVideos).length)}件 ／ 全体共通：${nf.format(Object.keys(STATE.globalVideos).length)}件`);
}
function saveVideoLinks() {
  STATE.localVideos=cleanVideoMap(STATE.localVideos);
  storageSet('voca-v3-confirmed-videos',STATE.localVideos);
  updateVideoCount(); renderPosts(); renderGems();
}
function downloadVideoLinks() {
  const combined=cleanVideoMap({...STATE.globalVideos,...STATE.localVideos});
  const blob=new Blob([JSON.stringify(combined,null,2)+'\n'],{type:'application/json'});
  const objectUrl=URL.createObjectURL(blob), a=elt('a');
  a.href=objectUrl;a.download='video-links.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
}
function closeVideoDialog() { STATE.videoRequestId++; $('videoDialog').close(); STATE.activeVideoRecord=null; }
function videoDialogLine(parent,tag,cls,content) {const e=elt(tag,cls,content);parent.append(e);return e;}
function renderVideoCandidates(items, r) {
  const target=$('videoCandidateList');clear(target);
  let videosCount=0;
  for (const item of items) {
    const card=elt('article','video-candidate');
    const heading=elt('div','video-candidate-heading');
    const about=elt('div','video-candidate-about');
    videoDialogLine(about,'strong','video-candidate-song',item.title || '名称未登録');
    videoDialogLine(about,'span','video-candidate-artist',item.artist || 'アーティスト未登録');
    const badge=elt('span','video-match-badge',item.confidence);badge.title='類似度の目安です。公式動画である証明にはなりません。';
    heading.append(about,badge);card.append(heading);
    const voca=elt('a','video-candidate-vocadb',`VocaDBの楽曲ページ ↗${item.songType ? ' ／ ' + item.songType : ''}`);
    voca.href=item.url;voca.target='_blank';voca.rel='noopener noreferrer';card.append(voca);
    for (const pv of item.videos) {
      videosCount++;
      const row=elt('div','video-candidate-pv');
      const description=elt('div','video-pv-desc');
      videoDialogLine(description,'strong','',`${pv.platform}${pv.type ? ` ／ ${pv.type}` : ''}`);
      if (pv.title) videoDialogLine(description,'span','',pv.title);
      if (pv.author) videoDialogLine(description,'span','',`投稿者：${pv.author}`);
      const actions=elt('div','video-pv-actions');
      const watch=elt('a','video-preview-btn','動画確認 ↗');watch.href=pv.url;watch.target='_blank';watch.rel='noopener noreferrer';
      const choose=elt('button','video-choose-btn','この動画を採用');choose.type='button';
      choose.addEventListener('click',()=>{
        // Choose only a video that came from our sanitized API response.
        STATE.localVideos[r.songKey]={url:pv.url,platform:pv.platform};
        saveVideoLinks(); closeVideoDialog();
        status(`「${r.song}」の動画を確定しました。ほかの同じ楽曲の投稿にも反映します。`, 'success');
      });
      actions.append(watch,choose);row.append(description,actions);card.append(row);
    }
    target.append(card);
  }
  if (!items.length || !videosCount) {
    videoDialogLine(target,'p','video-no-results',items.length ? '該当する楽曲は見つかりましたが、YouTube・ニコニコ動画のURLは登録されていません。下の検索リンクから探してください。' : 'VocaDBに一致する候補が見つかりませんでした。下の検索リンクを利用してください。');
  }
  text('videoCandidateStatus',`${items.length}件の楽曲候補・${videosCount}件の動画候補を取得しました。採用前に動画を確認してください。`);
}
async function openVideoFinder(r) {
  if (!r?.song?.trim()) return;
  const dialog=$('videoDialog');
  STATE.activeVideoRecord=r;
  const seq=++STATE.videoRequestId;
  text('videoDialogTitle',r.song);
  text('videoDialogSub',r.artist || 'アーティスト未登録');
  text('videoCandidateStatus','VocaDBから動画候補を探しています…');
  clear($('videoCandidateList'));
  const searches=songVideoLinks({...r,video:'',youtube:'',niconico:''});
  $('videoYouTubeSearch').href=searches.main?.url || '#';
  $('videoNicoSearch').href=searches.alternate?.url || '#';
  if (!dialog.open) dialog.showModal();
  const key=r.songKey;
  try {
    let items=STATE.videoCache.get(key);
    if (!items) {
      const response=await fetch('/api/vocadb?'+new URLSearchParams({song:r.song,artist:r.artist}),{cache:'default'});
      if(!response.ok){let reason='候補検索に失敗しました。';try{reason=(await response.json()).error || reason;}catch{}throw Error(reason);}
      const payload=await response.json();
      items=Array.isArray(payload.candidates)?payload.candidates:[];
      STATE.videoCache.set(key,items);
    }
    if (seq!==STATE.videoRequestId || !dialog.open) return;
    renderVideoCandidates(items,r);
  } catch(e) {
    if (seq!==STATE.videoRequestId || !dialog.open) return;
    text('videoCandidateStatus',e.message || '候補取得に失敗しました。');
    videoDialogLine($('videoCandidateList'),'p','video-no-results','下のYouTube・ニコニコ検索リンクから探すこともできます。');
  }
}

function rebuildRecords(shouldRender = true) {
  const raw=inheritVideoUrls(createRecords(STATE.data,STATE.mapping,STATE.aliases));
  const result=removeDuplicateRequests(raw,STATE.dedupe);
  STATE.records=result.records; STATE.duplicateCount=result.removed;
  shuffleGems();
  text('dedupeInfo', `現在 ${nf.format(STATE.duplicateCount)} 行を重複として除外中。※ 同じ投稿URL＋同じ楽曲・アーティストの組合せだけを除外します。URLのない行は除外しません。`);
  if (shouldRender) render();
}
function shuffleGems() {
  const picks=recommendHiddenGems(STATE.records, {count:5,previousKeys:STATE.previousGems});
  STATE.hiddenGems=picks.recommendations;
  STATE.previousGems=picks.recommendations.map(g=>g.key);
  STATE.gemStats=picks;
  renderGems();
}
function renderGems() {
  const target=$('gemsList');
  clear(target);
  const groups=STATE.hiddenGems;
  $('rerollGems').disabled = !STATE.gemStats || STATE.gemStats.eligibleCount < 2;
  if (!groups.length) {
    target.append(elt('p','gems-empty', STATE.records.length ? '曲名とボカロPが登録された楽曲がありません。列の設定を確認してください。' : 'データを読み込むと、おすすめの楽曲を表示します。'));
    text('gemsFoot','データの読み込み後に候補を抽選します。');
    return;
  }
  for (let i=0;i<groups.length;i++) {
    const g=groups[i];
    const r=STATE.records.find(row=>row.songKey===g.key);
    const card=elt('article','gem-card');
    const top=elt('div','gem-top');
    top.append(elt('span','gem-index',`PICK ${String(i+1).padStart(2,'0')}`),elt('span','gem-spark','✦'));
    const body=elt('div','gem-body');
    if (r) body.append(makeArtwork(r));
    const labels=elt('div','gem-labels');
    labels.append(elt('h3','gem-title',g.label),elt('p','gem-artist',g.artist));
    body.append(labels);card.append(top,body);
    const stats=elt('div','gem-stats');
    stats.append(elt('span','',`この曲 ${nf.format(g.songCount)} 件`),elt('span','',`このP 総計 ${nf.format(g.artistCount)} 件`));
    card.append(stats);
    const actions=elt('div','gem-actions');
    const posts=elt('button','gem-posts','投稿を見る'); posts.type='button';
    posts.addEventListener('click',()=>{
      // Clear unrelated filters so the selected song's posts are actually visible.
      STATE.period='all';
      $('searchInput').value='';$('startDate').value='';$('endDate').value='';updatePeriodButtons();
      STATE.focus={field:'song',key:g.key,label:`${g.label} / ${g.artist}`};STATE.page=0;
      render();$('posts').scrollIntoView({behavior:'smooth',block:'start'});
    });
    actions.append(posts);
    if (r) {
      const chosen=chosenVideoFor(r,STATE.globalVideos,STATE.localVideos);
      if (chosen) {
        const link=elt('a','gem-video','♫ 動画を見る');link.href=chosen.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
      } else {
        const video=elt('button','gem-video','♫ 動画を探す');video.type='button';
        video.addEventListener('click',()=>openVideoFinder(r));actions.append(video);
      }
    }
    card.append(actions); target.append(card);
  }
  const suffix=groups.length<5?`（対象曲が${groups.length}曲のため、${groups.length}曲表示）`:'';
  text('gemsFoot',`候補 ${nf.format(STATE.gemStats.eligibleCount)}曲から抽選 / 対象の曲は${STATE.gemStats.cutoff}件以下のリクエスト ${suffix}。ボカロPの総件数が少ないほど選ばれやすくなります。`);
}

function updatePeriodButtons() {
  document.querySelectorAll('[data-period]').forEach(btn => {const on=btn.dataset.period===STATE.period;btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));});
  const p=periodFor(STATE.period,todayJST());
  text('periodLabel', p.mode==='all' ? '全期間を集計' : `${p.start} 〜 ${p.end}`);
  text('trendHelp',p.mode==='all' ? '直近7日・30日を選ぶと順位の変動を表示' : `前の${STATE.period}日間（${p.prevStart} 〜 ${p.prevEnd}）と比較`);
}
function setPeriod(value) {STATE.period=value;STATE.page=0;$('startDate').value='';$('endDate').value='';updatePeriodButtons();render();}
function renderAliasList() {
  const target=$('aliasList');clear(target);
  const entries=Object.entries(STATE.localAliases).flatMap(([type, map])=>Object.entries(map).map(([from,to])=>({type,from,to})));
  text('aliasCount',`このブラウザで登録：${nf.format(entries.length)} 件 ／ 全体共通：${Object.values(STATE.globalAliases).reduce((n,m)=>n+Object.keys(m).length,0)} 件`);
  if (!entries.length) {target.append(elt('span','subtle','まだブラウザ固有の統合ルールはありません。'));return;}
  for (const entry of entries) {
    const row=elt('div','alias-entry');
    row.append(elt('span','alias-type',({songs:'楽曲',artists:'アーティスト',users:'ユーザー'})[entry.type]));
    row.append(elt('span','alias-from',entry.from));row.append(elt('span','alias-arrow','→'));row.append(elt('strong','alias-to',entry.to));
    const remove=elt('button','alias-remove','削除');remove.type='button';remove.addEventListener('click',()=>{
      delete STATE.localAliases[entry.type][entry.from];saveAliasesAndRender();
    });row.append(remove);target.append(row);
  }
}
function saveAliasesAndRender() {STATE.localAliases=cleanAliases(STATE.localAliases); storageSet('voca-v3-aliases',STATE.localAliases);refreshAliasState();renderAliasList();rebuildRecords();}


function restoreMapping(guessed) {
  if (STATE.source !== 'sheet') return guessed;
  try {
    const saved = JSON.parse(localStorage.getItem('voca-mapping:' + STATE.gid) || '{}');
    const next = {...guessed};
    for (const field of FIELDS) {
      if (typeof saved[field] === 'string') {
        const idx = STATE.headers.indexOf(saved[field]);
        if (idx >= 0) next[field] = idx;
      }
    }
    return next;
  } catch { return guessed; }
}

function updateMappingUI() {
  for (const field of FIELDS) {
    const select = $(MAP_IDS[field]);
    clear(select);
    const blank = elt('option', '', '— 選択しない —'); blank.value = '-1'; select.append(blank);
    for (const [i, header] of STATE.headers.entries()) {
      const option = elt('option', '', header); option.value = String(i); select.append(option);
    }
    select.value = String(STATE.mapping[field] ?? -1);
  }
  let missing = [];
  for (const field of ['song','artist','user','date']) if (STATE.mapping[field] < 0) missing.push(({song:'曲名',artist:'アーティスト',user:'ユーザー',date:'投稿日'})[field]);
  text('mappingHint', missing.length ? `自動判定できなかった項目：${missing.join('、')}。該当列を選択してください。` : '列の自動判定が完了しました。');
  if (missing.length) $('mappingDetails').open = true;
}
function applyMapping(next) {
  STATE.mapping = next;
  rebuildRecords(false);
  STATE.focus = null;
  STATE.page = 0;
  STATE.showAll = {songs:false, artists:false, users:false};
  try {
    if (STATE.source === 'sheet') {
      const stored = {};
      for (const field of FIELDS) stored[field] = STATE.headers[next[field]] ?? null;
      localStorage.setItem('voca-mapping:' + STATE.gid, JSON.stringify(stored));
    }
  } catch { /* Storage may be unavailable in private mode. */ }
  render();
}
function useData(csv, source, label) {
  const parsed = parseSheetCSV(csv);
  if (!parsed.headers.length || !parsed.data.length) throw new Error('見出し行とデータ行があるCSVを指定してください。');
  STATE.source = source;
  STATE.headers = parsed.headers;
  STATE.data = parsed.data;
  STATE.gid = $('gidInput').value.trim() || '0';
  const mapping = restoreMapping(guessMapping(parsed.headers, parsed.data));
  STATE.mapping = mapping;
  updateMappingUI();
  applyMapping(mapping);
  const missing = ['song','artist','user','date'].filter(field => mapping[field] < 0);
  status(`${label}：${nf.format(parsed.data.length)}行・${parsed.headers.length}列を読み込みました。` + (STATE.duplicateCount ? ` 重複 ${STATE.duplicateCount}行を除外。` : '') + (missing.length ? ' 「列の設定」を確認してください。' : ''), source === 'demo' ? 'demo' : 'success');
}
async function loadRemote(manual = false) {
  const gid = $('gidInput').value.trim() || '0';
  if (!/^\d{1,20}$/.test(gid)) { status('gidは数字のみで指定してください。', 'error'); return; }
  if (STATE.loading) return;
  STATE.loading = true; STATE.lastAttemptAt=Date.now();
  storageSet('voca-v3-gid',gid);
  $('refreshBtn').disabled = true;
  status('Googleスプレッドシートからデータを取得しています…');
  try {
    const response = await fetch(`/api/sheet?gid=${encodeURIComponent(gid)}${manual ? '&refresh=1' : ''}`, {cache:'no-store'});
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { detail = (await response.json()).error || detail; } catch {}
      throw new Error(detail);
    }
    const body = await response.text();
    if (body.length > MAX_CSV_SIZE * 2) throw new Error('データが大きすぎます。5MB未満のCSVを使用してください。');
    if (STATE.source === 'sheet' && STATE.lastCSV === body && STATE.lastGid === gid) {
      status('Google Sheetsを確認しました。前回から変更はありません。','success');
    } else if (STATE.source === 'sheet' && STATE.lastGid === gid) {
      const parsed=parseSheetCSV(body);
      if (JSON.stringify(parsed.headers) === JSON.stringify(STATE.headers)) {
        STATE.data=parsed.data;rebuildRecords();
        status(`Google Sheetsの更新を反映しました。${nf.format(parsed.data.length)}行を読み込み、重複${STATE.duplicateCount}行を除外しています。`,'success');
      } else useData(body, 'sheet', 'Google Sheets');
    } else {
      useData(body, 'sheet', 'Google Sheets');
    }
    STATE.lastCSV=body; STATE.lastGid=gid; STATE.lastFetchedAt=Date.now();
    text('lastUpdated',`最終更新：${readableTime(STATE.lastFetchedAt)}（日本時間）`);
  } catch (e) {
    status(`シートを取得できませんでした：${e.message} サンプル表示かCSV読み込みでも動作確認できます。`, 'error');
  } finally { STATE.loading = false; $('refreshBtn').disabled = false; }
}

function resetFilters() {
  STATE.period='all';updatePeriodButtons();
  $('searchInput').value = '';
  $('startDate').value = '';
  $('endDate').value = '';
  STATE.focus = null;
  STATE.page = 0;
  render();
}
function updateOrganizerToggle() {
  const btn=$('toggleOrganizers');
  btn.setAttribute('aria-pressed',String(STATE.showOrganizers));
  btn.textContent=STATE.showOrganizers ? 'レギュラーDJ4名を非表示にする' : 'レギュラーDJ4名を表示する';
  text('organizerNote', STATE.showOrganizers
    ? `レギュラーDJ4名（${ORGANIZER_NAMES.join('・')}）を含めて表示中`
    : `レギュラーDJ4名（${ORGANIZER_NAMES.join('・')}）は除外中`);
}
function userRanking() { return visibleUserRanking(STATE.analysis?.users || [], STATE.showOrganizers); }
function recalcUserTrend(p) {
  if (p.mode==='all') return;
  // 前期と当期で同じ表示条件に揃えてから順位変動を計算する。
  const base=filterRecords(STATE.records,{query:$('searchInput').value,focus:STATE.focus});
  const prev=aggregateAll(base.filter(r=>r.date && r.date>=p.prevStart && r.date<=p.prevEnd)).users;
  STATE.trend.users=makeTrends(userRanking(),visibleUserRanking(prev,STATE.showOrganizers),base,p.start,'user');
}
function render() {
  const p=periodFor(STATE.period,todayJST());
  STATE.filtered = filterRecords(STATE.records, {
    query: $('searchInput').value, start: p.start || $('startDate').value, end: p.end || $('endDate').value, focus: STATE.focus
  });
  STATE.trend=computeTrends(STATE.records,{mode:STATE.period,today:todayJST(),query:$('searchInput').value,focus:STATE.focus});
  STATE.analysis = aggregateAll(STATE.filtered);
  recalcUserTrend(p);
  updateOrganizerToggle();
  const a = STATE.analysis;
  text('countAll', nf.format(a.rowCount));
  text('countSongs', nf.format(a.songs.length));
  text('countArtists', nf.format(a.artists.length));
  text('countUsers', nf.format(a.users.length));
  updateFocus(); renderFreshTracks();
  for (const kind of ['songs', 'artists', 'users']) renderRanking(kind);
  renderMonths();
  renderPosts();
}
function updateFocus() {
  const chip = $('focusChip');
  clear(chip);
  chip.hidden = !STATE.focus;
  if (STATE.focus) {
    chip.append(elt('span','',`選択中：${STATE.focus.label}`));
    const b = elt('button','', '✕ 解除'); b.type = 'button';
    b.addEventListener('click', () => { STATE.focus = null; STATE.page = 0; render(); });
    chip.append(b);
  }
}
function makeArtwork(record) {
  const box=elt('span','rank-art');
  const raw=record?.cover;const src=safeHttpUrl(raw);
  if (src && src.startsWith('https://')) {
    const img=elt('img');img.src=src;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>{box.replaceChildren(elt('span','', '♫'));};box.append(img);
  } else box.append(elt('span','','♫'));
  return box;
}
function renderFreshTracks() {
  const sec=$('freshTracks'),target=$('freshItems');clear(target);
  if (STATE.period==='all') {sec.hidden=true;return;}
  const list=STATE.analysis.songs.filter(g=>STATE.trend.songs.get(g.key)?.isNew).slice(0,7);
  sec.hidden = !list.length;
  list.forEach(g=>{const button=elt('button','fresh-card');button.type='button';
    button.append(elt('span','fresh-symbol','✦'),elt('strong','',g.label),elt('small','',g.detail+' ・ '+g.count+' 件'));
    button.addEventListener('click',()=>{STATE.focus={field:'song',key:g.key,label:g.label+' / '+g.detail};STATE.page=0;render();$('posts').scrollIntoView({behavior:'smooth',block:'start'});});target.append(button);
  });
}
function renderRanking(kind) {
  const groups = kind==='users' ? userRanking() : STATE.analysis[kind];
  const target = $({songs:'songRanking', artists:'artistRanking', users:'userRanking'}[kind]);
  const more = $({songs:'moreSongs',artists:'moreArtists',users:'moreUsers'}[kind]);
  clear(target);
  if (!groups.length) { target.append(elt('div','empty', STATE.records.length ? '条件に合う集計対象がありません。列の設定も確認してください。' : 'データがありません。')); more.hidden = true; return; }
  const length = STATE.showAll[kind] ? groups.length : Math.min(kind === 'users' ? 10 : 10, groups.length);
  const top = groups.slice(0, length), max = groups[0].count;
  for (const g of top) {
    const button = elt('button', 'rank-item'); button.type = 'button';
    button.title = `${g.label} の投稿に絞り込み`;
    button.setAttribute('aria-label',`${g.rank}位 ${g.label} ${g.count}件。クリックで絞り込み`);
    const place = elt('span', 'rank-place' + (g.rank <= 3 ? ' rank-' + g.rank : ''), String(g.rank).padStart(2,'0'));
    const sample=STATE.filtered.find(r=>(kind==='songs'?r.songKey:kind==='artists'?r.artistKey:r.userKey)===g.key && r.cover);
    if (kind==='songs') {button.classList.add('has-art');button.append(makeArtwork(sample));}
    const middle = elt('span','rank-main');
    middle.append(elt('span','rank-name',g.label));
    const explanation = kind === 'songs' ? (g.detail || 'アーティスト未登録') : kind === 'users' ? `${nf.format(g.uniqueSongs)}曲をリクエスト` : `${nf.format(g.uniqueSongs)}曲にリクエスト`;
    middle.append(elt('span','rank-sub',explanation));
    const movement=STATE.trend?.[kind]?.get(g.key);
    if (STATE.period!=='all' && movement) {
      const tag = movement.isNew ? 'NEW' : movement.isReturning ? '再登場' : movement.change == null ? '前期なし' : movement.change > 0 ? `↑ ${movement.change}` : movement.change < 0 ? `↓ ${Math.abs(movement.change)}` : '→ 同順位';
      const span=elt('span','rank-movement '+(movement.isNew?'is-new':movement.change>0?'is-up':movement.change<0?'is-down':'is-flat'),tag);
      middle.append(span);
    }
    const track = elt('span','rank-track');
    const fill = elt('span','rank-bar'); fill.style.width = Math.max(2,(g.count / max) * 100) + '%'; track.append(fill);
    const count = elt('span','rank-count'); count.append(elt('strong','',nf.format(g.count)),elt('small','','件'));
    button.append(place,middle,track,count);
    if (g.rank<=3) button.classList.add('top-rank','top-'+g.rank);
    button.addEventListener('click', () => {
      STATE.focus = {field: RANK_FIELDS[kind], key: g.key, label: `${g.label}${kind === 'songs' ? ' / ' + g.detail : ''}`};
      STATE.page = 0; render(); $('posts').scrollIntoView({behavior:'smooth',block:'start'});
    });
    target.append(button);
  }
  more.hidden = groups.length <= 10;
  more.textContent = STATE.showAll[kind] ? '上位10件に戻す  ⌃' : `全${nf.format(groups.length)}件を表示  ⌄`;
}
function renderMonths() {
  const a = STATE.analysis;
  const chart = $('monthlyChart'), table = $('monthlyRows');
  clear(chart); clear(table);
  if (!a.months.length) {
    chart.append(elt('div','empty','有効な投稿日がありません。列の設定で「投稿日」を指定してください。'));
    text('monthFoot', `日付を認識できない行：${nf.format(a.undatedCount)}件`);
    return;
  }
  // SVG bar chart. All months are included, even months without a post.
  const NS = 'http://www.w3.org/2000/svg';
  const per = 72, left = 48, top = 26, plotHeight = 154, bottom = 48;
  const width = Math.max(620, left + a.months.length * per + 20), height = top + plotHeight + bottom;
  const svg = document.createElementNS(NS,'svg');
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  svg.setAttribute('role','img'); svg.setAttribute('aria-label','月別投稿数の棒グラフ');
  svg.setAttribute('class','month-svg'); svg.style.minWidth = width + 'px';
  const max = Math.max(1, ...a.months.map(v => v.count));
  const upper = Math.max(4, Math.ceil(max / 4) * 4);
  const add = (tag, attributes, label) => {
    const n = document.createElementNS(NS, tag);
    for (const [key, val] of Object.entries(attributes)) n.setAttribute(key,String(val));
    if (label != null) n.textContent = label;
    svg.append(n); return n;
  };
  for (let i = 0; i <= 4; i++) {
    const value = Math.round((upper * i / 4) * 10) / 10, y = top + plotHeight * (1 - i / 4);
    add('line',{x1:left, x2:width - 12, y1:y,y2:y,stroke:'#d7edf1','stroke-dasharray':'4 5'});
    add('text',{x:left-12,y:y+4,'text-anchor':'end',fill:'#596f88','font-size':11}, nf.format(value));
  }
  for (const [i, item] of a.months.entries()) {
    const barWidth = 38, x = left + 17 + i*per, barHeight = (item.count / upper)*plotHeight;
    const rect = add('rect',{x,y:top+plotHeight-barHeight,width:barWidth,height:barHeight,rx:5,fill:item.count ? '#16bfcf' : '#e5f0f3'});
    const tip = document.createElementNS(NS,'title'); tip.textContent = `${formatMonth(item.month)}：${item.count}件`; rect.append(tip);
    if (item.count) add('text',{x:x+barWidth/2,y:top+plotHeight-barHeight-9,'text-anchor':'middle',fill:'#203b56','font-size':12,'font-weight':700},String(item.count));
    add('text',{x:x+barWidth/2,y:top+plotHeight+22,'text-anchor':'middle',fill:'#435b77','font-size':11},item.month.slice(5)+'月');
    add('text',{x:x+barWidth/2,y:top+plotHeight+37,'text-anchor':'middle',fill:'#708198','font-size':10},item.month.slice(0,4));
    const tr = elt('tr'); tr.append(elt('td','',formatMonth(item.month)),elt('td','',nf.format(item.count)+' 件')); table.append(tr);
  }
  chart.append(svg);
  const topMonth = [...a.months].sort((x,y)=>y.count-x.count)[0];
  text('monthFoot', `集計期間：${formatMonth(a.months[0].month)}〜${formatMonth(a.months.at(-1).month)}　／　最多：${formatMonth(topMonth.month)}（${nf.format(topMonth.count)}件）` + (a.undatedCount ? `　／　日付を認識できない行：${nf.format(a.undatedCount)}件` : ''));
}
function renderPosts() {
  const target = $('postsBody'); clear(target);
  const ordered = [...STATE.filtered].sort((a,b) => (b.date||'').localeCompare(a.date||'') || b.index-a.index);
  const pages = Math.max(1,Math.ceil(ordered.length / 15)); STATE.page = Math.min(STATE.page,pages-1);
  const visible = ordered.slice(STATE.page*15,(STATE.page+1)*15);
  if (!visible.length) {
    const tr = elt('tr'); const td = elt('td','empty','該当する投稿はありません'); td.colSpan = 5; tr.append(td); target.append(tr);
  }
  for (const r of visible) {
    const tr = elt('tr');
    const songTd = elt('td','song-cell');
    const selected=chosenVideoFor(r,STATE.globalVideos,STATE.localVideos);
    if (r.song?.trim()) {
      if (selected) {
        const link=elt('a','song-video-link',r.song);
        link.href=selected.url;link.target='_blank';link.rel='noopener noreferrer';
        link.title=`${selected.platform}の動画を開く`;
        songTd.append(link);
        const info=elt('div','song-video-meta');
        info.append(elt('span','video-exact',`${selected.platform} 動画 ↗`));
        const choose=elt('button','video-find-btn','候補を再検索');choose.type='button';
        choose.addEventListener('click',()=>openVideoFinder(r));info.append(choose);songTd.append(info);
      } else {
        const button=elt('button','song-video-find',r.song);button.type='button';
        button.title='VocaDBから動画候補を検索する';
        button.addEventListener('click',()=>openVideoFinder(r));songTd.append(button);
        const info=elt('div','song-video-meta');
        const find=elt('button','video-find-btn','VocaDBで動画候補を探す ↗');find.type='button';
        find.addEventListener('click',()=>openVideoFinder(r));info.append(find);songTd.append(info);
      }
    } else songTd.textContent='—';
    tr.append(elt('td','date-cell',r.rawDate || '—'),songTd,elt('td','',r.artist || '—'),elt('td','',r.user || '—'));
    const td = elt('td');
    const url = safeHttpUrl(r.url);
    if (url) { const link = elt('a','post-link','投稿を見る ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; td.append(link); }
    else td.textContent = '—';
    tr.append(td); target.append(tr);
  }
  text('postCount',`${nf.format(ordered.length)}件中 ${ordered.length ? nf.format(STATE.page*15+1)+'〜'+nf.format(Math.min((STATE.page+1)*15,ordered.length)) : '0'}件を表示`);
  text('pageLabel',`${STATE.page+1} / ${pages}`);
  $('prevBtn').disabled = STATE.page <= 0; $('nextBtn').disabled = STATE.page >= pages-1;
}
function download(kind) {
  if (!STATE.records.length) { status('データ読み込み後にCSVを保存できます。','error'); return; }
  const a = STATE.analysis;
  const out = {
    songs: [['順位','曲名','アーティスト','リクエスト件数','ユニーク投稿者数','順位変動'],...a.songs.map(g=>[g.rank,g.label,g.detail,g.count,g.uniqueUsers,STATE.period==='all'?'':(STATE.trend.songs.get(g.key)?.isNew ? 'NEW' : STATE.trend.songs.get(g.key)?.change ?? '')])],
    artists: [['順位','アーティスト','リクエスト件数','楽曲数','順位変動'],...a.artists.map(g=>[g.rank,g.label,g.count,g.uniqueSongs,STATE.period==='all'?'':STATE.trend.artists.get(g.key)?.change ?? ''])],
    users: [['順位','ユーザー','リクエスト件数','リクエストした楽曲数','順位変動'],...userRanking().map(g=>[g.rank,g.label,g.count,g.uniqueSongs,STATE.period==='all'?'':STATE.trend.users.get(g.key)?.change ?? ''])],
    months: [['月','リクエスト件数'],...a.months.map(v=>[v.month,v.count])],
    records: [['投稿日','楽曲名','アーティスト名','ユーザー名','投稿URL','動画URL','YouTube URL','ニコニコURL'],...STATE.filtered.map(r=>[r.rawDate,r.song,r.artist,r.user,r.url,r.video,r.youtube,r.niconico])]
  }[kind];
  if (!out) return;
  const blob = new Blob([csvExport(out)],{type:'text/csv;charset=utf-8'});
  const objectUrl = URL.createObjectURL(blob); const anchor = elt('a');
  anchor.href = objectUrl; anchor.download = `voca-requests-${kind}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
}

function registrationFeedback(message, kind='neutral') {
  const target = $('registrationResult');
  target.hidden = false;
  target.textContent = message;
  target.className = 'registration-result ' + kind;
}
function openRegistration() {
  const dialog = $('registrationDialog');
  $('registerDate').value ||= todayJST();
  $('registrationResult').hidden = true;
  dialog.showModal();
  $('registerUser').focus();
}
async function submitRegistration(event) {
  event.preventDefault();
  const form = $('registrationForm');
  if (!form.reportValidity()) return;
  const submit = $('registrationSubmit');
  submit.disabled=true;
  submit.textContent='登録しています…';
  $('registrationResult').hidden=true;
  const body = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch('/api/register', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),
      cache:'no-store'
    });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || `登録に失敗しました（HTTP ${response.status}）。`);
    form.reset();
    $('registerDate').value=todayJST();
    registrationFeedback('✓ スプレッドシートに登録しました。ランキングを再読み込みしています。','success');
    await loadRemote(true);
    registrationFeedback('✓ 登録が完了しました。集計画面を確認するか、続けて入力できます。','success');
  } catch(error) {
    registrationFeedback('登録できませんでした：'+(error?.message || '通信に失敗しました。'),'error');
  } finally {
    submit.disabled=false;
    submit.textContent='この内容で登録する';
  }
}

async function setup() {
  STATE.dedupe=storageGet('voca-v3-dedupe',true)!==false; $('dedupeToggle').checked=STATE.dedupe;
  $('autoRefresh').checked=storageGet('voca-v3-autorefresh',true)!==false;
  await loadGlobalAliases();
  await loadVideoLinks();
  updatePeriodButtons();
  const query = new URLSearchParams(location.search);
  const gid = query.get('gid');
  if (gid && /^\d{1,20}$/.test(gid)) $('gidInput').value = gid;
  else {const savedGid=storageGet('voca-v3-gid','0'); if(/^\d{1,20}$/.test(String(savedGid))) $('gidInput').value = String(savedGid);}
  $('registerBtn').addEventListener('click',openRegistration);
  $('registrationClose').addEventListener('click',()=>$('registrationDialog').close());
  $('registrationCancel').addEventListener('click',()=>$('registrationDialog').close());
  $('registrationForm').addEventListener('submit',submitRegistration);
  $('registrationDialog').addEventListener('click',e=>{if(e.target===$('registrationDialog')) $('registrationDialog').close();});
  $('refreshBtn').addEventListener('click',()=>loadRemote(true));
  $('gidInput').addEventListener('keydown',e=>{if(e.key === 'Enter') loadRemote(true);});
  $('demoBtn').addEventListener('click',()=>{try { useData(DEMO,'demo','架空のサンプルデータ'); } catch(e) {status(e.message,'error');}});
  $('csvFile').addEventListener('change',async e=>{
    const file = e.target.files?.[0]; if (!file) return;
    try {
      if (file.size > MAX_CSV_SIZE) throw new Error('5MB以下のCSVファイルを選択してください。');
      useData(await file.text(),'file',`ローカルCSV（${file.name}）`);
    } catch(err) { status(`CSVを読み込めませんでした：${err.message}`,'error'); }
    e.target.value = '';
  });
  $('mappingForm').addEventListener('submit',e=>{
    e.preventDefault(); if (!STATE.headers.length) return;
    const mapping = Object.fromEntries(FIELDS.map(field=>[field,Number($(MAP_IDS[field]).value)]));
    const used = FIELDS.map(field=>mapping[field]).filter(i=>i>=0);
    if (new Set(used).size !== used.length) { status('同じ列を複数の項目に設定できません。','error'); return; }
    applyMapping(mapping); updateMappingUI(); $('mappingDetails').open = false;
    status('列の設定を更新して再集計しました。','success');
  });
  for (const id of ['searchInput','startDate','endDate']) $(id).addEventListener('input',()=>{if(id!=='searchInput') {STATE.period='all';updatePeriodButtons();}STATE.page=0;render();});
  document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>setPeriod(b.dataset.period)));
  $('dedupeToggle').addEventListener('change',e=>{STATE.dedupe=e.target.checked;storageSet('voca-v3-dedupe',STATE.dedupe);rebuildRecords();});
  $('aliasForm').addEventListener('submit',e=>{e.preventDefault();const type=$('aliasKind').value;const from=$('aliasFrom').value.trim(),to=$('aliasTo').value.trim();if(!from||!to)return;const key=type==='users'?userKey(from):normalizeName(from);if(!key) return;STATE.localAliases[type][key]=to;saveAliasesAndRender();$('aliasFrom').value='';$('aliasTo').value='';status('表記の統合ルールを保存しました。このブラウザ内で集計に反映しました。','success');});
  $('clearAliases').addEventListener('click',()=>{if(!confirm('このブラウザの統合ルールをすべて削除しますか？'))return;STATE.localAliases={songs:{},artists:{},users:{}};saveAliasesAndRender();});
  $('exportAliases').addEventListener('click',()=>{const out=combinedAliases(STATE.globalAliases, STATE.localAliases);const blob=new Blob([JSON.stringify(out,null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const a=elt('a');a.href=url;a.download='aliases.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  $('autoRefresh').addEventListener('change',e=>{storageSet('voca-v3-autorefresh',e.target.checked);});
  $('videoDialogClose').addEventListener('click',closeVideoDialog);
  $('videoDialogDismiss').addEventListener('click',closeVideoDialog);
  $('videoDialog').addEventListener('close',()=>{STATE.videoRequestId++;STATE.activeVideoRecord=null;});
  $('exportVideoLinks').addEventListener('click',downloadVideoLinks);
  $('resetLocalVideoLinks').addEventListener('click',()=>{if(!confirm('このブラウザで確定した動画リンクをすべて解除しますか？'))return; STATE.localVideos={};saveVideoLinks();});
  $('rerollGems').addEventListener('click',shuffleGems);
  $('toggleOrganizers').addEventListener('click',()=>{STATE.showOrganizers=!STATE.showOrganizers;STATE.showAll.users=false;render();});
  const autoCheck=()=>{if(!$('autoRefresh').checked||STATE.source!=='sheet'||document.visibilityState==='hidden'||STATE.loading)return;if(Date.now()-STATE.lastAttemptAt>=5*60*1000) loadRemote(false);};
  setInterval(autoCheck,60*1000);document.addEventListener('visibilitychange',autoCheck);window.addEventListener('focus',autoCheck);
  $('shareBtn').addEventListener('click',()=>{const message=`#ボカオバリクエスト 人気曲ランキングをチェック！\n${location.origin}${location.pathname}\n#ボカロ`;window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(message),'_blank','noopener,noreferrer');});
  $('resetBtn').addEventListener('click',resetFilters);
  for (const kind of ['Songs','Artists','Users']) {
    const k = kind.toLowerCase();
    $('more'+kind).addEventListener('click',()=>{STATE.showAll[k]=!STATE.showAll[k]; renderRanking(k);});
  }
  for (const b of document.querySelectorAll('[data-export]')) b.addEventListener('click',()=>download(b.dataset.export));
  $('prevBtn').addEventListener('click',()=>{STATE.page--;renderPosts();});
  $('nextBtn').addEventListener('click',()=>{STATE.page++;renderPosts();});
  render();renderGems();
  if (query.get('demo')==='1') $('demoBtn').click(); else loadRemote(false);
}
setup();
