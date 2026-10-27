// 「番組表」を担当する。選んだ国の人気動画から、見たことのないものをランダムに返す。
export const MIN_SECONDS = 60; // Shorts や短いクリップはテレビらしくないので除く
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

export async function fetchPopular(region, apiKey, fetchFn = fetch) {
  const params = new URLSearchParams({
    part: 'snippet,status,contentDetails',
    chart: 'mostPopular',
    regionCode: region,
    maxResults: '50',
    key: apiKey,
  });
  const res = await fetchFn(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body.error ?? {};
    throw new ApiError(res.status, e.errors?.[0]?.reason ?? 'unknown', e.message ?? `HTTP ${res.status}`);
  }
  return (body.items ?? []).filter(isPlayable).map((item) => ({
    id: item.id,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    region,
  }));
}

export class Programmer {
  #apiKey;
  #regions;
  #fetchFn;
  #rng;
  #now;
  #cache = new Map(); // region -> { at, items }
  #seen = new Map(); // region -> 見終えた動画 id の Set
  #last = null;

  constructor({ apiKey, regions, fetchFn = fetch, rng = Math.random, now = Date.now }) {
    this.#apiKey = apiKey;
    this.#regions = [...regions];
    this.#fetchFn = fetchFn;
    this.#rng = rng;
    this.#now = now;
  }

  setRegions(regions) {
    this.#regions = [...regions];
  }

  setApiKey(apiKey) {
    this.#apiKey = apiKey;
    this.#cache.clear();
  }

  async #load(region) {
    const hit = this.#cache.get(region);
    if (hit && this.#now() - hit.at < CACHE_TTL_MS) return hit.items;
    const items = await fetchPopular(region, this.#apiKey, this.#fetchFn);
    this.#cache.set(region, { at: this.#now(), items });
    // 人気一覧から外れた動画の履歴は不要なので、履歴が膨らまないよう落とす
    const seen = this.#seenFor(region);
    const ids = new Set(items.map((v) => v.id));
    for (const id of seen) if (!ids.has(id)) seen.delete(id);
    return items;
  }

  #seenFor(region) {
    if (!this.#seen.has(region)) this.#seen.set(region, new Set());
    return this.#seen.get(region);
  }

  // まず国を等確率で選び、その国の未視聴動画から1本選ぶ（人口の多い国への偏りを避ける）。
  // 見尽くした国は、その国の履歴だけをリセットして選択確率を保つ
  async next() {
    if (this.#regions.length === 0) throw new NoRegionError();

    const candidates = [...this.#regions];
    let lastError = null;

    while (candidates.length > 0) {
      const i = Math.floor(this.#rng() * candidates.length);
      const region = candidates[i];
      let items;
      try {
        items = await this.#load(region);
      } catch (e) {
        if (e.fatal) throw e;
        lastError = e;
        candidates.splice(i, 1);
        continue;
      }
      if (items.length === 0) {
        candidates.splice(i, 1);
        continue;
      }

      const seen = this.#seenFor(region);
      let pool = items.filter((v) => !seen.has(v.id));
      if (pool.length === 0) {
        seen.clear();
        pool = items.filter((v) => v.id !== this.#last); // リセット直後の同じ動画の連続を避ける
        if (pool.length === 0) pool = items;
      }
      const video = pool[Math.floor(this.#rng() * pool.length)];
      seen.add(video.id);
      this.#last = video.id;
      return video;
    }
    throw lastError ?? new Error('再生できる動画が見つかりません');
  }
}
