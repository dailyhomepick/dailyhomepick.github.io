// Import candidate products from data/inbox/*.json, auto-review them and merge into data/products.json.
//
// Usage:
//   node scripts/import.mjs                 # all files in data/inbox/
//   node scripts/import.mjs file.json ...   # specific files
// Options:
//   --auto         publish passing items right away (otherwise status "pending" → review page)
//   --no-images    skip the image URL check (offline testing only)
//   --dry          print the result without writing anything
//
// Candidate schema: see AGENTS.md "후보 파일 형식".

import { readdirSync, readFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  prohibitedReason, parsePrice, discountOf, textProblem, isBlockedLink, isProductUrl,
  storeOf, networkOf, guessCategory, today, loadEnv, imageProblem, unwrapImage, outOfScope, daysBetween,
} from './lib/rules.mjs';
import { loadMerchants, deeplinkFor } from './lib/linkprice.mjs';
import { readJson, writeJson, path, hash, titleKey, linkKey, addToDailyPost } from './lib/store.mjs';

loadEnv();
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const files = args.filter((a) => !a.startsWith('--'));

const site = readJson('data/site.json');
const rules = site.publish;
const categories = new Set(readJson('data/categories.json').map((c) => c.slug));
const products = readJson('data/products.json');
const posts = readJson('data/posts.json');
const rejected = readJson('data/rejected.json', []);
const merchants = loadMerchants(path('data/merchants.json'));
const autoPublish = flag('--auto') || rules.autoApprove;
const date = today();

const inboxDir = path('data/inbox');
const inputs = files.length ? files : (existsSync(inboxDir)
  ? readdirSync(inboxDir).filter((f) => f.endsWith('.json')).map((f) => join(inboxDir, f)) : []);
if (!inputs.length) { console.log('가져올 후보 파일이 없습니다 (data/inbox/*.json)'); process.exit(0); }

const byLink = new Map(products.map((p) => [linkKey(p.link), p]));
const byTitle = new Map(products.map((p) => [titleKey(p.title), p]));
const bySource = new Map(products.filter((p) => p.sourceId).map((p) => [p.sourceId, p]));
const rejectedKeys = new Set(rejected.map((r) => r.key));

async function imageOk(url) {
  if (flag('--no-images')) return '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 DailyHomePickBot' } });
    clearTimeout(t);
    const type = res.headers.get('content-type') || '';
    ctrl.abort();
    if (!res.ok) return `이미지 응답 ${res.status}`;
    if (!type.startsWith('image/')) return `이미지가 아님(${type || '형식 없음'})`;
    return '';
  } catch (e) {
    return `이미지 열기 실패(${e.name === 'AbortError' ? '시간 초과' : e.message})`;
  }
}

function review(c) {
  const problems = [];
  const warn = [];
  if (!c.title) problems.push('상품명 없음');
  if (c.image) c.image = unwrapImage(c.image);
  const imgBad = imageProblem(c.image);
  if (imgBad) problems.push(imgBad);
  if (!c.link) problems.push('판매 링크 없음');
  const bad = prohibitedReason(c.title, c.sourceCategory, ...(c.tags || []));
  if (bad) problems.push(`금지 품목: ${bad}`);
  const scope = outOfScope(c.title);
  if (scope) problems.push(`사이트 범위 아님: ${scope}`);
  if (c.link && isBlockedLink(c.link)) problems.push('판매처가 아닌 사이트(비교·커뮤니티·중고) 링크');
  if (c.link && !isProductUrl(c.link)) problems.push('상품 페이지가 아닌 첫 화면 링크');

  const price = parsePrice(c.price);
  const orig = c.originalPrice != null ? parsePrice(c.originalPrice) : null;
  if (!price || !(price.value > 0)) problems.push('가격 없음/0원');
  else if (price.currency === 'KRW' && (price.value < 100 || price.value > 20_000_000)) problems.push(`비정상 가격 ${price.value}`);
  if (orig && price && orig.value < price.value) problems.push('정가가 판매가보다 낮음');
  const rate = discountOf(price?.value, orig?.value) || Number(c.discountRate) || 0;
  if (rate > 95) problems.push(`비정상 할인율 ${rate}%`);
  if (rate && rate < rules.minDiscount) problems.push(`할인율 ${rate}% < 기준 ${rules.minDiscount}%`);
  if (!rate && !rules.allowUnknownDiscount) problems.push('할인율 정보 없음');

  for (const t of [c.title, c.summary, c.caution, ...(c.specs || []).flat()]) {
    const p = textProblem(t);
    if (p) problems.push(p);
  }
  const cats = (c.categories || []).filter((x) => categories.has(x));
  if (c.categories?.length && !cats.length) warn.push(`모르는 카테고리 ${c.categories.join(',')} → 자동 분류`);

  const affiliateLink = c.affiliateLink || deeplinkFor(c.link, merchants, rules.subId || '');
  const network = c.network || networkOf(affiliateLink);
  if (!affiliateLink && rules.requireAffiliate) problems.push('파트너스/제휴 링크 없음');
  if (!affiliateLink) warn.push('제휴 링크 없음(수익 없음)');
  if (!storeOf(c.link)) warn.push('목록에 없는 판매처');

  return {
    problems, warn,
    normalized: {
      title: String(c.title || '').trim(),
      image: c.image,
      price: price ? { min: price.value, ...(price.currency !== 'KRW' ? { currency: price.currency } : {}) } : null,
      originalPrice: orig?.value,
      discountRate: rate || undefined,
      store: c.store || storeOf(c.link)?.name || '',
      link: c.link,
      affiliateLink,
      network,
      categories: cats.length ? cats : [guessCategory(c.title, c.store || storeOf(c.link)?.name)],
      tags: [...new Set(c.tags || [])],
      summary: c.summary || '',
      specs: c.specs || [],
      caution: c.caution || '',
      badges: c.badges || [],
      source: c.source || '',
      sourceId: c.sourceId || '',
    },
  };
}

