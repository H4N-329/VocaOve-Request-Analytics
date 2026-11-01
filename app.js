import { FIELDS, parseSheetCSV, guessMapping, createRecords, filterRecords, aggregateAll, safeHttpUrl, csvExport } from './lib/analytics.mjs';

const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('ja-JP');
const STATE = {
  headers: [], data: [], records: [], filtered: [], analysis: null, mapping: {},
  loading: false, source: 'sheet', gid: '0', page: 0, focus: null,
  showAll: { songs: false, artists: false, users: false }
};
const MAP_IDS = { song: 'mapSong', artist: 'mapArtist', user: 'mapUser', date: 'mapDate', url: 'mapUrl' };
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
  STATE.records = createRecords(STATE.data, STATE.mapping);
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
  status(`${label}：${nf.format(parsed.data.length)}行・${parsed.headers.length}列を読み込みました。` + (missing.length ? ' 「列の設定」を確認してください。' : ''), source === 'demo' ? 'demo' : 'success');
}
async function loadRemote() {
  const gid = $('gidInput').value.trim() || '0';
  if (!/^\d{1,20}$/.test(gid)) { status('gidは数字のみで指定してください。', 'error'); return; }
  if (STATE.loading) return;
  STATE.loading = true;
  $('refreshBtn').disabled = true;
  status('Googleスプレッドシートからデータを取得しています…');
  try {
    const response = await fetch(`/api/sheet?gid=${encodeURIComponent(gid)}&refresh=1`, {cache:'no-store'});
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { detail = (await response.json()).error || detail; } catch {}
      throw new Error(detail);
    }
    const body = await response.text();
    if (body.length > MAX_CSV_SIZE * 2) throw new Error('データが大きすぎます。5MB未満のCSVを使用してください。');
    useData(body, 'sheet', 'Google Sheets');
  } catch (e) {
    status(`シートを取得できませんでした：${e.message} サンプル表示かCSV読み込みでも動作確認できます。`, 'error');
  } finally { STATE.loading = false; $('refreshBtn').disabled = false; }
}

function resetFilters() {
  $('searchInput').value = '';
  $('startDate').value = '';
  $('endDate').value = '';
  STATE.focus = null;
  STATE.page = 0;
  render();
}
function render() {
  STATE.filtered = filterRecords(STATE.records, {
    query: $('searchInput').value, start: $('startDate').value, end: $('endDate').value, focus: STATE.focus
  });
  STATE.analysis = aggregateAll(STATE.filtered);
  const a = STATE.analysis;
  text('countAll', nf.format(a.rowCount));
  text('countSongs', nf.format(a.songs.length));
  text('countArtists', nf.format(a.artists.length));
  text('countUsers', nf.format(a.users.length));
  updateFocus();
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
function renderRanking(kind) {
  const groups = STATE.analysis[kind];
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
    const middle = elt('span','rank-main');
    middle.append(elt('span','rank-name',g.label));
    const explanation = kind === 'songs' ? (g.detail || 'アーティスト未登録') : kind === 'users' ? `${nf.format(g.uniqueSongs)}曲をリクエスト` : `${nf.format(g.uniqueSongs)}曲にリクエスト`;
    middle.append(elt('span','rank-sub',explanation));
    const track = elt('span','rank-track');
    const fill = elt('span','rank-bar'); fill.style.width = Math.max(2,(g.count / max) * 100) + '%'; track.append(fill);
    const count = elt('span','rank-count'); count.append(elt('strong','',nf.format(g.count)),elt('small','','件'));
    button.append(place,middle,track,count);
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
    add('line',{x1:left, x2:width - 12, y1:y,y2:y,stroke:'#302b45','stroke-dasharray':'4 5'});
    add('text',{x:left-12,y:y+4,'text-anchor':'end',fill:'#9790af','font-size':11}, nf.format(value));
  }
  for (const [i, item] of a.months.entries()) {
    const barWidth = 38, x = left + 17 + i*per, barHeight = (item.count / upper)*plotHeight;
    const rect = add('rect',{x,y:top+plotHeight-barHeight,width:barWidth,height:barHeight,rx:5,fill:item.count ? '#9a74ff' : '#504665'});
    const tip = document.createElementNS(NS,'title'); tip.textContent = `${formatMonth(item.month)}：${item.count}件`; rect.append(tip);
    if (item.count) add('text',{x:x+barWidth/2,y:top+plotHeight-barHeight-9,'text-anchor':'middle',fill:'#e8ddff','font-size':12,'font-weight':700},String(item.count));
    add('text',{x:x+barWidth/2,y:top+plotHeight+22,'text-anchor':'middle',fill:'#b9b4c9','font-size':11},item.month.slice(5)+'月');
    add('text',{x:x+barWidth/2,y:top+plotHeight+37,'text-anchor':'middle',fill:'#77718d','font-size':10},item.month.slice(0,4));
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
    tr.append(elt('td','date-cell',r.rawDate || '—'),elt('td','song-cell',r.song || '—'),elt('td','',r.artist || '—'),elt('td','',r.user || '—'));
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
    songs: [['順位','曲名','アーティスト','リクエスト件数','ユニーク投稿者数'],...a.songs.map(g=>[g.rank,g.label,g.detail,g.count,g.uniqueUsers])],
    artists: [['順位','アーティスト','リクエスト件数','楽曲数'],...a.artists.map(g=>[g.rank,g.label,g.count,g.uniqueSongs])],
    users: [['順位','ユーザー','リクエスト件数','リクエストした楽曲数'],...a.users.map(g=>[g.rank,g.label,g.count,g.uniqueSongs])],
    months: [['月','リクエスト件数'],...a.months.map(v=>[v.month,v.count])],
    records: [['投稿日','楽曲名','アーティスト名','ユーザー名','投稿URL'],...STATE.filtered.map(r=>[r.rawDate,r.song,r.artist,r.user,r.url])]
  }[kind];
  if (!out) return;
  const blob = new Blob([csvExport(out)],{type:'text/csv;charset=utf-8'});
  const objectUrl = URL.createObjectURL(blob); const anchor = elt('a');
  anchor.href = objectUrl; anchor.download = `voca-requests-${kind}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
}

function setup() {
  const query = new URLSearchParams(location.search);
  const gid = query.get('gid');
  if (gid && /^\d{1,20}$/.test(gid)) $('gidInput').value = gid;
  $('refreshBtn').addEventListener('click',loadRemote);
  $('gidInput').addEventListener('keydown',e=>{if(e.key === 'Enter') loadRemote();});
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
  for (const id of ['searchInput','startDate','endDate']) $(id).addEventListener('input',()=>{STATE.page=0;render();});
  $('resetBtn').addEventListener('click',resetFilters);
  for (const kind of ['Songs','Artists','Users']) {
    const k = kind.toLowerCase();
    $('more'+kind).addEventListener('click',()=>{STATE.showAll[k]=!STATE.showAll[k]; renderRanking(k);});
  }
  for (const b of document.querySelectorAll('[data-export]')) b.addEventListener('click',()=>download(b.dataset.export));
  $('prevBtn').addEventListener('click',()=>{STATE.page--;renderPosts();});
  $('nextBtn').addEventListener('click',()=>{STATE.page++;renderPosts();});
  render();
  if (query.get('demo')==='1') $('demoBtn').click(); else loadRemote();
}
setup();
