// 데일리홈픽 static site generator.
// Reads data/*.json and writes every HTML page, sitemap, RSS, robots and search index.
// Usage: node scripts/build.mjs   (no dependencies)
// The build stops with a list of problems when a published product breaks the rules in AGENTS.md.

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { readJson, path } from './lib/store.mjs';
import {
  textProblem, isBlockedLink, isProductUrl, prohibitedReason, discountOf, networkOf, today, daysBetween, imageProblem,
} from './lib/rules.mjs';
import { itemOf, MODIFIERS } from './lib/keywords.mjs';
import { faqFor } from './lib/faq.mjs';

const site = readJson('data/site.json');
const categories = readJson('data/categories.json');
const allProducts = readJson('data/products.json');
const allPosts = readJson('data/posts.json').sort((a, b) => b.date.localeCompare(a.date));
const rules = site.publish;
const TODAY = today();

const ASSET_VERSION = Date.now().toString(36);
const GENERATED_DIRS = ['posts', 'categories', 'tags', 'p', 'k'];
const warnings = [];
const errors = [];

// ---------- validation ----------
const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));
const productById = new Map();
for (const p of allProducts) {
  if (productById.has(p.id)) errors.push(`중복 상품 id: ${p.id}`);
  p.status ??= 'published';
  p.tags ??= [];
  p.specs ??= [];
  productById.set(p.id, p);
  if (p.status !== 'published' && p.status !== 'pending') continue;

  const where = `${p.id}`;
  for (const key of ['id', 'title', 'categories', 'image', 'price', 'checkedAt']) {
    if (p[key] === undefined || p[key] === '') errors.push(`${where}: ${key} 없음`);
  }
  if (!(typeof p.price?.min === 'number' && p.price.min > 0)) errors.push(`${where}: price.min 숫자 없음`);
  const imgBad = imageProblem(p.image);
  if (imgBad) errors.push(`${where}: ${imgBad}`);
  for (const c of p.categories || []) if (!categoryBySlug.has(c)) errors.push(`${where}: 없는 카테고리 ${c}`);
  if (!p.link && !p.affiliateLink) errors.push(`${where}: 판매 링크 없음`);
  if (p.link && (isBlockedLink(p.link) || !isProductUrl(p.link))) errors.push(`${where}: 판매처 상품 페이지가 아닌 링크 ${p.link}`);
  const bad = prohibitedReason(p.title, ...(p.tags || []));
  if (bad) errors.push(`${where}: 금지 품목 ${bad}`);
  for (const t of [p.title, p.summary, p.caution, p.price?.text, ...p.specs.flat()]) {
    const prob = textProblem(t);
    if (prob) errors.push(`${where}: ${prob}`);
  }
  if (p.originalPrice && p.originalPrice < p.price?.min) errors.push(`${where}: 정가가 판매가보다 낮음`);
  if (!p.affiliateLink) warnings.push(p.id);
  p.network ||= networkOf(p.affiliateLink || '');
  p.discountRate ||= discountOf(p.price?.min, p.originalPrice) || undefined;
}
if (errors.length) {
  console.error(`빌드 중단: 규칙 위반 ${errors.length}건 (AGENTS.md 참고)`);
  for (const e of errors.slice(0, 80)) console.error(`  - ${e}`);
  process.exit(1);
}

const age = (p) => daysBetween(p.checkedAt, TODAY);
const isLive = (p) => p.status === 'published';
const isFresh = (p) => isLive(p) && age(p) <= rules.staleDays;
const isListed = (p) => isLive(p) && age(p) <= rules.expireDays;
const products = allProducts.filter(isLive);
const listed = products.filter(isListed);
const pending = allProducts.filter((p) => p.status === 'pending');

// Posts only show products that are still live; empty posts are skipped.
const posts = allPosts
  .map((post) => ({ ...post, items: post.items.filter((i) => productById.get(i.product) && isLive(productById.get(i.product))) }))
  .filter((post) => post.items.length);

// ---------- helpers ----------
const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const money = (n, cur) => (cur === 'USD' ? `$${n.toFixed(2)}` : won(n));
const enc = (s) => encodeURIComponent(s);
const tagHref = (t) => `/tags/${enc(t)}.html`;
const kwSlug = (k) => k.replace(/\s+/g, '-');
const kwHref = (k) => `/k/${enc(kwSlug(k))}.html`;
const productHref = (p) => `/p/${p.id}.html`;
const catHref = (slug) => `/categories/${slug}.html`;
const postHref = (post) => `/posts/${post.slug}.html`;
const buyHref = (p) => p.affiliateLink || p.link || '';
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}.${d}`;
}
function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = '일월화수목금토'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

function priceParts(p) {
  const pr = p.price;
  if (pr.text) return { main: pr.text, sub: '' };
  if (pr.max && pr.max !== pr.min) return { main: money(pr.min, pr.currency), sub: `~ ${money(pr.max, pr.currency)}` };
  return { main: money(pr.min, pr.currency), sub: '' };
}
// Sort key in KRW; USD prices are roughly converted only for ordering.
const priceKey = (p) => (p.price.currency === 'USD' ? p.price.min * 1400 : p.price.min);
const lowestOf = (p) => Math.min(...(p.priceHistory || []).map((h) => h.price), p.price.min);

function autoSummary(p) {
  if (p.summary) return p.summary;
  const parts = [`${p.store || '판매처'}에서 ${priceParts(p).main}`];
  if (p.discountRate) parts.push(`정가 대비 ${p.discountRate}% 할인`);
  else if (p.priceDropRate) parts.push(`최근 기록보다 ${p.priceDropRate}% 내린 가격`);
  if (p.badges?.length) parts.push(p.badges.join('·'));
  return `${parts.join(', ')}에 판매 중입니다.`;
}

const img = (p, cls = '', eager = false) =>
  `<img class="${cls}" src="${esc(p.image)}" alt="${esc(p.title)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer">`;

function buyButton(p, cls = 'btn btn-buy') {
  const href = buyHref(p);
  if (!href) return `<span class="${cls} is-disabled" aria-disabled="true">판매처 링크 준비 중</span>`;
  return `<a class="${cls}" href="${esc(href)}" target="_blank" rel="sponsored nofollow noopener">${esc(p.store || '판매처')}에서 보기 <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3h8v8M13 3 3 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`;
}

// Discount from list price, or else the drop against our own recent price records.
const rateOf = (p) => p.discountRate || p.priceDropRate || 0;
const isGoldbox = (p) => (p.badges || []).includes('골드박스');
const rateChip = (p, cls = 'chip-rate') => (p.discountRate ? `<span class="${cls}">${p.discountRate}%</span>`
  : p.priceDropRate ? `<span class="${cls} is-drop" title="최근 기록 대비 인하">↓${p.priceDropRate}%</span>`
  : isGoldbox(p) ? `<span class="${cls} is-deal">특가</span>` : '');

function priceBlock(p, cls = 'price') {
  const { main, sub } = priceParts(p);
  const rate = p.discountRate ? `<span class="rate">${p.discountRate}%</span>`
    : p.priceDropRate ? `<span class="rate rate-drop" title="최근 기록 대비 인하">↓${p.priceDropRate}%</span>` : '';
  return `<div class="${cls}">${rate}<strong>${esc(main)}</strong>${sub ? `<span class="price-sub">${esc(sub)}</span>` : ''}${p.originalPrice ? `<del>${money(p.originalPrice, p.price.currency)}</del>` : ''}</div>`;
}

function card(p, order = 0) {
  const cat = categoryBySlug.get(p.categories[0]);
  const stale = age(p) > rules.staleDays;
  return `<article class="card" data-price="${priceKey(p)}" data-rate="${rateOf(p)}" data-order="${order}" data-cat="${cat.slug}">
  <a class="card-media" href="${productHref(p)}" tabindex="-1" aria-hidden="true">${img(p)}${rateChip(p)}</a>
  <div class="card-body">
    <p class="card-meta"><a class="card-cat" href="${catHref(cat.slug)}">${esc(cat.name)}</a>${p.store ? `<span>${esc(p.store)}</span>` : ''}</p>
    <h3 class="card-title"><a href="${productHref(p)}">${esc(p.title)}</a></h3>
    ${priceBlock(p)}
    <div class="card-foot">${(p.badges || []).slice(0, 2).map((b) => `<span class="pill">${esc(b)}</span>`).join('')}<span class="checked${stale ? ' is-stale' : ''}">${shortDate(p.checkedAt)} 확인</span></div>
    ${buyButton(p, 'btn btn-buy btn-sm')}
  </div>
