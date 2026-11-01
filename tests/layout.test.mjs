import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url),'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url),'utf8');

test('data source, result status, mapping and aliases are below post list', () => {
  const posts = html.indexOf('id="posts"');
  const settings = html.indexOf('id="settings"');
  assert.ok(posts > 0 && settings > posts);
  for (const id of ['gidInput','refreshBtn','status','mappingDetails','aliasesDetails']) {
    const pos = html.indexOf(`id="${id}"`);
    assert.ok(pos > settings, `${id} should be in bottom settings`);
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} should not duplicate`);
  }
  assert.match(html, /href="#settings"/);
});

test('user-facing ranking control uses regular DJ wording', () => {
  assert.match(html,/レギュラーDJ4名を表示する/);
  assert.match(html,/レギュラーDJ4名を除外/);
  assert.doesNotMatch(html,/運営/);
  assert.match(app,/レギュラーDJ4名を非表示にする/);
  assert.doesNotMatch(app,/運営/);
});
