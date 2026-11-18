import { csvExport } from './lib/analytics.mjs';
import { DJ_STATUSES, keyFor } from './lib/v4.mjs';

export function setupDjList() {
  const $ = id => document.getElementById(id);
  const state = { items: [], loaded: false, busy: false, configured: false, pending: null };

  function message(value) { $('djListMessage').textContent = value; }

  function controls() {
    $('djLoad').disabled = state.busy || !state.configured || Boolean(state.pending);
    $('djRetry').hidden = !state.pending;
    $('djRetry').disabled = state.busy;
    $('djAdd').disabled = !state.loaded || state.busy || Boolean(state.pending);
    $('djExport').disabled = !state.loaded || !state.items.length;
    for (const element of $('djItems').querySelectorAll('select, button')) {
      element.disabled = state.busy || Boolean(state.pending);
    }
  }

  async function api(action, operation = {}) {
    const response = await fetch('/api/dj-list', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...operation, action, password: $('djPassword').value })
    });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body.error || 'クラウドとの通信に失敗しました。');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }

  function renderList() {
    const root = $('djItems');
    root.replaceChildren();
    for (const item of state.items) {
      const row = element('div');
      row.className = 'dj-item';
      const title = element('strong', item.song + ' / ' + item.artist);
      const select = element('select');
      select.setAttribute('aria-label', item.song + 'の状態');
      for (const value of DJ_STATUSES) {
        const option = element('option', value);
        option.value = value;
        select.append(option);
      }
      select.value = item.status;
      select.addEventListener('change', () => mutate({ ...item, action: 'status', status: select.value }));
      const remove = element('button', '削除');
      remove.className = 'text-btn';
      remove.type = 'button';
      remove.setAttribute('aria-label', item.song + 'を候補から削除');
      remove.addEventListener('click', () => mutate({ ...item, action: 'delete' }));
      row.append(title, select, remove);
      root.append(row);
    }
    if (!state.items.length) root.append(element('p', '候補はまだありません。'));
    controls();
  }

  async function readList() {
    const result = await api('list');
    state.items = result.items;
    state.loaded = true;
    renderList();
  }

  async function load() {
    state.busy = true;
    controls();
    message('クラウドから読み込んでいます…');
    try {
      await readList();
      message('クラウドの最新候補を読み込みました。');
    } catch (error) {
      state.loaded = false;
      message(error.message);
    } finally {
      state.busy = false;
      controls();
    }
  }

  async function mutate(operation) {
    if (state.busy) return;
    state.pending ||= { ...operation, operationId: crypto.randomUUID() };
    state.busy = true;
    controls();
    message('クラウドに保存しています…');
    try {
      await api(state.pending.action, state.pending);
      await readList();
      if (state.pending.action === 'add') {
        $('djSong').value = '';
        $('djArtist').value = '';
      }
      state.pending = null;
      message('クラウドに保存しました。別端末では「クラウドから読み込む」で更新できます。');
    } catch (error) {
      if ([400, 403, 413, 503].includes(error.status)) state.pending = null;
      message('保存を確認できませんでした。' + error.message + (state.pending ? '「保存を再試行」を押してください。' : ''));
    } finally {
      state.busy = false;
      renderList();
    }
  }

  $('djLoad').addEventListener('click', load);
  $('djRetry').addEventListener('click', () => mutate(state.pending));
  $('djForm').addEventListener('submit', event => {
    event.preventDefault();
    const song = $('djSong').value.trim();
    const artist = $('djArtist').value.trim();
    if (!song || !artist || !state.loaded) return;
    if (state.items.some(item => keyFor(item.song, item.artist) === keyFor(song, artist))) {
      message('同じ曲名・ボカロPの候補が登録済みです。');
      return;
    }
    mutate({ song, artist, action: 'add' });
  });
  $('djExport').addEventListener('click', () => {
    const rows = [['曲名', 'ボカロP', '状態'], ...state.items.map(item => [item.song, item.artist, item.status])];
    const url = URL.createObjectURL(new Blob([csvExport(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = 'dj-setlist.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  controls();
  fetch('/api/dj-list', { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error('クラウドの接続状態を取得できませんでした。ページを再読み込みしてください。');
    const body = await response.json();
    state.configured = body.configured === true;
    message(state.configured ? '管理パスワードを入力して候補を読み込んでください。' : 'クラウド保存は管理者による接続設定が必要です。');
    controls();
  }).catch(error => message(error.message));
}
