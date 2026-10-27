import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_GENRE_IDS } from '../src/genres.js';
import { ALL_REGION_CODES } from '../src/regions.js';
import { mulberry32, shuffle } from '../src/rng.js';
import {
  COUNTRIES_PER_SLOT, MAX_SLOTS, MIN_SLOTS, MIN_SLOT_MINUTES, buildDay, currentPlan, dayTable,
  formatMinutes, newDayCard, slotAt, slotRegions,
} from '../src/schedule.js';
import { KEEP_DAYS, dateKey, recordView, summarize } from '../src/stats.js';

const at = (h, m = 0) => new Date(2026, 9, 27, h, m);
const POOL = ['JP', 'US', 'BR', 'IN', 'DE', 'KR', 'ZA'];

test('shuffle は元を変えず全要素を保つ', () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, mulberry32(1));
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
});

test('buildDay: 同じ種からは同じ番組表、枠は 24 時間を隙間なく埋める', () => {
  for (let seed = 0; seed < 300; seed++) {
    const day = buildDay(seed);
    assert.deepEqual(day, buildDay(seed));
    assert.ok(day.length >= MIN_SLOTS && day.length <= MAX_SLOTS);
    assert.equal(day[0].start, 0);
    assert.equal(day[day.length - 1].end, 24 * 60);
    day.forEach((slot, i) => {
      assert.ok(slot.end - slot.start >= MIN_SLOT_MINUTES, `seed ${seed} slot ${i}`);
      if (i > 0) assert.equal(slot.start, day[i - 1].end);
    });
  }
});

test('buildDay: 同じ日にジャンルは重ならず、種が違えば時間帯も変わる', () => {
  const sigs = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const day = buildDay(seed);
    assert.equal(new Set(day.map((s) => s.genre)).size, day.length);
    day.forEach((s) => assert.ok(ALL_GENRE_IDS.includes(s.genre)));
    sigs.add(day.map((s) => s.start).join());
  }
  assert.ok(sigs.size > 190, `時間帯の組み合わせが ${sigs.size}/200 しかない`);
});

test('buildDay: ジャンルは長い目で見て偏らない', () => {
  const counts = Object.fromEntries(ALL_GENRE_IDS.map((g) => [g, 0]));
  let total = 0;
  for (let seed = 1; seed <= 3000; seed++) for (const s of buildDay(seed)) { counts[s.genre]++; total++; }
  const expected = total / ALL_GENRE_IDS.length;
  for (const g of ALL_GENRE_IDS) assert.ok(Math.abs(counts[g] - expected) < expected * 0.1, `${g}: ${counts[g]} / ${expected}`);
});

test('buildDay: 枠の切れ目は 1〜22 時台のどこにも偏らない', () => {
  // 最短 60 分の制約があるので、0 時台と 23 時台には切れ目が入らない（それ以外は一様）
  const hours = new Array(24).fill(0);
  for (let seed = 1; seed <= 4000; seed++) {
    for (const s of buildDay(seed).slice(1)) hours[Math.floor(s.start / 60)]++;
  }
  assert.equal(hours[0], 0);
  const middle = hours.slice(1, 23);
  const mean = middle.reduce((a, b) => a + b, 0) / middle.length;
  for (const h of middle) assert.ok(Math.abs(h - mean) < mean * 0.15, hours.join());
});

test('slotRegions: 1 日のうちにどの国もほぼ同じ回数配られ、枠内で重ならない', () => {
  const seed = 42;
  const counts = Object.fromEntries(POOL.map((r) => [r, 0]));
  const slots = 7;
  for (let i = 0; i < slots; i++) {
    const regions = slotRegions(seed, i, POOL);
    assert.equal(regions.length, COUNTRIES_PER_SLOT);
    assert.equal(new Set(regions).size, regions.length);
    regions.forEach((r) => counts[r]++);
  }
  const values = Object.values(counts);
  assert.ok(Math.max(...values) - Math.min(...values) <= 1, JSON.stringify(counts)); // 山から順に配るので差は 1 以内
});

test('slotRegions: 選んだ国が少なければ全部、変えると並びも変わる、空なら空', () => {
  assert.deepEqual(slotRegions(1, 0, ['JP']), ['JP']);
  assert.deepEqual([...slotRegions(1, 0, ['JP', 'US'])].sort(), ['JP', 'US']);
  assert.deepEqual(slotRegions(1, 0, []), []);
  // 入力の並び順に依存しない（ポップアップと視聴画面で同じ結果になる）
  assert.deepEqual(slotRegions(9, 2, POOL), slotRegions(9, 2, [...POOL].reverse()));
  const changed = slotRegions(9, 2, ['FR', 'IT', 'ES']);
  changed.forEach((r) => assert.ok(['FR', 'IT', 'ES'].includes(r)));
});

