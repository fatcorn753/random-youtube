import { ALL_REGION_CODES } from './regions.js';
import { newDayCard } from './schedule.js';
import { dateKey, recordView } from './stats.js';

// 既定は利用者のロケールの国。対応外なら US
function defaultRegions() {
  const code = navigator.language.split('-')[1]?.toUpperCase();
  return [ALL_REGION_CODES.includes(code) ? code : 'US'];
}

// 保存済みの今日の番組表の種を返す。日付が替わっていれば新しく作って保存する
async function ensureDay(saved, date) {
  if (saved?.date === dateKey(date)) return saved;
  const day = newDayCard(date);
  await chrome.storage.local.set({ day });
  return day;
}

export async function loadSettings(date = new Date()) {
  const s = await chrome.storage.local.get(['apiKey', 'regions', 'scheduleOn', 'day', 'stats']);
  return {
    apiKey: s.apiKey ?? '',
    regions: s.regions ?? defaultRegions(),
    scheduleOn: s.scheduleOn ?? true,
    day: await ensureDay(s.day, date),
    stats: s.stats ?? {},
  };
}

export function saveSettings(patch) {
  return chrome.storage.local.set(patch);
}

// 1 本見るたびに今日の統計へ加える
export async function addView(region, genre) {
  const { stats = {} } = await chrome.storage.local.get('stats');
  await chrome.storage.local.set({ stats: recordView(stats, region, genre) });
}
