import { FIELDS, parseSheetCSV, guessMapping, createRecords, filterRecords, aggregateAll, safeHttpUrl, csvExport, normalizeName, userKey } from './lib/analytics.mjs';
import { combinedAliases, cleanAliases, removeDuplicateRequests, periodFor, computeTrends, makeTrends } from './lib/v3.mjs';
import { visibleUserRanking, ORGANIZER_NAMES } from './lib/organizers.mjs';
import { songVideoLinks, inheritVideoUrls } from './lib/video.mjs';

const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('ja-JP');
const STATE = {
  headers: [], data: [], records: [], filtered: [], analysis: null, mapping: {},
  loading: false, source: 'sheet', gid: '0', page: 0, focus: null,
  showAll: { songs: false, artists: false, users: false },
  period: 'all', trend: null, aliases: {songs:{},artists:{},users:{}},
  globalAliases:{songs:{},artists:{},users:{}}, localAliases:{songs:{},artists:{},users:{}},
  dedupe: true, duplicateCount: 0, lastFetchedAt: 0, lastAttemptAt: 0,
  lastCSV: null, lastGid: null, showOrganizers: false
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
function rebuildRecords(shouldRender = true) {
  const raw=inheritVideoUrls(createRecords(STATE.data,STATE.mapping,STATE.aliases));
  const result=removeDuplicateRequests(raw,STATE.dedupe);
  STATE.records=result.records; STATE.duplicateCount=result.removed;
  text('dedupeInfo', `現在 ${nf.format(STATE.duplicateCount)} 行を重複として除外中。※ 同じ投稿URL＋同じ楽曲・アーティストの組合せだけを除外します。URLのない行は除外しません。`);
  if (shouldRender) render();
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
    const videoLinks = songVideoLinks(r);
    if (videoLinks.main) {
      const main = elt('a','song-video-link',r.song);
      main.href = videoLinks.main.url;
      main.target = '_blank';
      main.rel = 'noopener noreferrer';
      main.title = videoLinks.main.mode === 'direct' ? `${videoLinks.main.platform}の動画を開く` : 'YouTubeで曲名＋アーティスト名を検索（動画未登録）';
      main.setAttribute('aria-label', `${r.song}：${main.title}`);
      songTd.append(main);
      const info = elt('div','song-video-meta');
      info.append(elt('span', videoLinks.main.mode === 'direct' ? 'video-exact' : 'video-search',
        videoLinks.main.mode === 'direct' ? `${videoLinks.main.platform} 動画 ↗` : 'YouTube検索結果 ↗'));
      if (videoLinks.alternate) {
        const alt = elt('a','video-nico-search','ニコニコ検索 ↗');
        alt.href = videoLinks.alternate.url;
        alt.target = '_blank'; alt.rel = 'noopener noreferrer';
        alt.setAttribute('aria-label', `${r.song}をニコニコ動画で検索`);
        info.append(alt);
      }
      songTd.append(info);
    } else songTd.textContent = r.song || '—';
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

async function setup() {
  STATE.dedupe=storageGet('voca-v3-dedupe',true)!==false; $('dedupeToggle').checked=STATE.dedupe;
  $('autoRefresh').checked=storageGet('voca-v3-autorefresh',true)!==false;
  await loadGlobalAliases();
  updatePeriodButtons();
  const query = new URLSearchParams(location.search);
  const gid = query.get('gid');
  if (gid && /^\d{1,20}$/.test(gid)) $('gidInput').value = gid;
  else {const savedGid=storageGet('voca-v3-gid','0'); if(/^\d{1,20}$/.test(String(savedGid))) $('gidInput').value = String(savedGid);}
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
  render();
  if (query.get('demo')==='1') $('demoBtn').click(); else loadRemote(false);
}
setup();