test('slotRegions: 全 111 か国を選んでいても、毎日偏らず国が当たる', () => {
  const counts = new Map();
  for (let seed = 1; seed <= 1500; seed++) {
    for (const s of buildDay(seed)) for (const r of slotRegions(seed, s.index, ALL_REGION_CODES)) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const values = [...counts.values()];
  const mean = values.reduce((a, b) => a + b, 0) / ALL_REGION_CODES.length;
  assert.equal(counts.size, ALL_REGION_CODES.length);
  for (const v of values) assert.ok(Math.abs(v - mean) < mean * 0.25, `${v} / ${mean}`);
});

test('slotAt: 境界は開始時刻ちょうどから切り替わる', () => {
  const slots = [
    { index: 0, start: 0, end: 300, genre: '10' },
    { index: 1, start: 300, end: 1440, genre: '20' },
  ];
  assert.equal(slotAt(slots, at(0, 0)).index, 0);
  assert.equal(slotAt(slots, at(4, 59)).index, 0);
  assert.equal(slotAt(slots, at(5, 0)).index, 1);
  assert.equal(slotAt(slots, at(23, 59)).index, 1);
});

test('currentPlan: 番組表オンなら枠のジャンルと国、オフなら全ジャンル・全選択国', () => {
  const settings = { regions: POOL, scheduleOn: true, day: { date: dateKey(at(12)), seed: 5 } };
  const plan = currentPlan(settings, at(12));
  assert.equal(plan.genres.length, 1);
  assert.ok(plan.regions.every((r) => POOL.includes(r)));
  assert.equal(plan.slot.genre, plan.genres[0]);

  const off = currentPlan({ ...settings, scheduleOn: false }, at(12));
  assert.equal(off.slot, null);
  assert.deepEqual(off.genres, ALL_GENRE_IDS);
  assert.deepEqual(off.regions, POOL);
});

test('currentPlan: 選んだ国を変えると、同じ枠でもすぐ新しい国から選ぶ', () => {
  const base = { scheduleOn: true, day: { date: dateKey(at(12)), seed: 5 } };
  const plan = currentPlan({ ...base, regions: ['FR', 'IT', 'ES', 'PL'] }, at(12));
  plan.regions.forEach((r) => assert.ok(['FR', 'IT', 'ES', 'PL'].includes(r)));
});

test('dayTable は枠ごとの国を含む。day が無ければ空', () => {
  const settings = { regions: POOL, scheduleOn: true, day: { date: '2026-10-27', seed: 11 } };
  const table = dayTable(settings);
  assert.equal(table.length, buildDay(11).length);
  assert.ok(table.every((t) => t.regions.length === COUNTRIES_PER_SLOT));
  assert.deepEqual(dayTable({ ...settings, day: null }), []);
});

test('newDayCard は日付と種を持ち、formatMinutes は HH:MM', () => {
  const card = newDayCard(at(8), mulberry32(1));
  assert.equal(card.date, '2026-10-27');
  assert.equal(typeof card.seed, 'number');
  assert.equal(formatMinutes(0), '00:00');
  assert.equal(formatMinutes(1440), '00:00');
  assert.equal(formatMinutes(605), '10:05');
});

test('recordView は日・国・ジャンルごとに数える', () => {
  let stats = {};
  stats = recordView(stats, 'JP', '10', at(9));
  stats = recordView(stats, 'JP', '20', at(10));
  stats = recordView(stats, 'US', '10', at(11));
  const today = summarize(stats, at(12));
  assert.equal(today.total, 3);
  assert.deepEqual(today.regions, [{ key: 'JP', count: 2 }, { key: 'US', count: 1 }]);
  assert.deepEqual(today.genres, [{ key: '10', count: 2 }, { key: '20', count: 1 }]);
  assert.equal(summarize(stats, new Date(2026, 9, 28, 1)).total, 0);
});

test('同数は国コード順、古い日付は KEEP_DAYS 日分だけ残り、元の stats は不変', () => {
  let stats = recordView({}, 'US', '10', at(9));
  stats = recordView(stats, 'BR', '10', at(9));
  assert.deepEqual(summarize(stats, at(9)).regions.map((r) => r.key), ['BR', 'US']);

  let many = {};
  for (let d = 1; d <= KEEP_DAYS + 5; d++) many = recordView(many, 'JP', '10', new Date(2026, 0, d, 12));
  const keys = Object.keys(many).sort();
  assert.equal(keys.length, KEEP_DAYS);
  assert.equal(keys[0], dateKey(new Date(2026, 0, 6)));

  const snap = JSON.stringify(stats);
  recordView(stats, 'JP', '20', at(10));
  assert.equal(JSON.stringify(stats), snap);
});
