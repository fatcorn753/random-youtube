// 動画を選ぶ担当。ジャンルを等確率で選び、次に国を等確率で選び、その一覧の未視聴動画から 1 本返す。
// 「カテゴリ指定なしの人気一覧」は音楽とゲームに偏るので、必ずジャンルを指定して取得する
export const MIN_SECONDS = 60; // Shorts や短いクリップはテレビらしくないので除く
export const MIN_POOL = 10; // これより少ない一覧（例: 小さな国のブログ）は同じ動画の繰り返しになるので使わない
export const CACHE_TTL_MS = 60 * 60 * 1000;

const FATAL_REASONS = new Set([
  'keyInvalid',
  'quotaExceeded',
  'dailyLimitExceeded',
  'rateLimitExceeded',
  'accessNotConfigured',
  'forbidden',
  'ipRefererBlocked',
]);

export class ApiError extends Error {
  constructor(status, reason, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    // キーや割り当ての問題は他の国を試しても直らないので、即座に利用者へ知らせる
    this.fatal = FATAL_REASONS.has(reason);
  }
}

export class NoRegionError extends Error {
  constructor() {
    super('国が1つも選択されていません');
    this.name = 'NoRegionError';
  }
}

export class NoVideosError extends Error {
  constructor() {
    super('この条件で再生できる動画が見つかりません');
    this.name = 'NoVideosError';
  }
}

// ISO 8601 の期間（PT1H2M3S など）を秒に直す
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? '');
  if (!m) return 0;
  const [d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

export function isPlayable(item) {
  return (
    item.status?.embeddable === true &&
    item.status?.privacyStatus === 'public' &&
    item.snippet?.liveBroadcastContent === 'none' &&
    parseDuration(item.contentDetails?.duration) >= MIN_SECONDS
  );
}

export async function fetchPopular(region, apiKey, genre, fetchFn = fetch) {
  const params = new URLSearchParams({
    part: 'snippet,status,contentDetails',
    chart: 'mostPopular',
    regionCode: region,
    maxResults: '50',
    key: apiKey,
  });
  if (genre) params.set('videoCategoryId', genre);
  const res = await fetchFn(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body.error ?? {};
    const reason = e.errors?.[0]?.reason ?? 'unknown';
    // その国・ジャンルにチャートが無いだけなので、一覧が空として扱う
    if (reason === 'videoChartNotFound') return [];
    throw new ApiError(res.status, reason, e.message ?? `HTTP ${res.status}`);
  }
  return (body.items ?? []).filter(isPlayable).map((item) => ({
    id: item.id,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    region,
    genre,
  }));
}

export class Programmer {
  #apiKey;
  #fetchFn;
  #rng;
  #now;
  #cache = new Map(); // `${region}:${genre}` -> { at, items }
  #seen = new Map(); // 同上 -> 見終えた動画 id の Set
  #last = null;

  constructor({ apiKey, fetchFn = fetch, rng = Math.random, now = Date.now }) {
    this.#apiKey = apiKey;
    this.#fetchFn = fetchFn;
    this.#rng = rng;
    this.#now = now;
  }

  setApiKey(apiKey) {
    this.#apiKey = apiKey;
    this.#cache.clear();
  }

  async #load(region, genre) {
    const key = `${region}:${genre}`;
    const hit = this.#cache.get(key);
    if (hit && this.#now() - hit.at < CACHE_TTL_MS) return hit.items;
    const items = await fetchPopular(region, this.#apiKey, genre, this.#fetchFn);
    this.#cache.set(key, { at: this.#now(), items });
    // 人気一覧から外れた動画の履歴は不要なので、履歴が膨らまないよう落とす
    const seen = this.#seenFor(key);
    const ids = new Set(items.map((v) => v.id));
    for (const id of seen) if (!ids.has(id)) seen.delete(id);
    return items;
  }

  #seenFor(key) {
    if (!this.#seen.has(key)) this.#seen.set(key, new Set());
    return this.#seen.get(key);
  }

  #pick(list) {
    return Math.floor(this.#rng() * list.length);
  }

  // genres と regions は「いま許す範囲」。ジャンルを先に等確率で選ぶので、ジャンルごとの
  // 動画数の差で偏らない。見尽くした一覧は、その一覧の履歴だけをリセットして確率を保つ
  async next({ genres, regions }) {
    if (regions.length === 0) throw new NoRegionError();

    const genreLeft = [...genres];
    const regionsLeft = new Map(genres.map((g) => [g, [...regions]]));
    let lastError = null;

    while (genreLeft.length > 0) {
      const gi = this.#pick(genreLeft);
      const genre = genreLeft[gi];
      const candidates = regionsLeft.get(genre);

      while (candidates.length > 0) {
        const ri = this.#pick(candidates);
        const region = candidates[ri];
        let items;
        try {
          items = await this.#load(region, genre);
        } catch (e) {
          if (e.fatal) throw e;
          lastError = e;
          candidates.splice(ri, 1);
          continue;
        }
        if (items.length < MIN_POOL) {
          candidates.splice(ri, 1);
          continue;
        }

        const seen = this.#seenFor(`${region}:${genre}`);
        let pool = items.filter((v) => !seen.has(v.id));
        if (pool.length === 0) {
          seen.clear();
          pool = items.filter((v) => v.id !== this.#last); // リセット直後の同じ動画の連続を避ける
          if (pool.length === 0) pool = items;
        }
        const video = pool[this.#pick(pool)];
        seen.add(video.id);
        this.#last = video.id;
        return video;
      }
      genreLeft.splice(gi, 1);
    }
    throw lastError ?? new NoVideosError();
  }
}
