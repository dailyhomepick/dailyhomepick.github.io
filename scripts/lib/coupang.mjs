// Coupang Partners Open API client (HMAC-SHA256 signed requests).
// Keys come from env: COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY, optional COUPANG_SUB_ID.
// API access requires Coupang Partners "최종 승인"; before that every call returns 401/403.

import { createHmac } from 'node:crypto';
import { guessCategory } from './rules.mjs';

const HOST = 'https://api-gateway.coupang.com';
const BASE = '/v2/providers/affiliate_open_api/apis/openapi/v1';

function signedDate() {
  // yyMMdd'T'HHmmss'Z' in UTC
  return new Date().toISOString().replace(/^\d\d|[-:]|\.\d+/g, '');
}

export function hasKeys() {
  return Boolean(process.env.COUPANG_ACCESS_KEY && process.env.COUPANG_SECRET_KEY);
}

async function call(method, pathWithQuery, body) {
  const ak = process.env.COUPANG_ACCESS_KEY;
  const sk = process.env.COUPANG_SECRET_KEY;
  if (!ak || !sk) throw new Error('COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 환경변수가 없습니다 (AGENTS.md 키 보관 참고)');
  const [path, query = ''] = pathWithQuery.split('?');
  const dt = signedDate();
  const sig = createHmac('sha256', sk).update(dt + method + path + query).digest('hex');
  const res = await fetch(HOST + pathWithQuery, {
    method,
    headers: {
      Authorization: `CEA algorithm=HmacSHA256, access-key=${ak}, signed-date=${dt}, signature=${sig}`,
      'Content-Type': 'application/json;charset=UTF-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403
      ? ' (키가 틀렸거나, 최종 승인 전이거나, 호출 한도 초과일 수 있습니다)' : '';
    throw new Error(`쿠팡 API ${res.status}${hint}: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text);
  if (json.rCode && json.rCode !== '0') throw new Error(`쿠팡 API 오류 ${json.rCode}: ${json.rMessage}`);
  return json.data;
}

const sub = () => (process.env.COUPANG_SUB_ID ? `subId=${encodeURIComponent(process.env.COUPANG_SUB_ID)}` : '');
const qs = (...parts) => { const q = parts.filter(Boolean).join('&'); return q ? `?${q}` : ''; };

export const goldbox = () => call('GET', `${BASE}/products/goldbox${qs(sub())}`);
export const bestCategory = (categoryId, limit = 50) =>
  call('GET', `${BASE}/products/bestcategories/${categoryId}${qs(`limit=${limit}`, sub())}`);
export const search = async (keyword, limit = 10) => {
  const data = await call('GET', `${BASE}/products/search${qs(`keyword=${encodeURIComponent(keyword)}`, `limit=${limit}`, sub())}`);
  return data?.productData || [];
};
export const deeplink = (urls) =>
  call('POST', `${BASE}/deeplink`, { coupangUrls: urls, ...(process.env.COUPANG_SUB_ID ? { subId: process.env.COUPANG_SUB_ID } : {}) });

// Coupang best-category ids → site category slugs. Unlisted ids are not collected.
export const CATEGORY_MAP = {
  1001: 'fashion', 1002: 'fashion',
  1010: 'beauty',
  1011: 'baby', 1030: 'baby',
  1012: 'food',
  1013: 'kitchen',
  1014: 'living', 1015: 'living',
  1016: 'electronics',
  1029: 'pet',
};
const NAME_MAP = [
  [/출산|유아|아동/, 'baby'], [/식품/, 'food'], [/주방/, 'kitchen'], [/생활|인테리어|홈/, 'living'],
  [/가전|디지털/, 'electronics'], [/반려/, 'pet'], [/뷰티/, 'beauty'], [/패션/, 'fashion'],
];

// API product → candidate (schema in AGENTS.md). productUrl from the API is already a partner link.
// The goldbox/best responses carry no list price or category name, so the category may be guessed
// from the title and discounts come from our own price history (see import.mjs).
export function toCandidate(p, { categoryId, source } = {}) {
  const category = CATEGORY_MAP[categoryId] || NAME_MAP.find(([re]) => re.test(p.categoryName || ''))?.[1]
    || guessCategory(p.productName, '쿠팡');
  const original = Number(p.originalPrice || p.basePrice || p.listPrice || 0) || undefined;
  return {
    source: source || 'coupang',
    sourceId: `coupang-${p.productId}`,
    title: p.productName,
    image: p.productImage,
    price: Number(p.productPrice),
    originalPrice: original,
    discountRate: Number(p.discountRate) || undefined,
    store: '쿠팡',
    link: `https://www.coupang.com/vp/products/${p.productId}`,
    affiliateLink: p.productUrl,
    network: 'coupang',
    categories: category ? [category] : [],
    sourceCategory: p.categoryName || '',
    badges: [source === 'coupang-goldbox' && '골드박스', p.isRocket && '로켓배송', p.isFreeShipping && '무료배송'].filter(Boolean),
  };
}
