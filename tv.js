import { ALL_GENRE_IDS, genreName } from './src/genres.js';
import { NoRegionError, NoVideosError, Programmer } from './src/programmer.js';
import { regionName } from './src/regions.js';
import { PLAYER_ORIGIN, PLAYER_URL } from './src/config.js';
import { currentPlan, formatMinutes } from './src/schedule.js';
import { addView, loadSettings } from './src/storage.js';

const ERROR_RETRY_MS = 1500;
const START_TIMEOUT_MS = 60000; // 動画の前の広告が終わるまでは再生状態にならない

const $ = (id) => document.getElementById(id);
const frame = $('frame');
const screen = $('screen');
const bar = $('bar');

let settings = null;
let programmer = null;
let current = null; // 再生中の動画。再生が始まった時点で 1 本として数える
let ticket = 0; // 1 本の動画につき「次へ」が二重に走らないようにする
let frameLoaded = null; // 再生ページの読み込み完了を待つ Promise
let watchdog = null; // 再生が始まらないときに知らせるタイマー

function showScreen(message, { power = true } = {}) {
  $('message').textContent = message;
  $('power').hidden = !power;
  $('slot').textContent = '';
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
  if (e instanceof NoRegionError) return 'ポップアップか設定で国を1つ以上選んでください。';
  if (e instanceof NoVideosError) return '選んだ国で再生できる動画が見つかりません。国を増やしてみてください。';
  if (e.reason === 'keyInvalid') return 'API キーが無効です。設定で入力し直してください。';
  if (e.reason === 'quotaExceeded') return 'YouTube API の 1 日の上限に達しました。明日また試してください。';
  if (e.reason === 'accessNotConfigured') return 'このキーのプロジェクトで YouTube Data API v3 が有効になっていません。';
  return `動画を取得できませんでした: ${e.message}`;
}

async function playNext() {
  const mine = ++ticket;
  try {
    // 国の選択や番組表の枠は、動画を選ぶ時点の設定で決める（再生中の動画はそのまま流れる）
    settings = await loadSettings(); // 日付が替わっていれば新しい番組表になる
    const video = await nextVideo();
    if (mine !== ticket) return;
    await ensureFrame();
    if (mine !== ticket) return;
    frame.contentWindow.postMessage({ type: 'load', id: video.id }, PLAYER_ORIGIN);
    current = { region: video.region, genre: video.genre, counted: false };
    frame.hidden = false;
    screen.hidden = true;
    bar.hidden = false;
    const info = `${genreName(video.genre)} ・ ${regionName(video.region)} ・ ${video.channel} ・ ${video.title}`;
    $('info').textContent = info;
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (mine === ticket) $('info').textContent = `再生が始まりません（広告中かもしれません）。続かなければ「次へ」を試してください ・ ${info}`;
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
    if (current && !current.counted) {
      current.counted = true;
      addView(current.region, current.genre);
    }
  } else if (ev.data?.type === 'ended') {
    playNext();
  } else if (ev.data?.type === 'error') {
    // 埋め込み不可などは見せずに次へ進める
    const mine = ticket;
    setTimeout(() => mine === ticket && playNext(), ERROR_RETRY_MS);
  }
});

// 番組表の枠に動画が無いときは、止まらないよう枠を外して全ジャンル・選んだ国から選ぶ
async function nextVideo() {
  const plan = currentPlan(settings);
  try {
    return await programmer.next(plan);
  } catch (e) {
    if (!(e instanceof NoVideosError) || !plan.slot) throw e;
    return programmer.next({ genres: ALL_GENRE_IDS, regions: settings.regions });
  }
}

function updateSlot() {
  const { slot, regions } = currentPlan(settings);
  $('slot').textContent = slot
    ? `いまの番組: ${genreName(slot.genre)} ・ ${regions.map((r) => regionName(r)).join('、')} （${formatMinutes(slot.start)}〜${formatMinutes(slot.end)}）`
    : '番組表オフ: すべてのジャンル・選んだ国から等確率で選びます';
}

function showReady() {
  showScreen('「放送開始」を押すと、ランダムな人気動画が流れ続けます。選ぶことはできません。');
  updateSlot();
}

async function start() {
  settings = await loadSettings();
  if (!settings.apiKey) {
    showScreen('はじめに、設定で YouTube Data API のキーを入力してください。', { power: false });
    return;
  }
  programmer = new Programmer({ apiKey: settings.apiKey });
  showReady();
}

$('power').addEventListener('click', () => {
  if (programmer) playNext();
});
$('skip').addEventListener('click', () => playNext());
$('settings').addEventListener('click', openSettings);
$('barSettings').addEventListener('click', openSettings);

// 設定やポップアップでの変更を反映する。国は次の動画を選ぶときに読まれる
chrome.storage.onChanged.addListener(async () => {
  const before = settings;
  settings = await loadSettings();
  if (!programmer) {
    if (settings.apiKey) {
      programmer = new Programmer({ apiKey: settings.apiKey });
      showReady();
    }
    return;
  }
  if (settings.apiKey !== before.apiKey) programmer.setApiKey(settings.apiKey);
  if (!screen.hidden) updateSlot();
});

start();
