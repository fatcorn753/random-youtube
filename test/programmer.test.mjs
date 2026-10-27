import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_GENRE_IDS } from '../src/genres.js';
import { ALL_REGION_CODES } from '../src/regions.js';
import { mulberry32 } from '../src/rng.js';
import {
  ApiError, MIN_POOL, MIN_SECONDS, NoRegionError, NoVideosError, Programmer, fetchPopular, parseDuration,
} from '../src/programmer.js';

const item = (id, over = {}) => ({
  id,
  snippet: { title: `t-${id}`, channelTitle: 'ch', liveBroadcastContent: 'none' },
  status: { embeddable: true, privacyStatus: 'public' },
  contentDetails: { duration: 'PT5M' },
  ...over,
});
const many = (prefix, n) => Array.from({ length: n }, (_, i) => item(`${prefix}${i}`));

// `${region}:${genre}` ごとに返す中身を決める fetch のモック。値が Error なら失敗、{error} なら API エラー
function mockFetch(byKey, fallback = []) {
  const calls = [];
  const fn = async (url) => {
    const q = new URL(url).searchParams;
    const key = `${q.get('regionCode')}:${q.get('videoCategoryId')}`;
    calls.push(key);
    const r = byKey[key] ?? fallback;
    if (r instanceof Error) throw r;
    if (r?.error) return { ok: false, status: r.status, json: async () => ({ error: r.error }) };
    return { ok: true, status: 200, json: async () => ({ items: r }) };
  };
  fn.calls = calls;
  return fn;
}

const plan = (genres, regions) => ({ genres, regions });

test('parseDuration は ISO 8601 を秒に直す', () => {
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('PT59S'), 59);
  assert.equal(parseDuration('P1DT1S'), 86401);
  assert.equal(parseDuration('P0D'), 0);
  assert.equal(parseDuration(undefined), 0);
});

test('fetchPopular は埋め込み不可・ライブ・短尺・非公開を除き、ジャンルを指定して取得する', async () => {
  const fetchFn = mockFetch({
    'JP:10': [
      item('ok'),
      item('noembed', { status: { embeddable: false, privacyStatus: 'public' } }),
      item('live', { snippet: { title: 't', channelTitle: 'c', liveBroadcastContent: 'live' } }),
      item('short', { contentDetails: { duration: `PT${MIN_SECONDS - 1}S` } }),
      item('private', { status: { embeddable: true, privacyStatus: 'private' } }),
    ],
  });
  const got = await fetchPopular('JP', 'k', '10', fetchFn);
  assert.deepEqual(got.map((v) => v.id), ['ok']);
  assert.equal(got[0].genre, '10');
  assert.deepEqual(fetchFn.calls, ['JP:10']);
});

test('fetchPopular は API エラーを ApiError にし、チャートが無いジャンルは空とみなす', async () => {
  const bad = mockFetch({ 'JP:10': { status: 400, error: { message: 'bad', errors: [{ reason: 'keyInvalid' }] } } });
  await assert.rejects(fetchPopular('JP', 'k', '10', bad), (e) => e instanceof ApiError && e.fatal && e.reason === 'keyInvalid');

  const none = mockFetch({ 'JP:19': { status: 404, error: { message: 'x', errors: [{ reason: 'videoChartNotFound' }] } } });
  assert.deepEqual(await fetchPopular('JP', 'k', '19', none), []);
});

test('next は見たことのない動画だけを返し、尽きたらその一覧の履歴だけ戻す', async () => {
  const fetchFn = mockFetch({ 'JP:10': many('a', MIN_POOL) });
  const p = new Programmer({ apiKey: 'k', fetchFn });
  const ids = [];
  for (let i = 0; i < MIN_POOL; i++) ids.push((await p.next(plan(['10'], ['JP']))).id);
  assert.equal(new Set(ids).size, MIN_POOL); // 一巡するまで重複しない
  const again = await p.next(plan(['10'], ['JP'])); // 一巡後
  assert.notEqual(again.id, ids[ids.length - 1]); // 直前と同じ動画は続けない
});

