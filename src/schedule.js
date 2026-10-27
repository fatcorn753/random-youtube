// 番組表。1 日の「種」だけを保存し、枠の時間帯・ジャンル・国はすべてそこから決まる。
// 日付が替わると新しい種が作られ、時間帯も毎日ランダムに変わる
import { ALL_GENRE_IDS } from './genres.js';
import { mulberry32, randomSeed, shuffle } from './rng.js';
import { dateKey } from './stats.js';

export const MIN_SLOTS = 4;
export const MAX_SLOTS = 8;
export const MIN_SLOT_MINUTES = 60;
export const COUNTRIES_PER_SLOT = 3;
const DAY_MINUTES = 24 * 60;

export function newDayCard(date = new Date(), rng = Math.random) {
  return { date: dateKey(date), seed: randomSeed(rng) };
}

// 種から 1 日の枠（時間帯とジャンル）を作る。
// 長さは「最短 60 分 + ランダムな余り」で、余りは一様に切り分けるので特定の時間帯に偏らない。
// ジャンルは並べ替えた全ジャンルから順に割り当てるので、同じ日に同じジャンルは重ならない
export function buildDay(seed) {
  const rng = mulberry32(seed);
  const count = MIN_SLOTS + Math.floor(rng() * (MAX_SLOTS - MIN_SLOTS + 1));
  const free = DAY_MINUTES - count * MIN_SLOT_MINUTES;
  const cuts = Array.from({ length: count - 1 }, () => Math.floor(rng() * (free + 1))).sort((a, b) => a - b);
  const genres = shuffle(ALL_GENRE_IDS, rng);

  let start = 0;
  return Array.from({ length: count }, (_, i) => {
    const end = i === count - 1 ? DAY_MINUTES : start + MIN_SLOT_MINUTES + (cuts[i] - (cuts[i - 1] ?? 0));
    const slot = { index: i, start, end, genre: genres[i] };
    start = end;
    return slot;
  });
}

// 枠ごとの国。選んだ国を種で並べ替えた 1 つの山から順に配るので、1 日のうちに
// どの国もほぼ同じ回数だけ当たる。選んだ国が変われば並びも変わり、すぐ反映される
export function slotRegions(seed, index, pool, perSlot = COUNTRIES_PER_SLOT) {
  if (pool.length === 0) return [];
  const deck = shuffle([...pool].sort(), mulberry32(seed ^ 0x9e3779b9));
  const k = Math.min(perSlot, deck.length);
  return Array.from({ length: k }, (_, j) => deck[(index * k + j) % deck.length]);
}

export function slotAt(slots, date = new Date()) {
  const now = date.getHours() * 60 + date.getMinutes();
  return slots.find((s) => s.start <= now && now < s.end) ?? slots[slots.length - 1];
}

// いま流す条件。番組表が無効なら、全ジャンル・選んだ国すべて
export function currentPlan(settings, date = new Date()) {
  const pool = settings.regions;
  if (!settings.scheduleOn || !settings.day) return { slot: null, genres: ALL_GENRE_IDS, regions: pool };
  const slot = slotAt(buildDay(settings.day.seed), date);
  return { slot, genres: [slot.genre], regions: slotRegions(settings.day.seed, slot.index, pool) };
}

// ポップアップの番組表表示用
export function dayTable(settings) {
  if (!settings.day) return [];
  return buildDay(settings.day.seed).map((slot) => ({
    ...slot,
    regions: slotRegions(settings.day.seed, slot.index, settings.regions),
  }));
}

export function formatMinutes(min) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(min / 60) % 24)}:${p(min % 60)}`;
}
