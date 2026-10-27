import { Programmer, NoRegionError } from './src/programmer.js';
import { regionName } from './src/regions.js';
import { PLAYER_ORIGIN, PLAYER_URL } from './src/config.js';
import { loadSettings } from './src/storage.js';

const ERROR_RETRY_MS = 1500;
const START_TIMEOUT_MS = 15000;

const $ = (id) => document.getElementById(id);
const frame = $('frame');
const screen = $('screen');
const bar = $('bar');

let programmer = null;
let ticket = 0; // 1 本の動画につき「次へ」が二重に走らないようにする
let frameLoaded = null; // 再生ページの読み込み完了を待つ Promise
let watchdog = null; // 再生が始まらないときに知らせるタイマー

function showScreen(message, { power = true } = {}) {
  $('message').textContent = message;
  $('power').hidden = !power;
  screen.hidden = false;
  bar.hidden = true;
  frame.hidden = true;
  frame.removeAttribute('src');
  frameLoaded = null;
}

function ensureFrame() {
  if (!frameLoaded) {
    frameLoaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    frame.src = PLAYER_URL;
  }
  return frameLoaded;
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

function describeError(e) {
  if (e instanceof NoRegionError) return '設定で国を1つ以上選んでください。';
  if (e.reason === 'keyInvalid') return 'API キーが無効です。設定で入力し直してください。';
  if (e.reason === 'quotaExceeded') return 'YouTube API の 1 日の上限に達しました。明日また試してください。';
  if (e.reason === 'accessNotConfigured') return 'このキーのプロジェクトで YouTube Data API v3 が有効になっていません。';
  return `動画を取得できませんでした: ${e.message}`;
}

async function playNext() {
  const mine = ++ticket;
  try {
    const video = await programmer.next();
    if (mine !== ticket) return;
    await ensureFrame();
    if (mine !== ticket) return;
    frame.contentWindow.postMessage({ type: 'load', id: video.id }, PLAYER_ORIGIN);
    frame.hidden = false;
    screen.hidden = true;
    bar.hidden = false;
    const info = `${regionName(video.region)} ・ ${video.channel} ・ ${video.title}`;
    $('info').textContent = info;
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (mine === ticket) $('info').textContent = `再生が始まりません。「次へ」を試してください ・ ${info}`;
    }, START_TIMEOUT_MS);
  } catch (e) {
    if (mine !== ticket) return;
    showScreen(describeError(e));
    $('power').textContent = '再試行';
  }
}

window.addEventListener('message', (ev) => {
  if (ev.origin !== PLAYER_ORIGIN || ev.source !== frame.contentWindow) return;
  if (ev.data?.type === 'playing') {
    clearTimeout(watchdog);
  } else if (ev.data?.type === 'ended') {
    playNext();
  } else if (ev.data?.type === 'error') {
    // 埋め込み不可などは見せずに次へ進める
    const mine = ticket;
    setTimeout(() => mine === ticket && playNext(), ERROR_RETRY_MS);
  }
});

async function start() {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    showScreen('はじめに、設定で YouTube Data API のキーを入力してください。', { power: false });
    return;
  }
  programmer = new Programmer({ apiKey: settings.apiKey, regions: settings.regions });
  showScreen('「放送開始」を押すと、ランダムな人気動画が流れ続けます。選ぶことはできません。');
}

$('power').addEventListener('click', () => {
  if (programmer) playNext();
});
$('skip').addEventListener('click', () => playNext());
$('settings').addEventListener('click', openSettings);
$('barSettings').addEventListener('click', openSettings);

chrome.storage.onChanged.addListener((changes) => {
  if (!programmer) return;
  if (changes.regions) programmer.setRegions(changes.regions.newValue ?? []);
  if (changes.apiKey) programmer.setApiKey(changes.apiKey.newValue ?? '');
});

start();