</article>`;
}

const grid = (list, attrs = '') =>
  `<div class="grid"${attrs}>${list.map((p, i) => card(p, i)).join('\n')}</div>`;

function disclosure(list = []) {
  const coupang = list.some((p) => p.network === 'coupang');
  const text = [coupang ? site.coupangDisclosure : '', site.disclosure, site.priceNotice].filter(Boolean).join(' ');
  return `<aside class="disclosure"><svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 4.6v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><p>${esc(text)}</p></aside>`;
}

const searchIcon = '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m14 14 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function breadcrumb(items) {
  const html = `<nav class="crumb" aria-label="위치">${items.map(([name, href], i) =>
    (href && i < items.length - 1 ? `<a href="${href}">${esc(name)}</a>` : `<span>${esc(name)}</span>`)).join('<span>/</span>')}</nav>`;
  const ld = jsonLd({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, href], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(href ? { item: site.url + href } : {}) })),
  });
  return html + ld;
}

const itemListLd = (list) => jsonLd({
  '@context': 'https://schema.org', '@type': 'ItemList',
  itemListElement: list.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: site.url + productHref(p), name: p.title })),
});

function layout({ title, description, path: pagePath, body, active = '', image = '', bodyClass = '', noindex = false, head = '' }) {
  const fullTitle = title ? `${title} | ${site.name}` : `${site.name} · 오늘의 할인 상품 모음`;
  const url = site.url + pagePath;
  const nav = [
    `<a class="nav-today" href="/today.html"${active === 'today' ? ' aria-current="page"' : ''}><span class="dot" aria-hidden="true"></span>오늘의 할인</a>`,
    ...categories.map((c) => `<a href="${catHref(c.slug)}"${active === c.slug ? ' aria-current="page"' : ''}>${esc(c.name)}</a>`),
    `<a href="/tags/"${active === 'tags' ? ' aria-current="page"' : ''}>태그</a>`,
  ].join('');
  const v = site.verification || {};
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.description)}">
${noindex ? '<meta name="robots" content="noindex, follow">' : `<link rel="canonical" href="${esc(url)}">`}
${site.ga4 && !noindex ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(site.ga4)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(site.ga4)}')</script>
` : ''}
${v.naver ? `<meta name="naver-site-verification" content="${esc(v.naver)}">\n` : ''}${v.google ? `<meta name="google-site-verification" content="${esc(v.google)}">\n` : ''}<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(title || site.name)}">
<meta property="og:description" content="${esc(description || site.description)}">
<meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}">\n` : ''}<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111318" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)}" href="/rss.xml">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/assets/styles.css?v=${ASSET_VERSION}">
<script src="/assets/app.js?v=${ASSET_VERSION}" defer></script>
${head}</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">본문으로 건너뛰기</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="logo" href="/" aria-label="${esc(site.name)} 홈">
      <svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M9 13.5 16 8l7 5.5V23a1 1 0 0 1-1 1h-4v-5h-4v5h-4a1 1 0 0 1-1-1z" fill="var(--logo-ink)"/></svg>
      <span>${esc(site.name)}</span>
    </a>
    <form class="search" action="/search.html" role="search">
      ${searchIcon}
      <input type="search" name="q" placeholder="상품, 브랜드, 태그 검색" aria-label="상품 검색" autocomplete="off" enterkeyhint="search">
    </form>
  </div>
  <nav class="wrap cat-nav" aria-label="메뉴">${nav}</nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="logo logo-sm" href="/"><span>${esc(site.name)}</span></a>
      <p class="muted">${esc(site.tagline)}. 매일 판매처 가격을 다시 확인하고, 할인율이 높은 상품부터 보여줍니다.</p>
    </div>
    <div class="footer-links">
      <a href="/today.html">오늘의 할인</a>
      ${categories.map((c) => `<a href="${catHref(c.slug)}">${esc(c.title)}</a>`).join('')}
      <a href="/tags/">태그</a>
      <a href="/rss.xml">RSS</a>
    </div>
  </div>
  <div class="wrap footer-legal">
    <p>${esc(site.coupangDisclosure)}</p>
    <p>${esc(site.disclosure)} ${esc(site.priceNotice)}</p>
    <p>© ${TODAY.slice(0, 4)} ${esc(site.name)}</p>
  </div>
