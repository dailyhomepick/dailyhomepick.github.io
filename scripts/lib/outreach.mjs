// Outreach helpers: draft safe reply/comment copy that can drive traffic back to the site.
//
// This module does not post anything by itself. It only picks good products and drafts
// short, natural comments/replies with the right landing URL.

import { readJson, writeJson } from './store.mjs';
import { productUrl, won } from './deals.mjs';
import { extractTags } from './keywords.mjs';

const MAX_TITLE = 44;
const defaultLanding = (p) => productUrl(p, 'outreach');

const COMMENT_MODES = {
  cafe: {
    opener: ['저도 이런 거 볼 때 먼저 가격부터 봐요.', '이런 건 필요할 때 바로 써서 가격 괜찮으면 챙기게 되더라고요.'],
    body: ['실사용 목적이면 이 정도면 괜찮아 보입니다.', '조건 맞으면 무난하게 보기 좋은 편이에요.'],
    closer: ['정리해 둔 페이지: {link}', '같은 기준으로 묶어둔 페이지: {link}'],
  },
  blog: {
    opener: ['관련해서 정리해 둔 게 있어서 공유합니다.', '비슷한 것 찾는 분들 있으면 참고용으로 남깁니다.'],
    body: ['할인폭이 괜찮고, 가격 기준으로 보기엔 무난합니다.', '같은 옵션 기준으로 보면 지금 가격이 눈에 띄는 편이에요.'],
    closer: ['정리해 둔 페이지: {link}', '가격 기준 모아둔 페이지: {link}'],
  },
  threads: {
    opener: ['이건 가격 기준으로 볼 만하네요.', '요즘 같은 때 이런 건 바로 눈에 들어오죠.'],
    body: ['할인폭이 좋아서 후보로 넣기 괜찮습니다.', '필요한 분들에겐 바로 쓸만한 쪽이에요.'],
    closer: ['정리해 둔 페이지: {link}', '상세는 여기: {link}'],
  },
  forum: {
    opener: ['저도 비슷한 걸 찾다가 확인한 건데요.', '궁금해서 조금 정리해 봤습니다.'],
    body: ['이 정도면 비교해서 볼 만합니다.', '가격·용도 기준으로 보면 무난한 편이에요.'],
    closer: ['정리해 둔 페이지: {link}', '링크는 여기입니다: {link}'],
  },
  default: {
    opener: ['할인폭이 괜찮아서 눈에 띄네요.', '이 정도면 한 번 볼 만합니다.'],
    body: ['가격 기준으로 보면 꽤 괜찮습니다.', '실용성 있는 쪽이면 참고할 만해요.'],
    closer: ['정리해 둔 페이지: {link}', '상세는 여기: {link}'],
  },
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

function discountLabel(p) {
  return p.discountRate ? `↓${p.discountRate}%` : '할인 중';
}

function priceLine(p) {
  const now = won(p.price.min);
  return p.originalPrice ? `${now} / 정가 ${won(p.originalPrice)}` : now;
}

function makeTagLine(p) {
  const tags = extractTags(p).slice(0, 3);
  return tags.length ? `#${tags.join(' #').replace(/\s+/g, '')}` : '';
}

function pickMode(mode) {
  return COMMENT_MODES[mode] || COMMENT_MODES.default;
}

export function draftReply(p, { mode = 'default' } = {}) {
  const theme = pickMode(mode);
  const title = compactTitle(p.title);
  const landing = defaultLanding(p);
  const tags = makeTagLine(p);
  const lines = [
    title,
    theme.opener[(title.length + p.id.length) % theme.opener.length],
    `${priceLine(p)} · ${discountLabel(p)}`,
    theme.body[(title.length + String(p.price?.min || '').length) % theme.body.length],
    tags,
    theme.closer[(title.length + landing.length) % theme.closer.length].replace('{link}', landing),
  ].filter(Boolean);
  return lines.join('\n');
}

export function buildOutreachDrafts({ count = 5, mode = 'default' } = {}) {
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
    message: draftReply(p, { mode }),
    mode,
  }));
}

export function saveOutreachDrafts(drafts, file = 'data/outreach-drafts.json') {
  writeJson(file, {
    updatedAt: new Date().toISOString(),
    drafts,
  });
}

export function buildCommentFlow({ mode = 'default' } = {}) {
  return [
    '1) 대상 글을 고른다.',
    '2) 짧게 공감/정보/비교 포인트를 먼저 쓴다.',
    '3) 판매 링크보다 먼저 가치 있는 한 줄을 둔다.',
    '4) 사이트 링크는 맥락상 필요한 경우에만 붙인다.',
    '5) 같은 문구를 반복하지 않는다.',
    '6) 댓글은 초안만 자동 생성하고 최종 게시 전에는 확인한다.',
    `7) 현재 톤: ${mode}`,
  ];
}
