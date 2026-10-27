import { fetchPopular } from './src/programmer.js';
import { ALL_REGION_CODES, REGION_GROUPS, regionName, toggleGroup } from './src/regions.js';
import { loadSettings, saveSettings } from './src/storage.js';

const $ = (id) => document.getElementById(id);
const names = new Map(ALL_REGION_CODES.map((c) => [c, regionName(c)]));
const checkboxes = new Map();

let settings = null;

const selectedSet = () => new Set(settings.regions);

async function apply(patch) {
  Object.assign(settings, patch);
  await saveSettings(patch);
}

async function commitRegions(selected) {
  await apply({ regions: [...selected] });
  syncBoxes();
}

function renderList() {
  const list = $('list');
  for (const group of REGION_GROUPS) {
    for (const code of group.codes) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => {
        const next = selectedSet();
        box.checked ? next.add(code) : next.delete(code);
        commitRegions(next);
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
    btn.addEventListener('click', () => commitRegions(toggleGroup(selectedSet(), group)));
    $('groups').append(btn);
  }
}

function syncBoxes() {
  const selected = selectedSet();
  for (const [code, box] of checkboxes) box.checked = selected.has(code);
  $('count').textContent = `${selected.size} / ${ALL_REGION_CODES.length} か国を選択中`;
}

function bindControls() {
  $('scheduleOn').addEventListener('change', (e) => apply({ scheduleOn: e.target.checked }));
  $('selectAll').addEventListener('click', () => commitRegions(new Set(ALL_REGION_CODES)));
  $('clearAll').addEventListener('click', () => commitRegions(new Set()));
  $('search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const li of $('list').children) li.hidden = q !== '' && !li.dataset.name.includes(q);
  });

  $('saveKey').addEventListener('click', async () => {
    const key = $('apiKey').value.trim();
    const status = $('keyStatus');
    await apply({ apiKey: key });
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
  settings = await loadSettings();
  $('apiKey').value = settings.apiKey;
  $('scheduleOn').checked = settings.scheduleOn;
  renderList();
  renderGroups();
  bindControls();
  syncBoxes();
}

// ポップアップなど、ほかの画面での変更を反映する（自分の書き込みとは内容が同じなので何もしない）
chrome.storage.onChanged.addListener(async () => {
  if (!settings) return;
  const latest = await loadSettings();
  const same = (key) => JSON.stringify(latest[key]) === JSON.stringify(settings[key]);
  if (same('regions') && same('scheduleOn')) return;
  Object.assign(settings, latest);
  $('scheduleOn').checked = settings.scheduleOn;
  syncBoxes();
});

init();
