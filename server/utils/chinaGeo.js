// China geo helpers: province -> region mapping + neighbor regions
// Region set: 华北 华东 华南 华中 东北 西南 西北

const REGION_NAMES = ['华北', '华东', '华南', '华中', '东北', '西南', '西北'];

const PROVINCE_TO_REGION = {
  // 华北
  '北京': '华北',
  '天津': '华北',
  '河北': '华北',
  '山西': '华北',
  '内蒙古': '华北',

  // 华东
  '上海': '华东',
  '江苏': '华东',
  '浙江': '华东',
  '安徽': '华东',
  '福建': '华东',
  '江西': '华东',
  '山东': '华东',

  // 华南
  '广东': '华南',
  '广西': '华南',
  '海南': '华南',

  // 华中
  '河南': '华中',
  '湖北': '华中',
  '湖南': '华中',

  // 东北
  '辽宁': '东北',
  '吉林': '东北',
  '黑龙江': '东北',

  // 西南
  '重庆': '西南',
  '四川': '西南',
  '贵州': '西南',
  '云南': '西南',
  '西藏': '西南',

  // 西北
  '陕西': '西北',
  '甘肃': '西北',
  '青海': '西北',
  '宁夏': '西北',
  '新疆': '西北'
};

// Common aliases / full names mapping to canonical province key
const PROVINCE_ALIASES = {
  '北京市': '北京',
  '天津市': '天津',
  '上海市': '上海',
  '重庆市': '重庆',
  '内蒙古自治区': '内蒙古',
  '广西壮族自治区': '广西',
  '西藏自治区': '西藏',
  '宁夏回族自治区': '宁夏',
  '新疆维吾尔自治区': '新疆',
  '香港特别行政区': '香港',
  '澳门特别行政区': '澳门',
  '台湾省': '台湾'
};

const REGION_NEIGHBORS = {
  // “B” strategy: include neighbors to match real-world cross-region care.
  '华北': ['华东', '东北', '华中'],
  '华东': ['华北', '华中', '华南'],
  '华南': ['华东', '华中', '西南'],
  '华中': ['华北', '华东', '华南', '西南', '西北'],
  '东北': ['华北', '华东'],
  '西南': ['华中', '华南', '西北'],
  '西北': ['华北', '华中', '西南']
};

function normalizeText(value) {
  return String(value || '').trim();
}

function canonicalProvince(province) {
  const p = normalizeText(province);
  if (!p) return null;
  if (PROVINCE_TO_REGION[p]) return p;
  if (PROVINCE_ALIASES[p]) return PROVINCE_ALIASES[p];

  // Strip common suffixes.
  const stripped = p
    .replace(/省$/g, '')
    .replace(/市$/g, '')
    .replace(/壮族自治区$|回族自治区$|维吾尔自治区$|自治区$/g, '')
    .trim();

  if (PROVINCE_TO_REGION[stripped]) return stripped;
  if (PROVINCE_ALIASES[stripped]) return PROVINCE_ALIASES[stripped];
  return null;
}

function inferProvinceFromTrial(trial) {
  if (!trial || typeof trial !== 'object') return null;

  const candidates = [];
  if (trial.province) candidates.push(trial.province);
  if (Array.isArray(trial.provinces)) candidates.push(...trial.provinces);
  if (trial.location) candidates.push(trial.location);
  if (trial.city) candidates.push(trial.city);
  if (Array.isArray(trial.cities)) candidates.push(...trial.cities);

  for (const raw of candidates) {
    const text = normalizeText(raw);
    if (!text) continue;

    // Direct canonicalization (handles 北京市/河北省 etc.)
    const direct = canonicalProvince(text);
    if (direct) return direct;

    // Search province tokens inside longer location strings.
    for (const prov of Object.keys(PROVINCE_TO_REGION)) {
      if (text.includes(prov)) return prov;
    }
    for (const alias of Object.keys(PROVINCE_ALIASES)) {
      if (text.includes(alias)) return PROVINCE_ALIASES[alias];
    }
  }

  return null;
}

function provinceToRegion(province) {
  const canon = canonicalProvince(province);
  if (!canon) return null;
  return PROVINCE_TO_REGION[canon] || null;
}

function expandRegions(regions = [], includeNeighbors = false) {
  const base = Array.isArray(regions) ? regions : [regions];
  const cleaned = base.map((r) => normalizeText(r)).filter(Boolean);
  const normalized = cleaned.map((r) => r.replace(/地区$/g, '')).filter(Boolean);

  const set = new Set();
  normalized.forEach((r) => {
    if (REGION_NAMES.includes(r)) set.add(r);
  });

  if (!includeNeighbors) return Array.from(set);

  const out = new Set(set);
  for (const r of set) {
    (REGION_NEIGHBORS[r] || []).forEach((n) => out.add(n));
  }
  return Array.from(out);
}

module.exports = {
  REGION_NAMES,
  PROVINCE_TO_REGION,
  REGION_NEIGHBORS,
  canonicalProvince,
  inferProvinceFromTrial,
  provinceToRegion,
  expandRegions
};
