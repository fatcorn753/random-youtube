import { genreName } from './src/genres.js';
import { ALL_REGION_CODES, REGION_GROUPS, regionName, toggleGroup } from './src/regions.js';
import { currentPlan, dayTable, formatMinutes } from './src/schedule.js';
import { loadSettings, saveSettings } from './src/storage.js';
import { summarize } from './src/stats.js';

const TOP_N = 5;

const $ = (id) => document.getElementById(id);
let settings = null;

function renderTable() {
  $('tableSection').hidden = !settings.scheduleOn;
  const nowIndex = currentPlan(settings).slot?.index;
  $('table').replaceChildren(
    ...dayTable(settings).map((slot) => {
      const li = document.createElement('li');
      li.classList.toggle('now', slot.index === nowIndex);
      for (const [cls, text] of [
        ['time', `${formatMinutes(slot.start)}〜${formatMinutes(slot.end)}`],
        ['genre', genreName(slot.genre)],
        ['where', slot.regions.map((r) => regionName(r)).join('、')],
      ]) {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        li.append(span);
      }
      return li;
    }),
  );
}

// 上位 TOP_N 件と「ほか」をバーで表示する
function renderDist(listId, ranking, label) {
  const rows = ranking.slice(0, TOP_N).map((r) => ({ name: label(r.key), count: r.count }));
  const rest = ranking.slice(TOP_N);
  if (rest.length > 0) rows.push({ name: `ほか ${rest.length} 件`, count: rest.reduce((n, r) => n + r.count, 0) });

  const max = Math.max(1, ...rows.map((r) => r.count));
  $(listId).replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="name"></span><span class="track"><span class="fill"></span></span><span class="n"></span>';
      li.querySelector('.name').textContent = r.name;
      li.querySelector('.fill').style.width = `${(r.count / max) * 100}%`;
      li.querySelector('.n').textContent = r.count;
      return li;
    }),
  );
}

function renderStats() {
  const { total, regions, genres } = summarize(settings.stats);
  $('total').textContent = `${total} 本`;
  $('distEmpty').hidden = total > 0;
  $('distBody').hidden = total === 0;
  renderDist('genreDist', genres, genreName);
  renderDist('regionDist', regions, (code) => regionName(code));
}

function renderSelection() {
  const selected = new Set(settings.regions);
  $('count').textContent = `${selected.size} / ${ALL_REGION_CODES.length} か国`;
  $('groups').replaceChildren(
    ...REGION_GROUPS.map((group) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = group.name;
      btn.setAttribute('aria-pressed', String(group.codes.every((c) => selected.has(c))));
      btn.addEventListener('click', () => commit(toggleGroup(selected, group)));
      return btn;
    }),
  );
}

async function commit(selected) {
  settings.regions = [...selected];
  render();
  await saveSettings({ regions: settings.regions });
}

function render() {
  renderTable();
  renderStats();
  renderSelection();
}

// 視聴タブが開いていればそれを前面に出し、なければ開く
async function openWatch() {
  const url = chrome.runtime.getURL('tv.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}

$('watch').addEventListener('click', openWatch);
$('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
$('selectAll').addEventListener('click', () => commit(new Set(ALL_REGION_CODES)));
$('clearAll').addEventListener('click', () => commit(new Set()));

// 視聴中に開いたままでも本数が増えていく
chrome.storage.onChanged.addListener(async () => {
  settings = await loadSettings();
  render();
});

loadSettings().then((s) => {
  settings = s;
  render();
});
