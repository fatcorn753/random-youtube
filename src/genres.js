// mostPopular のカテゴリ別チャートが存在するジャンル（2026-10-27 に 8 か国で確認）。
// 「旅行とイベント(19)」「教育(27)」はチャート自体が存在しないので含めない
export const GENRES = [
  { id: '1', name: '映画・アニメ' },
  { id: '2', name: '自動車・乗り物' },
  { id: '10', name: '音楽' },
  { id: '15', name: 'ペット・動物' },
  { id: '17', name: 'スポーツ' },
  { id: '20', name: 'ゲーム' },
  { id: '22', name: 'ブログ・日常' },
  { id: '23', name: 'コメディー' },
  { id: '24', name: 'エンタメ' },
  { id: '25', name: 'ニュース・政治' },
  { id: '26', name: 'ハウツー・スタイル' },
  { id: '28', name: '科学・技術' },
];

export const ALL_GENRE_IDS = GENRES.map((g) => g.id);

export function genreName(id) {
  return GENRES.find((g) => g.id === id)?.name ?? id;
}