</footer>
</body>
</html>
`;
}

// ---------- derived indexes ----------
// Recommended order: items that earn (affiliate link) first, then discount / price drop / goldbox.
const dealScore = (p) => rateOf(p) + (isGoldbox(p) ? 15 : 0);
const earnScore = (p) => (p.affiliateLink ? 1000 : 0) + dealScore(p);
const byRate = (a, b) => earnScore(b) - earnScore(a) || b.checkedAt.localeCompare(a.checkedAt);
const byNewest = (a, b) => b.checkedAt.localeCompare(a.checkedAt) || dealScore(b) - dealScore(a);
const productsByCategory = new Map(categories.map((c) => [c.slug, []]));
const productsByTag = new Map();
for (const p of listed) {
  for (const c of p.categories) productsByCategory.get(c).push(p);
  for (const t of p.tags) {
    if (!productsByTag.has(t)) productsByTag.set(t, []);
    productsByTag.get(t).push(p);
  }
}
const postsByProduct = new Map();
for (const post of posts) {
  for (const item of post.items) {
    if (!postsByProduct.has(item.product)) postsByProduct.set(item.product, []);
    postsByProduct.get(item.product).push(post);
  }
}
const tagsSorted = [...productsByTag.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko'));
// Today's deals: only what the last sweep re-checked, discounts and goldbox first.
// staleDays(3일) 를 그대로 쓰면 어제·그저께 확인한 값이 섞여 "오늘" 이 아니게 된다.
// 기준을 달력상의 오늘로 잡으면 수집 전 새벽에 목록이 비므로, 가장 최근 확인일을 쓴다.
const lastChecked = listed.reduce((m, p) => (p.checkedAt > m ? p.checkedAt : m), '2000-01-01');
const checkedLast = listed.filter((p) => p.checkedAt === lastChecked).sort(byRate);
const todayDeals = (checkedLast.length ? checkedLast : [...listed].sort(byNewest)).slice(0, rules.todayMax);

// Keyword landing pages: trending terms + popular tags, only when they match products.
const keywordPages = new Map();
for (const kw of site.trending || []) {
  const words = kw.toLowerCase().split(/\s+/);
  const hits = listed.filter((p) => {
    const hay = `${p.title} ${p.tags.join(' ')}`.toLowerCase().replace(/\s+/g, '');
    return words.every((w) => hay.includes(w));
  });
  if (hits.length) keywordPages.set(kw, hits.sort(byRate));
}
const kwLink = (k) => (keywordPages.has(k) ? kwHref(k) : `/search.html?q=${enc(k)}`);

function tagChips(list, cls = 'tags') {
  return `<div class="${cls}">${list.map((t) => `<a href="${tagHref(t)}">#${esc(t)}</a>`).join('')}</div>`;
}
const trendingChips = () => `<ol class="trending">${(site.trending || []).map((k, i) =>
  `<li><a href="${kwLink(k)}"><span class="rank">${i + 1}</span>${esc(k)}</a></li>`).join('')}</ol>`;

function postCard(post) {
  const items = post.items.map((i) => productById.get(i.product));
  const thumbs = items.slice(0, 3).map((p) => `<span>${img(p)}</span>`).join('');
  return `<a class="post-card" href="${postHref(post)}">
  <div class="post-thumbs">${thumbs}</div>
  <div class="post-card-body">
    <span class="kicker">${post.kind === 'guide' ? '구매 가이드' : '오늘의 할인'} · ${shortDate(post.date)}</span>
    <h3>${esc(post.title)}</h3>
    <p>${esc(post.description)}</p>
    <span class="more">상품 ${items.length}개 보기 →</span>
  </div>
</a>`;
}

const sortBar = (count, { def = 'order', filters = null } = {}) => `<div class="toolbar">
  <p class="count"><strong data-count>${count}</strong>개 상품</p>
  <label class="sort"><span class="sr-only">정렬</span>
    <select data-sort>
      <option value="order"${def === 'order' ? ' selected' : ''}>추천순</option>
      <option value="rate-desc"${def === 'rate-desc' ? ' selected' : ''}>할인율 높은순</option>
      <option value="price-asc">낮은 가격순</option>
      <option value="price-desc">높은 가격순</option>
    </select>
  </label>
</div>${filters ? `<div class="filter-chips" role="group" aria-label="카테고리 필터"><button type="button" data-filter="" aria-pressed="true">전체</button>${filters.map(([slug, name, n]) =>
  `<button type="button" data-filter="${slug}" aria-pressed="false">${esc(name)}<span>${n}</span></button>`).join('')}</div>` : ''}`;

function specTable(specs = []) {
  if (!specs.length) return '';
  return `<dl class="specs">${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
function listBox({ title, items }, tone) {
  return `<div class="box box-${tone}"><strong>${esc(title)}</strong><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
}

// ---------- pages ----------
const pages = new Map();
const lastmod = new Map();
const add = (file, html, mod) => { pages.set(file, html); if (mod) lastmod.set(file, mod); };

// Home
{
  const top = todayDeals.slice(0, 12);
  const lead = top[0];
  const mosaic = top.slice(1, 5);
  const catRows = categories.map((c) => {
    const list = [...productsByCategory.get(c.slug)].sort(byRate).slice(0, 4);
    if (!list.length) return '';
    return `<section class="cat-row">
  <div class="section-head"><div><h3>${esc(c.title)}</h3></div><a class="link-more" href="${catHref(c.slug)}">${productsByCategory.get(c.slug).length}개 전체 →</a></div>
  ${grid(list)}
</section>`;
  }).join('\n');

  const body = lead ? `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker"><span class="dot" aria-hidden="true"></span>${longDate(lastChecked)} 가격 확인</p>
      <h1>매일 가격을 확인한<br>할인 상품, 할인율 높은 순으로</h1>
      <p class="lead">쿠팡 골드박스와 주요 쇼핑몰 특가를 매일 다시 확인해서, 지금 할인 중인 생활용품만 모았습니다.</p>
      <div class="actions">
        <a class="btn btn-primary" href="/today.html">오늘의 할인 전체 보기</a>
        <a class="btn btn-ghost" href="#trending">인기 검색어</a>
      </div>
      <ul class="hero-points">
        <li>매일 판매처 가격 재확인</li>
        <li>할인율·최근 최저가 표시</li>
        <li>성인·주류 등 제외</li>
      </ul>
    </div>
    <div class="hero-visual">
      <a class="hero-lead" href="${productHref(lead)}">
        <span class="hero-lead-img">${img(lead, '', true)}</span>
        <span class="hero-lead-body">
          <span class="badge">${rateOf(lead) ? '오늘 할인율 1위' : '오늘의 특가'}</span>
          <strong>${esc(lead.title)}</strong>
          ${priceBlock(lead)}
        </span>
      </a>
      <div class="hero-mosaic">${mosaic.map((p) => `<a href="${productHref(p)}" title="${esc(p.title)}">${img(p)}${rateChip(p)}</a>`).join('')}</div>
    </div>
  </div>
</section>

<section class="section section-tight-top" id="trending">
  <div class="wrap">
    <div class="section-head"><div><h2>인기 검색어</h2></div></div>
    ${trendingChips()}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head">
      <div><p class="kicker">할인율 높은 순</p><h2>오늘의 할인 TOP</h2></div>
      <a class="link-more" href="/today.html">${todayDeals.length}개 전체 →</a>
    </div>
    ${grid(top)}
  </div>
</section>

<section class="section section-alt">
  <div class="wrap">
    <div class="section-head"><div><h2>카테고리별 할인</h2></div></div>
    <div class="cat-chips">${categories.map((c) => `<a href="${catHref(c.slug)}">${esc(c.title)}<span>${productsByCategory.get(c.slug).length}</span></a>`).join('')}</div>
    ${catRows}
  </div>
</section>

${posts.length ? `<section class="section">
  <div class="wrap">
    <div class="section-head"><div><h2>날짜별 할인 모음</h2></div></div>
    <div class="post-list">${posts.slice(0, 6).map(postCard).join('\n')}</div>
  </div>
</section>` : ''}

<section class="section">
  <div class="wrap">
    <div class="section-head"><div><h2>많이 찾는 태그</h2></div><a class="link-more" href="/tags/">전체 태그 →</a></div>
    ${tagChips(tagsSorted.slice(0, 20).map(([t]) => t))}
    ${disclosure(top)}
  </div>
</section>` : '<div class="wrap"><p class="empty">곧 첫 할인 상품이 올라옵니다.</p></div>';
  const head = jsonLd({
    '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: `${site.url}/`,
    potentialAction: { '@type': 'SearchAction', target: `${site.url}/search.html?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
  });
  add('index.html', layout({ title: '', path: '/', body, image: lead?.image, head }), lastChecked);
}

