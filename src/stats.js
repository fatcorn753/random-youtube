// 視聴統計。日付ごとに本数と国別の本数だけを持つ（動画の中身は保存しない）
export const KEEP_DAYS = 30;

// 端末のローカル日付（YYYY-MM-DD）。深夜 0 時で日が替わる
export function dateKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const bump = (counts = {}, key) => ({ ...counts, [key]: (counts[key] ?? 0) + 1 });

export function recordView(stats, region, genre, date = new Date()) {
  const key = dateKey(date);
  const day = stats[key] ?? { total: 0, byRegion: {}, byGenre: {} };
  const next = {
    ...stats,
    [key]: { total: day.total + 1, byRegion: bump(day.byRegion, region), byGenre: bump(day.byGenre, genre) },
  };
  const keys = Object.keys(next).sort();
  while (keys.length > KEEP_DAYS) delete next[keys.shift()];
  return next;
}

const rank = (counts = {}) =>
  Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

export function summarize(stats, date = new Date()) {
  const day = stats[dateKey(date)];
  return { total: day?.total ?? 0, regions: rank(day?.byRegion), genres: rank(day?.byGenre) };
}
