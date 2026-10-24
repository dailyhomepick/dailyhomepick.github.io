// Read/write helpers for data/*.json shared by the CLI scripts.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const path = (p) => join(ROOT, p);
export const readJson = (p, fallback) => (existsSync(path(p)) ? JSON.parse(readFileSync(path(p), 'utf8')) : fallback);
export const writeJson = (p, v) => writeFileSync(path(p), `${JSON.stringify(v, null, 2)}\n`);
export const hash = (s, n = 8) => createHash('sha1').update(String(s)).digest('hex').slice(0, n);

// Normalised title for duplicate detection.
export const titleKey = (t = '') => t.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

// Canonical product link (tracking params removed) for duplicate detection.
export function linkKey(url = '') {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host.endsWith('coupang.com')) {
      const id = u.pathname.match(/products\/(\d+)/)?.[1];
      if (id) return `coupang:${id}`;
    }
    return host + u.pathname.replace(/\/+$/, '');
  } catch { return ''; }
}

// Adds product ids to the YYYY-MM-DD-deals post, creating it if needed.
export function addToDailyPost(posts, date, ids, productsById) {
  if (!ids.length) return false;
  const slug = `${date}-deals`;
  let post = posts.find((p) => p.slug === slug);
  if (!post) {
    const [, m, d] = date.split('-').map(Number);
    post = {
      slug, kind: 'deals', date, auto: true,
      title: `${m}월 ${d}일 오늘의 할인`,
      description: `${m}월 ${d}일 가격을 확인한 할인 상품 모음입니다.`,
      intro: '오늘 가격을 확인한 할인 상품입니다. 할인율이 높은 순서로 정리했고, 가격은 판매처 사정에 따라 바뀔 수 있습니다.',
      items: [],
    };
    posts.unshift(post);
  }
  const have = new Set(post.items.map((i) => i.product));
  for (const id of ids) if (!have.has(id)) post.items.push({ product: id });
  if (post.auto) {
    // Highest discount first; the first item is the featured one.
    const rate = (id) => productsById.get(id)?.discountRate || 0;
    post.items.sort((a, b) => rate(b.product) - rate(a.product));
    post.featured = post.items[0]?.product;
    const [, m, d] = date.split('-').map(Number);
    post.title = `${m}월 ${d}일 오늘의 할인 ${post.items.length}선`;
  } else {
    post.title = post.title.replace(/\d+선/, `${post.items.length}선`);
  }
  return true;
}