// Today's deals
{
  const counts = new Map();
  for (const p of todayDeals) counts.set(p.categories[0], (counts.get(p.categories[0]) || 0) + 1);
  const filters = categories.filter((c) => counts.get(c.slug)).map((c) => [c.slug, c.name, counts.get(c.slug)]);
  const body = `
<div class="wrap">
  ${breadcrumb([['홈', '/'], ['오늘의 할인', '/today.html']])}
  <header class="page-head">
    <p class="kicker"><span class="dot" aria-hidden="true"></span>${longDate(lastChecked)} 업데이트</p>
    <h1>오늘의 할인</h1>
    <p class="lead">${longDate(lastChecked)}에 가격을 다시 확인한 상품만 모았습니다. 할인율·가격 인하 폭이 큰 상품과 쿠팡 골드박스 특가를 먼저 보여드려요.</p>
  </header>
  ${sortBar(todayDeals.length, { def: 'rate-desc', filters })}
  ${grid(todayDeals, ' data-sortable')}
  ${disclosure(todayDeals)}
</div>`;
  add('today.html', layout({
    title: `오늘의 할인 ${todayDeals.length}개 (${shortDate(lastChecked)})`,
    description: `${longDate(lastChecked)} 기준 할인 상품 ${todayDeals.length}개. 쿠팡 골드박스·오늘의 특가 등 할인율 높은 순으로 정리했습니다.`,
    path: '/today.html', body, active: 'today', image: todayDeals[0]?.image, head: itemListLd(todayDeals),
  }), lastChecked);
}

// Posts
for (const post of posts) {
  const items = post.items.map((i) => ({ ...i, p: productById.get(i.product) }));
  const catCount = new Map();
  for (const { p } of items) {
    const c = p.categories[0];
    catCount.set(c, (catCount.get(c) || 0) + 1);
  }
  const summary = `<div class="stat-row">${[...catCount].map(([c, n]) =>
    `<span><strong>${n}</strong>${esc(categoryBySlug.get(c).name)}</span>`).join('')}</div>`;

  let content;
  if (post.kind === 'guide') {
    const toc = `<ol class="toc">${items.map(({ p }, i) =>
      `<li><a href="#item-${i + 1}">${esc(p.title)}</a></li>`).join('')}</ol>`;
    const sections = items.map(({ p, body, priceNote, specs, pros, cons }, i) => `
<section class="guide-item" id="item-${i + 1}">
  <a class="guide-media" href="${productHref(p)}">${img(p)}</a>
  <div class="guide-body">
    <p class="kicker">${String(i + 1).padStart(2, '0')} · ${esc(categoryBySlug.get(p.categories[0]).name)}</p>
    <h2><a href="${productHref(p)}">${esc(p.title)}</a></h2>
    <p class="verdict">${esc(autoSummary(p))}</p>
    ${body ? `<p>${esc(body)}</p>` : ''}
    <div class="buy-box">
      <div>${priceBlock(p, 'price price-lg')}<p class="muted small">${esc(priceNote || '')}${priceNote ? ' · ' : ''}${shortDate(p.checkedAt)} 확인</p></div>
      ${buyButton(p)}
    </div>
    ${specTable(specs || p.specs)}
    ${pros || cons ? `<div class="procon">${pros ? listBox(pros, 'good') : ''}${cons ? listBox(cons, 'bad') : ''}</div>` : ''}
  </div>
</section>`).join('\n');
    content = `${toc}${sections}`;
  } else {
    const lead = (post.featured && productById.get(post.featured) && isLive(productById.get(post.featured)))
      ? productById.get(post.featured) : items[0].p;
    const rest = items.map((i) => i.p).filter((p) => p !== lead);
    content = `
<section class="feature">
  <a class="feature-media" href="${productHref(lead)}">${img(lead, '', true)}</a>
  <div class="feature-body">
    <span class="badge">대표 상품</span>
    <h2><a href="${productHref(lead)}">${esc(lead.title)}</a></h2>
    <p class="verdict">${esc(autoSummary(lead))}</p>
    ${priceBlock(lead, 'price price-lg')}
    <p class="muted small">${shortDate(lead.checkedAt)} 가격 확인 · ${esc(lead.store || '')}</p>
    ${specTable(lead.specs)}
    ${lead.caution ? `<p class="caution"><strong>구매 전 체크</strong> ${esc(lead.caution)}</p>` : ''}
    ${buyButton(lead)}
  </div>
</section>
${rest.length ? `${sortBar(rest.length)}${grid(rest, ' data-sortable')}` : ''}`;
  }

  const list = items.map((i) => i.p);
  const body = `
<div class="wrap${post.kind === 'guide' ? ' narrow-head' : ''}">
  ${breadcrumb([['홈', '/'], [post.kind === 'guide' ? '구매 가이드' : '날짜별 할인', post.kind === 'guide' ? null : '/today.html'], [post.title, postHref(post)]])}
  <header class="page-head">
    <p class="kicker">${longDate(post.date)}</p>
    <h1>${esc(post.title)}</h1>
    <p class="lead">${esc(post.intro || post.description)}</p>
    ${summary}
  </header>
  ${disclosure(list)}
</div>
<div class="wrap${post.kind === 'guide' ? ' guide' : ''}">
${content}
</div>`;
  add(`posts/${post.slug}.html`, layout({
    title: post.title, description: post.description, path: postHref(post), body,
    image: (productById.get(post.featured) || list[0]).image, head: itemListLd(list),
  }), post.date);
}

