import { ALL_REGION_CODES } from './regions.js';

// 既定は利用者のロケールの国。対応外なら US
function defaultRegions() {
  const code = navigator.language.split('-')[1]?.toUpperCase();
  return [ALL_REGION_CODES.includes(code) ? code : 'US'];
}

export async function loadSettings() {
  const s = await chrome.storage.local.get(['apiKey', 'regions']);
  return { apiKey: s.apiKey ?? '', regions: s.regions ?? defaultRegions() };
}

export function saveSettings(patch) {
  return chrome.storage.local.set(patch);
}
