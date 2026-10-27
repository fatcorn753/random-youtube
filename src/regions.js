// YouTube の mostPopular が返す 111 地域（2026-10-27 に API で確認）を大陸単位でまとめたもの
export const REGION_GROUPS = [
  {
    id: 'asia',
    name: 'アジア',
    codes: ['BD', 'ID', 'IN', 'JP', 'KR', 'KH', 'LA', 'LK', 'MY', 'NP', 'PH', 'PK', 'SG', 'TH', 'VN', 'HK', 'TW', 'KZ'],
  },
  {
    id: 'mena',
    name: '中東・北アフリカ',
    codes: ['AE', 'BH', 'DZ', 'EG', 'IQ', 'JO', 'KW', 'LB', 'LY', 'MA', 'OM', 'QA', 'SA', 'TN', 'YE', 'IL', 'TR'],
  },
  {
    id: 'europe',
    name: 'ヨーロッパ',
    codes: [
      'AZ', 'AM', 'GE', 'CY', 'BY', 'BG', 'BA', 'CZ', 'DK', 'AT', 'CH', 'DE', 'GR', 'BE', 'GB', 'IE', 'MT',
      'ES', 'EE', 'FI', 'FR', 'HR', 'HU', 'IS', 'IT', 'LU', 'LT', 'LV', 'MK', 'NO', 'NL', 'PL', 'PT', 'MD',
      'RO', 'RU', 'SK', 'SI', 'ME', 'RS', 'SE', 'UA', 'LI',
    ],
  },
  {
    id: 'north-america',
    name: '北中米・カリブ',
    codes: ['US', 'CA', 'MX', 'CR', 'DO', 'GT', 'HN', 'JM', 'NI', 'PA', 'PR', 'SV'],
  },
  {
    id: 'south-america',
    name: '南米',
    codes: ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'PE', 'PY', 'UY', 'VE'],
  },
  {
    id: 'africa',
    name: 'アフリカ',
    codes: ['GH', 'KE', 'NG', 'SN', 'TZ', 'UG', 'ZA', 'ZW'],
  },
  {
    id: 'oceania',
    name: 'オセアニア',
    codes: ['AU', 'NZ', 'PG'],
  },
];

export const ALL_REGION_CODES = REGION_GROUPS.flatMap((g) => g.codes);

// 大陸ボタン用。全部入っていれば外し、そうでなければ足す（元の Set は変えずに返す）
export function toggleGroup(selected, group) {
  const next = new Set(selected);
  const allOn = group.codes.every((c) => next.has(c));
  for (const c of group.codes) allOn ? next.delete(c) : next.add(c);
  return next;
}

// 国名は Intl に任せる（API の i18nRegions は表記ゆれがあるため使わない）
export function regionName(code, locale = 'ja') {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