// Categories
for (const c of categories) {
  const list = [...productsByCategory.get(c.slug)].sort(byRate);
  const related = posts.filter((post) => post.items.some((i) => productById.get(i.product).categories.includes(c.slug)));
  const body = `
<div class="wrap">
  ${breadcrumb([['홈', '/'], [c.title, catHref(c.slug)]])}
  <header class="page-head">
    <p class="kicker">카테고리</p>
    <h1>${esc(c.title)} 할인</h1>
    <p class="lead">${esc(c.description)}. 할인율이 높은 순서로 정리했습니다.</p>
  </header>
  ${list.length ? `${sortBar(list.length, { def: 'rate-desc' })}${grid(list, ' data-sortable')}` : '<p class="empty">아직 등록된 상품이 없습니다. 곧 업데이트됩니다.</p>'}
  ${disclosure(list)}
  ${related.length ? `<section class="section-tight"><h2 class="h3">${esc(c.title)} 상품이 포함된 글</h2><div class="post-list">${related.slice(0, 4).map(postCard).join('')}</div></section>` : ''}
</div>`;
  add(`categories/${c.slug}.html`, layout({
    title: `${c.title} 할인 ${list.length}개`, description: `${c.title} 할인 상품 ${list.length}개 · ${c.description}. 매일 가격 확인, 할인율 높은 순.`,
    path: catHref(c.slug), body, active: c.slug, image: list[0]?.image, head: itemListLd(list),
  }), list[0]?.checkedAt);
}