test('ジャンルは等確率で選ばれる（動画数が極端に違っても偏らない）', async () => {
  // 音楽・ゲームだけ大量、ほかは最小限。カテゴリ指定なしの人気一覧に近い偏りを再現する
  const byKey = {};
  for (const g of ALL_GENRE_IDS) byKey[`JP:${g}`] = many(`g${g}-`, g === '10' || g === '20' ? 50 : MIN_POOL);
  const p = new Programmer({ apiKey: 'k', fetchFn: mockFetch(byKey), rng: mulberry32(7) });
  const counts = {};
  const N = 1200;
  for (let i = 0; i < N; i++) {
    const v = await p.next(plan(ALL_GENRE_IDS, ['JP']));
    counts[v.genre] = (counts[v.genre] ?? 0) + 1;
  }
  const expected = N / ALL_GENRE_IDS.length;
  for (const g of ALL_GENRE_IDS) {
    assert.ok(Math.abs(counts[g] - expected) < expected * 0.3, `${g}: ${counts[g]} (期待 ${expected})`);
  }
});

test('国は等確率で選ばれる（動画数が違っても偏らない）', async () => {
  const fetchFn = mockFetch({ 'JP:10': many('jp', MIN_POOL), 'US:10': many('us', 50) });
  const p = new Programmer({ apiKey: 'k', fetchFn, rng: mulberry32(3) });
  const counts = { JP: 0, US: 0 };
  for (let i = 0; i < 400; i++) counts[(await p.next(plan(['10'], ['JP', 'US']))).region]++;
  assert.ok(counts.JP > 140 && counts.US > 140, JSON.stringify(counts));
});

test('一覧が少なすぎる国・ジャンルは使わず、ほかの国で続ける', async () => {
  const fetchFn = mockFetch({ 'JP:22': many('thin', MIN_POOL - 1), 'US:22': many('us', 30) });
  const p = new Programmer({ apiKey: 'k', fetchFn });
  for (let i = 0; i < 20; i++) assert.equal((await p.next(plan(['22'], ['JP', 'US']))).region, 'US');
});

test('あるジャンルがどの国にも無ければ、ほかのジャンルから選ぶ', async () => {
  const p = new Programmer({ apiKey: 'k', fetchFn: mockFetch({ 'JP:10': many('m', 30) }) });
  for (let i = 0; i < 20; i++) assert.equal((await p.next(plan(['22', '10'], ['JP']))).genre, '10');
});

test('どのジャンルにも動画が無ければ NoVideosError', async () => {
  const p = new Programmer({ apiKey: 'k', fetchFn: mockFetch({}) });
  await assert.rejects(p.next(plan(['10'], ['JP'])), (e) => e instanceof NoVideosError);
});

test('一部の国が失敗しても他の国で続ける。致命的エラーは即座に投げる', async () => {
  const fetchFn = mockFetch({ 'JP:10': new Error('network'), 'US:10': many('u', 20) });
  const p = new Programmer({ apiKey: 'k', fetchFn });
  assert.equal((await p.next(plan(['10'], ['JP', 'US']))).region, 'US');

  const fatal = mockFetch({ 'JP:10': { status: 403, error: { message: 'q', errors: [{ reason: 'quotaExceeded' }] } } });
  const p2 = new Programmer({ apiKey: 'k', fetchFn: fatal });
  await assert.rejects(p2.next(plan(['10'], ['JP'])), (e) => e.reason === 'quotaExceeded');
});

test('国が空なら NoRegionError', async () => {
  const p = new Programmer({ apiKey: 'k', fetchFn: mockFetch({}) });
  await assert.rejects(p.next(plan(['10'], [])), (e) => e instanceof NoRegionError);
});

test('取得結果は TTL 内ならキャッシュされる', async () => {
  const fetchFn = mockFetch({ 'JP:10': many('v', 20) });
  let t = 0;
  const p = new Programmer({ apiKey: 'k', fetchFn, now: () => t });
  await p.next(plan(['10'], ['JP']));
  await p.next(plan(['10'], ['JP']));
  assert.equal(fetchFn.calls.length, 1);
  t = 2 * 60 * 60 * 1000;
  await p.next(plan(['10'], ['JP']));
  assert.equal(fetchFn.calls.length, 2);
});

test('REGION_GROUPS は重複なく 111 か国', () => {
  assert.equal(ALL_REGION_CODES.length, 111);
  assert.equal(new Set(ALL_REGION_CODES).size, 111);
});
