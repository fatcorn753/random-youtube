import { fetchPopular } from './src/programmer.js';
import { ALL_REGION_CODES, REGION_GROUPS, regionName } from './src/regions.js';
import { loadSettings, saveSettings } from './src/storage.js';

const $ = (id) => document.getElementById(id);
const names = new Map(ALL_REGION_CODES.map((c) => [c, regionName(c)]));
const selected = new Set();
const checkboxes = new Map();

function renderList() {
  const list = $('list');
  for (const group of REGION_GROUPS) {
    for (const code of group.codes) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => {
        box.checked ? selected.add(code) : selected.delete(code);
        persist();
      });
      label.append(box, ` ${names.get(code)}`);
      li.append(label);
      li.dataset.name = `${names.get(code)} ${code}`.toLowerCase();
      list.append(li);
      checkboxes.set(code, box);
    }
  }
}

function renderGroups() {
  for (const group of REGION_GROUPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost';
    btn.textContent = group.name;
    // 全部入っていれば外し、そうでなければ足す（トグル）
    btn.addEventListener('click', () => {
      const allOn = group.codes.every((c) => selected.has(c));
      for (const c of group.codes) allOn ? selected.delete(c) : selected.add(c);
      syncBoxes();
      persist();
    });
    $('groups').append(btn);
  }
}

function syncBoxes() {
  for (const [code, box] of checkboxes) box.checked = selected.has(code);
  $('count').textContent = `${selected.size} / ${ALL_REGION_CODES.length} か国を選択中`;
}

function persist() {
  syncBoxes();
  saveSettings({ regions: [...selected] });
}

function bindBulk() {
  $('selectAll').addEventListener('click', () => {
    ALL_REGION_CODES.forEach((c) => selected.add(c));
    persist();
  });
  $('clearAll').addEventListener('click', () => {
    selected.clear();
    persist();
  });
  $('search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const li of $('list').children) li.hidden = q !== '' && !li.dataset.name.includes(q);
  });
}

function bindKey() {
  $('saveKey').addEventListener('click', async () => {
    const key = $('apiKey').value.trim();
    const status = $('keyStatus');
    await saveSettings({ apiKey: key });
    if (!key) {
      status.textContent = 'キーを削除しました。';
      return;
    }
    status.textContent = '確認中…';
    try {
      await fetchPopular('JP', key);
      status.textContent = '保存しました。このキーは使えます。';
    } catch (e) {
      status.textContent = `保存しましたが、このキーでは取得できませんでした: ${e.message}`;
    }
  });
}

async function init() {
  const settings = await loadSettings();
  settings.regions.filter((c) => names.has(c)).forEach((c) => selected.add(c));
  $('apiKey').value = settings.apiKey;
  renderList();
  renderGroups();
  bindBulk();
  bindKey();
  syncBoxes();
}

init();