// Tags
add('tags/index.html', layout({
  title: '태그', description: '용도와 상황별로 할인 상품을 다시 찾을 수 있는 태그 목록입니다.', path: '/tags/', active: 'tags',
  body: `
<div class="wrap">
  ${breadcrumb([['홈', '/'], ['태그', '/tags/']])}
  <header class="page-head"><h1>태그</h1><p class="lead">용도와 상황별로 상품을 다시 찾아보세요.</p></header>
  <div class="tags tags-lg">${tagsSorted.map(([t, list]) => `<a href="${tagHref(t)}">#${esc(t)}<span>${list.length}</span></a>`).join('')}</div>
</div>`,
}));
for (const [t, list] of productsByTag) {
  const sorted = [...list].sort(byRate);
  add(`tags/${t}.html`, layout({
    title: `${t} 할인 상품 ${list.length}개`, description: `#${t} 할인 상품 ${list.length}개를 할인율 높은 순으로 모았습니다.`, path: tagHref(t), active: 'tags',
    body: `
<div class="wrap">
  ${breadcrumb([['홈', '/'], ['태그', '/tags/'], [`#${t}`, tagHref(t)]])}
  <header class="page-head"><p class="kicker">태그</p><h1>#${esc(t)}</h1></header>
  ${sortBar(sorted.length, { def: 'rate-desc' })}${grid(sorted, ' data-sortable')}
  ${disclosure(sorted)}
</div>`,
    image: sorted[0].image, head: itemListLd(sorted),
  }), sorted[0].checkedAt);
}

// Keyword landing pages
for (const [kw, list] of keywordPages) {
  add(`k/${kwSlug(kw)}.html`, layout({
    title: `${kw} 할인 최저가 모음 (${shortDate(lastChecked)})`,
    description: `${kw} 할인 상품 ${list.length}개를 할인율 높은 순으로 정리했습니다. ${longDate(lastChecked)} 가격 확인.`,
    path: kwHref(kw),
    body: `
<div class="wrap">
  ${breadcrumb([['홈', '/'], ['인기 검색어', '/#trending'], [kw, kwHref(kw)]])}
  <header class="page-head"><p class="kicker">인기 검색어</p><h1>${esc(kw)} 할인</h1><p class="lead">${longDate(lastChecked)} 기준으로 가격을 확인한 ${esc(kw)} 할인 상품입니다.</p></header>
  ${sortBar(list.length, { def: 'rate-desc' })}${grid(list, ' data-sortable')}
  ${disclosure(list)}
  <section class="section-tight"><h2 class="h3">다른 인기 검색어</h2>${trendingChips()}</section>
</div>`,
    image: list[0].image, head: itemListLd(list),
  }), list[0].checkedAt);
}

// Product pages (every live product, including expired ones which are noindexed)
for (const p of products) {
  const cat = categoryBySlug.get(p.categories[0]);
  const inPosts = postsByProduct.get(p.id) || [];
  const similar = [...productsByCategory.get(cat.slug)].filter((x) => x !== p).sort(byRate).slice(0, 4);
  const expired = !isListed(p);
  const stale = age(p) > rules.staleDays;
  const history = (p.priceHistory || []).slice(-8).reverse();
  const lowest = lowestOf(p);
  // 품목을 아는 상품에만 문답을 붙인다. 전부에 같은 걸 붙이면 중복 콘텐츠가 된다.
  const kwItem = itemOf(p);
  const faqs = faqFor(kwItem);
  const body = `
<div class="wrap">
  ${breadcrumb([['홈', '/'], [cat.title, catHref(cat.slug)], [p.title, productHref(p)]])}
  <section class="product">
    <div class="product-media">${img(p, '', true)}${rateChip(p, 'chip-rate chip-rate-lg')}</div>
    <div class="product-info">
      <p class="kicker">${p.categories.map((c) => `<a href="${catHref(c)}">${esc(categoryBySlug.get(c).name)}</a>`).join(' · ')}${p.store ? ` · ${esc(p.store)}` : ''}</p>
      <h1>${esc(p.title)}</h1>
      <p class="verdict">${esc(autoSummary(p))}</p>
      ${stale ? `<p class="caution"><strong>${expired ? '지난 할인' : '가격 확인 필요'}</strong> ${longDate(p.checkedAt)}에 확인한 가격입니다. 지금은 달라졌을 수 있어요.</p>` : ''}
      <div class="buy-box buy-box-col">
        ${priceBlock(p, 'price price-xl')}
        <p class="muted small">${longDate(p.checkedAt)} 가격 확인${history.length > 1 ? ` · 최근 기록 중 최저 ${money(lowest, p.price.currency)}` : ''}</p>
        ${(p.badges || []).length ? `<p class="pills">${p.badges.map((b) => `<span class="pill">${esc(b)}</span>`).join('')}</p>` : ''}
        ${buyButton(p, 'btn btn-buy btn-lg')}
      </div>
      ${specTable(p.specs)}
      ${history.length > 1 ? `<details class="history"><summary>가격 기록 ${history.length}건</summary><dl class="specs">${history.map((h) => `<div><dt>${shortDate(h.date)}</dt><dd>${money(h.price, p.price.currency)}</dd></div>`).join('')}</dl></details>` : ''}
      ${p.caution ? `<p class="caution"><strong>구매 전 체크</strong> ${esc(p.caution)}</p>` : ''}
      ${p.tags.length ? tagChips(p.tags) : ''}
    </div>
  </section>
  ${faqs.length ? `<section class="section-tight"><h2 class="h3">${esc(kwItem)} 자주 묻는 질문</h2><dl class="faq">${faqs.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl></section>` : ''}
  ${disclosure([p])}
  ${inPosts.length ? `<section class="section-tight"><h2 class="h3">이 상품이 소개된 글</h2><div class="post-list">${inPosts.slice(0, 4).map(postCard).join('')}</div></section>` : ''}
  ${similar.length ? `<section class="section-tight"><h2 class="h3">${esc(cat.title)} 할인 더 보기</h2>${grid(similar)}</section>` : ''}
</div>
<div class="sticky-buy" aria-hidden="true">
  ${priceBlock(p)}
  ${buyButton(p, 'btn btn-buy')}
</div>`;
  const offerValid = new Date(Date.parse(p.checkedAt) + 7 * 86400e3).toISOString().slice(0, 10);
  const head = jsonLd({
    '@context': 'https://schema.org', '@type': 'Product', name: p.title, image: [p.image],
    description: autoSummary(p), category: cat.title,
    offers: {
      '@type': 'Offer', url: site.url + productHref(p), priceCurrency: p.price.currency || 'KRW', price: p.price.min,
      priceValidUntil: offerValid, availability: expired ? 'https://schema.org/LimitedAvailability' : 'https://schema.org/InStock',
      ...(p.store ? { seller: { '@type': 'Organization', name: p.store } } : {}),
    },
  }) + (faqs.length ? jsonLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(([q, a]) => ({
      '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }) : '');
  const pr = priceParts(p).main;
  // 사람들은 상품 정식명이 아니라 "논슬립 옷걸이 최저가"처럼 품목+의도로 검색한다.
  // 품목이 제목에 이미 있으면 되풀이하지 않고 의도 어미만 붙인다.
  const kwMod = (p.tags || []).find((t) => MODIFIERS.includes(t));
  const kwPhrase = kwItem ? [kwMod, kwItem].filter(Boolean).join(' ') : '';
  const squash = (s) => String(s).replace(/\s+/g, '');
  const kwInTitle = kwPhrase && squash(p.title).includes(squash(kwPhrase));
  const titleTail = kwPhrase ? (kwInTitle ? ' 최저가' : ` ${kwPhrase} 최저가`) : '';
  const kwLead = kwPhrase ? `${kwPhrase} 추천, 가격 비교. ` : '';
  add(`p/${p.id}.html`, layout({
    title: `${p.title}${p.discountRate ? ` ${p.discountRate}% 할인` : isGoldbox(p) ? ' 골드박스 특가' : ''} ${pr}${titleTail}`,
    description: `${kwLead}${autoSummary(p)} ${longDate(p.checkedAt)} 가격 확인.`.slice(0, 155),
    path: productHref(p), body, image: p.image, bodyClass: 'has-sticky-buy', noindex: expired, head,
  }), expired ? null : p.checkedAt);
}

// Search
add('search.html', layout({
  title: '검색', description: '할인 상품 검색', path: '/search.html', noindex: true,
  body: `
<div class="wrap">
  <header class="page-head"><h1 data-search-title>검색</h1><p class="lead" data-search-status>상품명, 브랜드, 카테고리, 태그로 찾을 수 있어요.</p></header>
  <div class="grid" data-search-results></div>
  <div data-search-empty hidden>
    <p class="empty">검색 결과가 없습니다. 인기 검색어나 태그를 눌러보세요.</p>
    ${trendingChips()}
  </div>
</div>`,
}));

// Admin dashboard (secret path, not linked, not indexed).
// 쿠팡 실적을 subId 로 갈라 보여준다. 이 사이트가 만든 링크에는 subId 가 붙고,
// 같은 계정으로 다른 데서 만든 링크는 붙지 않는다. 섞어 놓으면 사이트에서 돈이
// 나는 것처럼 오해하게 된다. 방문자 수는 쿠팡이 주지 않으므로 여기 없다.
if (site.adminPath) {
  const stats = readJson('data/stats.json') || { days: [], updatedAt: '' };
  const blank = () => ({ clicks: 0, orders: 0, commission: 0, cancels: 0 });
  const byDate = new Map((stats.days || []).map((d) => [d.date, d]));
  // 빈 날짜를 0 으로 채워야 그래프가 끊기지 않는다.
  const series = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(Date.now() + 9 * 3600e3 - i * 86400e3).toISOString().slice(0, 10);
    series.push(byDate.get(d) || { date: d, site: blank(), other: blank() });
  }
  const all = stats.days || [];
  const sum = (rows, where, k) => rows.reduce((s, r) => s + Number(r[where]?.[k] || 0), 0);
  const won = (n) => `${Math.round(n).toLocaleString()}원`;
  // stats.json 의 시각은 UTC 다. 그대로 찍으면 9시간 어긋나 보인다.
  const kst = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  // 축 눈금은 보기 좋은 단위로 끊는다. 눈금이 5개를 넘으면 숫자가 겹쳐 읽기 어렵다.
  const maxClick = Math.max(1, ...series.map((r) => Math.max(r.site.clicks, r.other.clicks)));
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => maxClick / s <= 4) || 2000;
  const axisTop = Math.ceil(maxClick / step) * step;
  const ticks = [];
  for (let v = 0; v <= axisTop; v += step) ticks.push(v);
  const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  const bar = (cls, n) => `<b class="${cls}${n ? '' : ' zero'}" style="height:${((n / axisTop) * 100).toFixed(1)}%"></b>`;
  const card = (label, rows) => `<div class="stat-card">
    <p class="stat-label">${esc(label)}</p>
    <p class="stat-main">${won(sum(rows, 'site', 'commission'))}</p>
    <p class="stat-sub">클릭 ${sum(rows, 'site', 'clicks')} · 주문 ${sum(rows, 'site', 'orders')}${sum(rows, 'site', 'cancels') ? ` · 취소 ${sum(rows, 'site', 'cancels')}` : ''}</p>
  </div>`;
  const moved = [...series].reverse().filter((r) => r.site.clicks || r.site.orders || r.site.commission || r.other.clicks || r.other.orders || r.other.commission);
  const siteTotal = sum(all, 'site', 'clicks');

  add(`${site.adminPath}.html`, layout({
    title: '실적 대시보드', path: `/${site.adminPath}.html`, noindex: true,
    body: `
<div class="wrap">
  <header class="page-head">
    <h1>실적 대시보드</h1>
    <p class="lead">쿠팡 파트너스 기준입니다. 갱신 ${stats.updatedAt ? esc(kst(stats.updatedAt)) : '없음'} · 누적 ${all.length}일</p>
  </header>

  <div class="refresh-row">
    <button type="button" id="refresh-btn" class="btn btn-primary">지금 새로고침</button>
    <span id="refresh-msg" class="muted small">맥미니에서 쿠팡 실적을 다시 받습니다.</span>
    <button type="button" id="refresh-setup" class="link-btn">주소 설정</button>
  </div>

  <h2 class="h3">${esc(site.name)} <span class="muted small">(subId ${esc(stats.subId || '없음')})</span></h2>
  <div class="stat-row">
    ${card('최근 7일', series.slice(-7))}
    ${card('최근 30일', series)}
    ${card('전체 기간', all)}
  </div>
  ${siteTotal ? '' : `<p class="empty" style="margin-top:14px">아직 ${esc(site.name)}을 거친 클릭이 없습니다. 검색 색인이 되고 유입이 시작되면 여기에 쌓입니다.</p>`}

  <section class="section-tight">
    <h2 class="h3">일별 클릭 (최근 30일)</h2>
    <p class="chart-legend"><span class="sw sw-site"></span>${esc(site.name)}<span class="sw sw-other"></span>기타 경로</p>
    <div class="chart">
      <div class="chart-plot">
        ${ticks.map((v) => `<div class="chart-line" style="bottom:${((v / axisTop) * 100).toFixed(1)}%"><span>${v}</span></div>`).join('')}
        <div class="chart-bars">${series.map((r) => `<i title="${r.date} · ${esc(site.name)} ${r.site.clicks}회 · 기타 ${r.other.clicks}회">${bar('b-site', r.site.clicks)}${bar('b-other', r.other.clicks)}</i>`).join('')}</div>
      </div>
      <div class="chart-x">${[0, 7, 14, 21, 29].map((i) => `<span>${md(series[i].date)}</span>`).join('')}</div>
    </div>
    <p class="muted small">단위: 회 · ${series[0].date} ~ ${series[series.length - 1].date}</p>
  </section>

  <hr class="rule">

  <section class="section-tight">
    <h2 class="h3">기타 경로 <span class="muted small">(${esc(site.name)} 밖에서 만든 링크)</span></h2>
    <div class="stat-row">
      <div class="stat-card"><p class="stat-label">최근 30일</p>
        <p class="stat-main">${won(sum(series, 'other', 'commission'))}</p>
        <p class="stat-sub">클릭 ${sum(series, 'other', 'clicks')} · 주문 ${sum(series, 'other', 'orders')}</p></div>
      <div class="stat-card"><p class="stat-label">전체 기간</p>
        <p class="stat-main">${won(sum(all, 'other', 'commission'))}</p>
        <p class="stat-sub">클릭 ${sum(all, 'other', 'clicks')} · 주문 ${sum(all, 'other', 'orders')}</p></div>
    </div>
  </section>

  <section class="section-tight">
    <h2 class="h3">움직임이 있던 날</h2>
    ${moved.length ? `<table class="stat-table">
      <thead><tr><th>날짜</th><th>${esc(site.name)} 클릭</th><th>${esc(site.name)} 수수료</th><th>기타 클릭</th><th>기타 수수료</th></tr></thead>
      <tbody>${moved.map((r) => `<tr>
        <td>${r.date}</td>
        <td>${r.site.clicks || ''}</td><td class="${r.site.commission < 0 ? 'neg' : ''}">${r.site.commission ? won(r.site.commission) : ''}</td>
        <td>${r.other.clicks || ''}</td><td class="${r.other.commission < 0 ? 'neg' : ''}">${r.other.commission ? won(r.other.commission) : ''}</td>
      </tr>`).join('')}</tbody>
    </table>` : '<p class="empty">최근 30일 기록이 없습니다.</p>'}
  </section>

  <section class="section-tight">
    <h2 class="h3">덧붙임</h2>
    <p class="muted small">
      방문자 수는 여기 없습니다. 쿠팡은 <b>상품을 눌러 쿠팡으로 넘어간 클릭</b>만 세고,
      GitHub Pages 는 접속 로그를 주지 않습니다. GA4 를 붙여 뒀으니 데이터가 쌓이면 여기에 더합니다.<br>
      수집: <code>node scripts/stats.mjs</code> (daily.sh 가 하루 두 번 실행)
    </p>
  </section>

  <script>
  (function () {
    var KEY = 'dhpRefreshUrl';
    var btn = document.getElementById('refresh-btn');
    var msg = document.getElementById('refresh-msg');
    var setup = document.getElementById('refresh-setup');
    // 맥미니에서 연 경우(…ts.net)에는 같은 출처라 바로 부를 수 있다.
    var local = /\\.ts\\.net$/i.test(location.hostname);
    var get = function () { try { return local ? '/api/refresh' : (localStorage.getItem(KEY) || ''); } catch (e) { return ''; } };
    var ask = function () {
      var v = prompt('맥미니 새로고침 주소 (Tailscale 안에서만 닿습니다)', get() || 'https://');
      if (v === null) return '';
      v = v.trim();
      try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) {}
      return v;
    };
    if (local) setup.hidden = true;
    setup.addEventListener('click', function () { if (ask()) msg.textContent = '주소를 저장했습니다.'; });
    btn.addEventListener('click', function () {
      var url = get() || ask();
      if (!url) return;
      btn.disabled = true;
      msg.textContent = '쿠팡에서 실적을 다시 받는 중… 1분쯤 걸립니다.';
      fetch(url, { method: 'POST' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(function (o) {
          if (!o.r.ok || !o.j.ok) throw new Error(o.j.error || ('HTTP ' + o.r.status));
          msg.textContent = '갱신 완료 · ' + (o.j.text || '') + ' — 이 페이지에 반영되기까지 1분쯤 더 걸립니다.';
        })
        .catch(function (e) {
          msg.textContent = '실패: ' + e.message
            + (local ? '' : ' — 브라우저가 공개 사이트에서 사설망 호출을 막았을 수 있습니다. 맥미니 주소로 이 페이지를 열면 그냥 됩니다.');
        })
        .then(function () { btn.disabled = false; });
    });
  })();
  </script>

</div>`,
  }));
}



// Review queue (not linked, not indexed)
add('review.html', layout({
  title: `검수 대기 ${pending.length}개`, path: '/review.html', noindex: true,
  body: `
<div class="wrap">
  <header class="page-head"><h1>검수 대기 ${pending.length}개</h1>
  <p class="lead">썸네일과 상품명이 같은 상품인지, 가격이 맞는지, 금지 품목이 아닌지만 보세요. 승인: <code>node scripts/review.mjs approve all</code> · 반려: <code>node scripts/review.mjs reject ID 사유</code></p></header>
  <div class="review-list">${pending.map((p) => `<article class="review-item">
    <a class="review-img" href="${esc(p.link)}" target="_blank" rel="noopener">${img(p)}</a>
    <div>
      <p class="kicker">${esc(p.store || '')} · ${esc(p.source || '')} · ${esc(categoryBySlug.get(p.categories[0])?.name || '')}</p>
      <h3>${esc(p.title)}</h3>
      ${priceBlock(p, 'price price-lg')}
      <p class="muted small">${p.affiliateLink ? `제휴 링크 ✓ (${esc(p.network || '')})` : '<b>제휴 링크 없음</b>'} · ${shortDate(p.checkedAt)}</p>
      <p><code class="review-id">${esc(p.id)}</code></p>
    </div>
  </article>`).join('')}</div>
</div>`,
}));

// 404
add('404.html', layout({
  title: '페이지를 찾을 수 없습니다', path: '/404.html', noindex: true,
  body: `
<div class="wrap">
  <header class="page-head center">
    <p class="kicker">404</p>
    <h1>할인이 끝났거나 없는 페이지예요</h1>
    <p class="lead">오늘의 할인에서 지금 할인 중인 상품을 확인해 보세요.</p>
    <div class="actions center"><a class="btn btn-primary" href="/today.html">오늘의 할인</a><a class="btn btn-ghost" href="/">홈으로</a></div>
  </header>
</div>`,
}));

// ---------- write ----------
for (const d of GENERATED_DIRS) {
  const dir = path(d);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
for (const [rel, html] of pages) {
  const file = path(rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

const searchIndex = listed.map((p) => ({
  t: [p.title, p.store, ...p.tags, ...p.categories.map((c) => categoryBySlug.get(c).title)].join(' ').toLowerCase(),
  r: p.discountRate || 0,
  html: card(p),
})).sort((a, b) => b.r - a.r);
writeFileSync(path('assets/search.json'), JSON.stringify(searchIndex));

const NOT_IN_SITEMAP = new Set(['404.html', 'search.html', 'review.html',
  ...(site.adminPath ? [`${site.adminPath}.html`] : [])]);
const urlOf = (k) => (k === 'index.html' ? '/' : k === 'tags/index.html' ? '/tags/' : `/${k.split('/').map(enc).join('/')}`);
const sitemapKeys = [...pages.keys()].filter((k) => !NOT_IN_SITEMAP.has(k) && !(k.startsWith('p/') && !lastmod.has(k)));
writeFileSync(path('sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapKeys.map((k) =>
    `  <url><loc>${site.url}${urlOf(k)}</loc>${lastmod.get(k) ? `<lastmod>${lastmod.get(k)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
// 관리자 페이지는 '/admin' 접두사로만 막는다. robots.txt 는 공개 파일이라
// 전체 경로를 적으면 숨긴 주소를 스스로 알려 주는 꼴이 된다.
const robotsDeny = ['/review.html', '/search.html', ...(site.adminPath ? ['/admin'] : [])];
writeFileSync(path('robots.txt'), `User-agent: *\nAllow: /\n${robotsDeny.map((d) => `Disallow: ${d}`).join('\n')}\nSitemap: ${site.url}/sitemap.xml\n`);

const rssItems = [...listed].sort((a, b) => (b.addedAt || b.checkedAt).localeCompare(a.addedAt || a.checkedAt)).slice(0, 50);
const rfc822 = (d) => new Date(`${d}T09:00:00+09:00`).toUTCString();
writeFileSync(path('rss.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(site.name)}</title><link>${site.url}/</link><description>${esc(site.description)}</description><language>ko</language>
<lastBuildDate>${rfc822(lastChecked)}</lastBuildDate>
${rssItems.map((p) => `<item><title>${esc(`${p.title}${p.discountRate ? ` ${p.discountRate}% 할인` : ''}`)}</title><link>${site.url}${productHref(p)}</link><guid>${site.url}${productHref(p)}</guid><pubDate>${rfc822(p.addedAt || p.checkedAt)}</pubDate><description>${esc(autoSummary(p))}</description></item>`).join('\n')}
</channel></rss>
`);

console.log(`생성 완료: 페이지 ${pages.size}개 · 게시 ${products.length} (목록 노출 ${listed.length}, 오늘의 할인 ${todayDeals.length}) · 검수 대기 ${pending.length} · 키워드 페이지 ${keywordPages.size}`);
const coupang = products.filter((p) => p.network === 'coupang').length;
const lp = products.filter((p) => p.network === 'linkprice').length;
console.log(`제휴 링크: 쿠팡 ${coupang} · 링크프라이스 ${lp} · 없음 ${warnings.length}`);
