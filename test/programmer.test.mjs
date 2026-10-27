import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_REGION_CODES } from '../src/regions.js';
import { ApiError, MIN_SECONDS, Programmer, fetchPopular, parseDuration } from '../src/programmer.js';

const item = (id, over = {}) => ({
  id,
  snippet: { title: `t-${id}`, channelTitle: 'ch', liveBroadcastContent: 'none' },
  status: { embeddable: true, privacyStatus: 'public' },
  contentDetails: { duration: 'PT5M' },
  ...over,
});

// region ごとに id 接頭辞を変えた fetch のモック
function mockFetch(byRegion) {
  const calls = [];
  const fn = async (url) => {
    const region = new URL(url).searchParams.get('regionCode');
    calls.push(region);
    const r = byRegion[region];
    if (r instanceof Error) throw r;
    if (r?.error) return { ok: false, status: r.status, json: async () => ({ error: r.error }) };
    return { ok: true, status: 200, json: async () => ({ items: r ?? [] }) };
  };
  fn.calls = calls;
  return fn;
}

test('parseDuration は ISO 8601 を秒に直す', () => {
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('PT59S'), 59);
  assert.equal(parseDuration('P1DT1S'), 86401);
  assert.equal(parseDuration('P0D'), 0);
  assert.equal(parseDuration(undefined), 0);
});

test('fetchPopular は埋め込み不可・ライブ・短尺・非公開を除く', async () => {
  const fetchFn = mockFetch({
    JP: [
      item('ok'),
      item('noembed', { status: { embeddable: false, privacyStatus: 'public' } }),
      item('live', { snippet: { title: 't', channelTitle: 'c', liveBroadcastContent: 'live' } }),
      item('short', { contentDetails: { duration: `PT${MIN_SECONDS - 1}S` } }),
      item('private', { status: { embeddable: true, privacyStatus: 'private' } }),
    ],
  });
  const got = await fetchPopular('JP', 'k', fetchFn);
  assert.deepEqual(got.map((v) => v.id), ['ok']);
});

test('fetchPopular は API エラーを ApiError にする', async () => {
  const fetchFn = mockFetch({ JP: { status: 400, error: { message: 'bad', errors: [{ reason: 'keyInvalid' }] } } });
  await assert.rejects(fetchPopular('JP', 'k', fetchFn), (e) => e instanceof ApiError && e.fatal && e.reason === 'keyInvalid');
});

test('next は見たことのない動画だけを返し、尽きたら履歴を消して続ける', async () => {
  const fetchFn = mockFetch({ JP: [item('a'), item('b')] });
  const p = new Programmer({ apiKey: 'k', regions: ['JP'], fetchFn });
  const ids = [(await p.next()).id, (await p.next()).id];
  assert.deepEqual([...ids].sort(), ['a', 'b']);
  const third = await p.next(); // 履歴クリア後
  assert.ok(['a', 'b'].includes(third.id));
});

test('国は等確率で選ばれる（動画数が違っても偏らない）', async () => {
  const many = Array.from({ length: 50 }, (_, i) => item(`us${i}`));
  const fetchFn = mockFetch({ JP: [item('jp1'), item('jp2')], US: many });
  const p = new Programmer({ apiKey: 'k', regions: ['JP', 'US'], fetchFn });
  const counts = { JP: 0, US: 0 };
  for (let i = 0; i < 40; i++) counts[(await p.next()).region]++;
  // JP は 2 本しかないので履歴クリアを挟むが、国の選択確率は変わらない
  assert.ok(counts.JP >= 10 && counts.US >= 10, JSON.stringify(counts));
});

test('一部の国が失敗しても他の国で続ける。致命的エラーは即座に投げる', async () => {
  const fetchFn = mockFetch({ JP: new Error('network'), US: [item('u')] });
  const p = new Programmer({ apiKey: 'k', regions: ['JP', 'US'], fetchFn });
  assert.equal((await p.next()).id, 'u');

  const fatal = mockFetch({ JP: { status: 403, error: { message: 'q', errors: [{ reason: 'quotaExceeded' }] } } });
  const p2 = new Programmer({ apiKey: 'k', regions: ['JP'], fetchFn: fatal });
  await assert.rejects(p2.next(), (e) => e.reason === 'quotaExceeded');
});

test('国が空なら NoRegionError', async () => {
  const p = new Programmer({ apiKey: 'k', regions: [], fetchFn: mockFetch({}) });
  await assert.rejects(p.next(), { name: 'NoRegionError' });
});

test('取得結果は TTL 内ならキャッシュされる', async () => {
  const fetchFn = mockFetch({ JP: Array.from({ length: 5 }, (_, i) => item(`v${i}`)) });
  let t = 0;
  const p = new Programmer({ apiKey: 'k', regions: ['JP'], fetchFn, now: () => t });
  await p.next();
  await p.next();
  assert.equal(fetchFn.calls.length, 1);
  t = 2 * 60 * 60 * 1000;
  await p.next();
  assert.equal(fetchFn.calls.length, 2);
});

test('REGION_GROUPS は重複なく 111 か国', () => {
  assert.equal(ALL_REGION_CODES.length, 111);
  assert.equal(new Set(ALL_REGION_CODES).size, 111);
});