const report = { date, published: [], pending: [], updated: [], rejected: [] };
const touchedIds = [];
for (const file of inputs) {
  const list = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const items = Array.isArray(list) ? list : list.items || [];
  for (const c of items) {
    const key = c.sourceId || linkKey(c.link) || titleKey(c.title);
    const existing = (c.sourceId && bySource.get(c.sourceId)) || byLink.get(linkKey(c.link)) || byTitle.get(titleKey(c.title));
    if (!existing && rejectedKeys.has(key)) continue;

    const r = review(c);
    if (r.problems.length) {
      report.rejected.push({ title: c.title, key, reasons: r.problems });
      // A published item that now fails a hard rule (금지 품목·범위 밖) is taken down.
      if (existing && existing.status !== 'hidden' && r.problems.some((x) => /^(금지 품목|사이트 범위 아님)/.test(x))) {
        existing.status = 'hidden';
        existing.hiddenReason = r.problems[0];
      }
      continue;
    }
    if (r.normalized.image) {
      const imgProblem = await imageOk(r.normalized.image);
      if (imgProblem) { report.rejected.push({ title: c.title, key, reasons: [imgProblem] }); continue; }
    }
    const n = r.normalized;

    if (existing) {
      // Price refresh: keep a short history so pages can show "최근 최저가" and price drops.
      const recent = (existing.priceHistory || []).filter((h) => daysBetween(h.date, date) <= 30).map((h) => h.price);
      const high = Math.max(0, ...recent);
      const drop = high > n.price.min ? Math.round(((high - n.price.min) / high) * 100) : 0;
      if (drop >= 3) existing.priceDropRate = drop;
      else delete existing.priceDropRate;
      const last = existing.priceHistory?.at(-1);
      if (!last || last.price !== n.price.min) {
        existing.priceHistory = [...(existing.priceHistory || []), { date, price: n.price.min }].slice(-60);
      }
      Object.assign(existing, {
        price: n.price, originalPrice: n.originalPrice, discountRate: n.discountRate, checkedAt: date,
        image: n.image || existing.image,
        badges: n.badges.length ? n.badges : existing.badges,
        affiliateLink: n.affiliateLink || existing.affiliateLink,
        network: n.affiliateLink ? n.network : existing.network,
      });
      if (existing.status === 'expired') existing.status = 'published';
      report.updated.push(existing.id);
      touchedIds.push(existing.id);
      continue;
    }

    const id = (n.sourceId || `${date.replace(/-/g, '')}-${hash(n.link)}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const product = {
      id, status: autoPublish ? 'published' : 'pending', addedAt: date, checkedAt: date,
      ...n, priceHistory: [{ date, price: n.price.min }],
    };
    for (const k of Object.keys(product)) if (product[k] === undefined || product[k] === '') delete product[k];
    product.tags ??= [];
    product.specs ??= [];
    products.push(product);
    byLink.set(linkKey(n.link), product);
    byTitle.set(titleKey(n.title), product);
    if (n.sourceId) bySource.set(n.sourceId, product);
    (autoPublish ? report.published : report.pending).push(id);
    if (autoPublish) touchedIds.push(id);
    if (r.warn.length) console.log(`  주의 ${id}: ${r.warn.join(', ')}`);
  }
}

if (!flag('--dry')) {
  const productsById = new Map(products.map((p) => [p.id, p]));
  addToDailyPost(posts, date, touchedIds.filter((id) => productsById.get(id)?.status === 'published'), productsById);
  for (const r of report.rejected) if (!rejectedKeys.has(r.key)) rejected.push({ key: r.key, title: r.title, reasons: r.reasons, at: date });
  writeJson('data/products.json', products);
  writeJson('data/posts.json', posts);
  writeJson('data/rejected.json', rejected.slice(-5000));
  if (!files.length) {
    const done = join(inboxDir, 'done');
    mkdirSync(done, { recursive: true });
    for (const f of inputs) renameSync(f, join(done, `${date}-${basename(f)}`));
  }
}

console.log(`가져오기 결과 (${date})`);
console.log(`  게시 ${report.published.length} · 검수 대기 ${report.pending.length} · 가격 갱신 ${report.updated.length} · 탈락 ${report.rejected.length}`);
const reasons = {};
for (const r of report.rejected) for (const x of r.reasons) { const k = x.split(/[:(]| \d/)[0].trim(); reasons[k] = (reasons[k] || 0) + 1; }
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`    탈락 사유 ${k}: ${v}`);
if (report.pending.length) console.log('  검수 대기 상품은 /review.html 에서 확인 후 `node scripts/review.mjs approve ...`');
