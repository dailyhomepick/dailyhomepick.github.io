// Outreach helpers: draft safe reply/comment copy that can drive traffic back to the site.
//
// This module does not post anything by itself. It only picks good products and drafts
// short, natural comments/replies with the right landing URL.

import { readJson, writeJson } from './store.mjs';
import { productUrl, won } from './deals.mjs';
import { extractTags } from './keywords.mjs';

const MAX_TITLE = 44;
const defaultLanding = (p) => productUrl(p, 'outreach');

const HOOKS = {
  living: ['이런 건 집에 하나 있으면 계속 쓰게 되죠.', '생활용품은 필요할 때 바로 사두는 게 편하죠.'],
  kitchen: ['주방 쪽은 한 번 바꾸면 체감이 크더라고요.', '주방템은 쓰임새가 좋아서 고민이 적어요.'],
  solo: ['혼자 쓰는 집이면 이런 게 은근 유용합니다.', '자취템은 크기보다 실용성이 먼저더라고요.'],
  pet: ['집사 입장에선 이런 건 바로 눈에 들어오죠.', '반려용품은 소모가 빨라서 미리 챙기면 편해요.'],
  baby: ['육아용품은 타이밍 맞을 때 챙기는 게 좋죠.', '아기용품은 재구매 시점이 빨리 오더라고요.'],
  electronics: ['전자제품은 사양 대비 가격을 같이 봐야 하죠.', '기능 대비 가격이 괜찮으면 바로 후보가 되더라고요.'],
  food: ['식품은 맛보다도 가성비가 먼저 보이네요.', '먹는 건 금방 쓰이니 쟁여두기 좋죠.'],
  beauty: ['이쪽은 쓰던 거 떨어질 때가 제일 아쉽죠.', '뷰티템은 보통 재구매 타이밍이 짧아요.'],
  fashion: ['계절 바뀌면 이런 게 먼저 눈에 들어오죠.', '패션은 지금 시즌에 맞는지가 중요하죠.'],
  default: ['할인폭이 괜찮아서 눈에 띄네요.', '이 정도면 한 번 볼 만합니다.'],
};

function compactTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

function categoryOf(p) {
  const cats = p.categories || [];
  if (cats.includes('pet')) return 'pet';
  if (cats.includes('baby')) return 'baby';
  if (cats.includes('electronics')) return 'electronics';
  if (cats.includes('kitchen')) return 'kitchen';
  if (cats.includes('food')) return 'food';
  if (cats.includes('beauty')) return 'beauty';
  if (cats.includes('fashion')) return 'fashion';
  if (cats.includes('solo-living')) return 'solo';
  if (cats.includes('living')) return 'living';
  return 'default';
}

function scoreProduct(p) {
  const rate = Number(p.discountRate) || 0;
  const price = Number(p.price?.min || p.price || 0);
  const checked = p.checkedAt ? 1 : 0;
  const hasImage = p.image ? 1 : 0;
  return rate * 4 + Math.min(price / 1000, 50) * 0.2 + checked * 2 + hasImage;
}

export function selectOutreachProducts(products, count = 5) {
  return products
    .filter((p) => p.status === 'published' && p.price?.min && p.title)
    .sort((a, b) => scoreProduct(b) - scoreProduct(a))
    .slice(0, count);
}

export function draftReply(p, { tone = 'default' } = {}) {
  const cat = categoryOf(p);
  const hook = HOOKS[cat] || HOOKS.default;
  const title = compactTitle(p.title);
  const price = won(p.price.min);
  const discount = p.discountRate ? `↓${p.discountRate}%` : '할인 중';
  const tags = extractTags(p).slice(0, 3).join(' · ');
  const landing = defaultLanding(p);
  const lines = [
    `${title} ${discount}`,
    `${price}${p.originalPrice ? ` / 정가 ${won(p.originalPrice)}` : ''}`,
    hook[(title.length + price.length) % hook.length],
    tags ? `#${tags.replace(/\s+/g, '')}` : '',
    `정리해 둔 페이지: ${landing}`,
  ].filter(Boolean);
  return lines.join('\n');
}

export function buildOutreachDrafts({ count = 5, tone = 'default' } = {}) {
  const products = readJson('data/products.json', []);
  const selected = selectOutreachProducts(products, count);
  return selected.map((p, idx) => ({
    rank: idx + 1,
    productId: p.id,
    title: p.title,
    price: p.price?.min || 0,
    discountRate: p.discountRate || 0,
    categories: p.categories || [],
    landing: defaultLanding(p),
    message: draftReply(p, { tone }),
  }));
}

export function saveOutreachDrafts(drafts, file = 'data/outreach-drafts.json') {
  writeJson(file, {
    updatedAt: new Date().toISOString(),
    drafts,
  });
}
