// Daily Home Pick static site generator.
// Reads data/*.json and writes every HTML page, sitemap, robots and search index.
// Usage: node scripts/build.mjs   (no dependencies)

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const site = readJson('data/site.json');
const categories = readJson('data/categories.json');
const products = readJson('data/products.json');
const posts = readJson('data/posts.json').sort((a, b) => b.date.localeCompare(a.date));

const ASSET_VERSION = Date.now().toString(36);
const GENERATED_DIRS = ['posts', 'categories', 'tags', 'p'];
const warnings = [];

// ---------- validation ----------
const productById = new Map();
const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));
for (const p of products) {
  if (productById.has(p.id)) throw new Error(`중복 상품 id: ${p.id}`);
  for (const key of ['id', 'title', 'categories', 'image', 'price', 'checkedAt']) {
    if (p[key] === undefined) throw new Error(`상품 ${p.id ?? '?'}에 ${key} 없음`);
  }
  for (const c of p.categories) if (!categoryBySlug.has(c)) throw new Error(`상품 ${p.id}: 없는 카테고리 ${c}`);
  if (!p.affiliateLink) warnings.push(`파트너스 링크 없음: ${p.id}${p.link ? '' : ' (판매처 링크도 없음)'}`);
  p.tags ??= [];
  p.specs ??= [];
  productById.set(p.id, p);
}
for (const post of posts) {
  for (const item of post.items) {
    if (!productById.has(item.product)) throw new Error(`글 ${post.slug}: 없는 상품 ${item.product}`);
  }
  if (post.featured && !productById.has(post.featured)) throw new Error(`글 ${post.slug}: 없는 대표 상품 ${post.featured}`);
}

// ---------- helpers ----------
const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const tagHref = (t) => `/tags/${encodeURIComponent(t)}.html`;
const productHref = (p) => `/p/${p.id}.html`;
const catHref = (slug) => `/categories/${slug}.html`;
const postHref = (post) => `/posts/${post.slug}.html`;
const buyHref = (p) => p.affiliateLink || p.link || '';

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
  if (pr.max && pr.max !== pr.min) return { main: won(pr.min), sub: `~ ${won(pr.max)}` };
  return { main: won(pr.min), sub: '' };
}
function discountRate(p) {
  if (!p.originalPrice || !p.price.min || p.originalPrice <= p.price.min) return 0;
  return Math.round(((p.originalPrice - p.price.min) / p.originalPrice) * 100);
}
// Sort key in KRW; overseas USD prices are roughly converted only for ordering.
const priceKey = (p) => (p.price.currency === 'USD' ? p.price.min * 1400 : p.price.min);

const img = (p, cls = '', eager = false) =>
  `<img class="${cls}" src="${esc(p.image)}" alt="${esc(p.title)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer">`;

function buyButton(p, cls = 'btn btn-buy') {
  const href = buyHref(p);
  if (!href) return `<span class="${cls} is-disabled" aria-disabled="true">판매처 링크 준비 중</span>`;
  return `<a class="${cls}" href="${esc(href)}" target="_blank" rel="sponsored nofollow noopener">${esc(p.store || '판매처')}에서 보기 <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3h8v8M13 3 3 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`;
}

function priceBlock(p, cls = 'price') {
  const { main, sub } = priceParts(p);
  const rate = discountRate(p);
  return `<div class="${cls}">${rate ? `<span class="rate">${rate}%</span>` : ''}<strong>${esc(main)}</strong>${sub ? `<span class="price-sub">${esc(sub)}</span>` : ''}${p.originalPrice ? `<del>${won(p.originalPrice)}</del>` : ''}</div>`;
}

function card(p, order = 0) {
  const cat = categoryBySlug.get(p.categories[0]);
  return `<article class="card" data-price="${priceKey(p)}" data-order="${order}">
  <a class="card-media" href="${productHref(p)}" tabindex="-1" aria-hidden="true">${img(p)}${p.store ? `<span class="chip-store">${esc(p.store)}</span>` : ''}</a>
  <div class="card-body">
    <a class="card-cat" href="${catHref(cat.slug)}">${esc(cat.name)}</a>
    <h3 class="card-title"><a href="${productHref(p)}">${esc(p.title)}</a></h3>
    ${priceBlock(p)}
    <p class="card-note">${esc(p.summary || '')}</p>
    <div class="card-foot"><span class="checked">${shortDate(p.checkedAt)} 가격 확인</span></div>
    ${buyButton(p, 'btn btn-buy btn-sm')}
  </div>
</article>`;
}

const grid = (list, attrs = '') =>
  `<div class="grid"${attrs}>${list.map((p, i) => card(p, i)).join('\n')}</div>`;

const disclosure = () =>
  `<aside class="disclosure"><svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 4.6v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><p>${esc(site.disclosure)} ${esc(site.priceNotice)}</p></aside>`;

const searchIcon = '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m14 14 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function layout({ title, description, path, body, active = '', image = '', bodyClass = '' }) {
  const fullTitle = title ? `${title} | ${site.name}` : `${site.name} · ${site.tagline}`;
  const url = site.url + path;
  const nav = categories.map((c) =>
    `<a href="${catHref(c.slug)}"${active === c.slug ? ' aria-current="page"' : ''}>${esc(c.name)}</a>`).join('');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title || site.name)}">
<meta property="og:description" content="${esc(description || site.description)}">
<meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}">\n` : ''}<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111318" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/assets/styles.css?v=${ASSET_VERSION}">
<script src="/assets/app.js?v=${ASSET_VERSION}" defer></script>
</head>
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
  <nav class="wrap cat-nav" aria-label="카테고리">${nav}<a href="/tags/"${active === 'tags' ? ' aria-current="page"' : ''}>태그</a></nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="logo logo-sm" href="/"><span>${esc(site.name)}</span></a>
      <p class="muted">${esc(site.tagline)}. 매일 가격을 다시 확인하고, 이미지와 실제 상품명이 맞는 상품만 올립니다.</p>
    </div>
    <div class="footer-links">
      ${categories.map((c) => `<a href="${catHref(c.slug)}">${esc(c.title)}</a>`).join('')}
    </div>
  </div>
  <div class="wrap footer-legal">
    <p>${esc(site.disclosure)}</p>
    <p>${esc(site.priceNotice)}</p>
    <p>© ${new Date().getFullYear()} ${esc(site.name)}</p>
  </div>
</footer>
</body>
</html>
`;
}

// ---------- derived indexes ----------
const productsByCategory = new Map(categories.map((c) => [c.slug, []]));
const productsByTag = new Map();
for (const p of products) {
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
// Newest first: products appearing in newer posts come earlier.
const productDate = (p) => (postsByProduct.get(p.id)?.[0]?.date) || p.checkedAt;
const byNewest = (a, b) => productDate(b).localeCompare(productDate(a));
const tagsSorted = [...productsByTag.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko'));

function tagChips(list, cls = 'tags') {
  return `<div class="${cls}">${list.map((t) => `<a href="${tagHref(t)}">#${esc(t)}</a>`).join('')}</div>`;
}

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

const sortBar = (count, label = '상품') => `<div class="toolbar">
  <p class="count"><strong>${count}</strong>개 ${label}</p>
  <label class="sort"><span class="sr-only">정렬</span>
    <select data-sort>
      <option value="order">추천순</option>
      <option value="price-asc">낮은 가격순</option>
      <option value="price-desc">높은 가격순</option>
    </select>
  </label>
</div>`;

// ---------- pages ----------
const pages = new Map();

// Home
{
  const latest = posts.find((p) => p.kind === 'deals') || posts[0];
  const latestItems = latest.items.map((i) => productById.get(i.product));
  const lead = productById.get(latest.featured) || latestItems[0];
  const mosaic = latestItems.filter((p) => p !== lead).slice(0, 4);
  const catTiles = categories.map((c) => {
    const list = productsByCategory.get(c.slug);
    const cover = list[0];
    return `<a class="cat-tile" href="${catHref(c.slug)}">
  <span class="cat-img">${cover ? img(cover) : ''}</span>
  <span class="cat-text"><strong>${esc(c.title)}</strong><span>${list.length}개 상품</span></span>
</a>`;
  }).join('\n');

  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker"><span class="dot" aria-hidden="true"></span>${longDate(latest.date)} 업데이트</p>
      <h1>${esc(latest.title)}</h1>
      <p class="lead">${esc(latest.description)}</p>
      <div class="actions">
        <a class="btn btn-primary" href="${postHref(latest)}">오늘의 할인 보기</a>
        <a class="btn btn-ghost" href="#categories">카테고리 둘러보기</a>
      </div>
      <ul class="hero-points">
        <li>매일 판매처 가격 재확인</li>
        <li>이미지·상품명 일치 검수</li>
        <li>구매 전 주의점 함께 표기</li>
      </ul>
    </div>
    <div class="hero-visual">
      <a class="hero-lead" href="${productHref(lead)}">
        <span class="hero-lead-img">${img(lead, '', true)}</span>
        <span class="hero-lead-body">
          <span class="badge">오늘의 대표 상품</span>
          <strong>${esc(lead.title)}</strong>
          ${priceBlock(lead)}
        </span>
      </a>
      <div class="hero-mosaic">${mosaic.map((p) => `<a href="${productHref(p)}" title="${esc(p.title)}">${img(p)}</a>`).join('')}</div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head">
      <div><p class="kicker">${shortDate(latest.date)} 가격 확인</p><h2>오늘 확인한 상품</h2></div>
      <a class="link-more" href="${postHref(latest)}">전체 보기 →</a>
    </div>
    ${grid(latestItems.slice(0, 8))}
  </div>
</section>

<section class="section section-alt" id="categories">
  <div class="wrap">
    <div class="section-head"><div><h2>카테고리</h2></div></div>
    <div class="cat-grid">${catTiles}</div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head"><div><h2>최근 글</h2></div></div>
    <div class="post-list">${posts.slice(0, 6).map(postCard).join('\n')}</div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head"><div><h2>많이 찾는 태그</h2></div><a class="link-more" href="/tags/">전체 태그 →</a></div>
    ${tagChips(tagsSorted.slice(0, 16).map(([t]) => t))}
  </div>
</section>`;
  pages.set('index.html', layout({ title: '', path: '/', body, image: lead.image }));
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
    <p class="verdict">${esc(p.summary)}</p>
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
    const lead = productById.get(post.featured) || items[0].p;
    const rest = items.map((i) => i.p).filter((p) => p !== lead);
    content = `
<section class="feature">
  <a class="feature-media" href="${productHref(lead)}">${img(lead, '', true)}</a>
  <div class="feature-body">
    <span class="badge">대표 상품</span>
    <h2><a href="${productHref(lead)}">${esc(lead.title)}</a></h2>
    <p class="verdict">${esc(lead.summary)}</p>
    ${priceBlock(lead, 'price price-lg')}
    <p class="muted small">${shortDate(lead.checkedAt)} 가격 확인 · ${esc(lead.store || '')}</p>
    ${specTable(lead.specs)}
    ${lead.caution ? `<p class="caution"><strong>구매 전 체크</strong> ${esc(lead.caution)}</p>` : ''}
    ${buyButton(lead)}
  </div>
</section>
${sortBar(rest.length)}
${grid(rest, ' data-sortable')}`;
  }

  const body = `
<div class="wrap${post.kind === 'guide' ? ' narrow-head' : ''}">
  <nav class="crumb" aria-label="위치"><a href="/">홈</a><span>/</span><span>${post.kind === 'guide' ? '구매 가이드' : '오늘의 할인'}</span></nav>
  <header class="page-head">
    <p class="kicker">${longDate(post.date)}</p>
    <h1>${esc(post.title)}</h1>
    <p class="lead">${esc(post.intro || post.description)}</p>
    ${summary}
  </header>
  ${disclosure()}
</div>
<div class="wrap${post.kind === 'guide' ? ' guide' : ''}">
${content}
</div>`;
  pages.set(`posts/${post.slug}.html`, layout({
    title: post.title, description: post.description, path: postHref(post), body,
    image: productById.get(post.featured || post.items[0].product).image,
  }));
}

function specTable(specs = []) {
  if (!specs.length) return '';
  return `<dl class="specs">${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
function listBox({ title, items }, tone) {
  return `<div class="box box-${tone}"><strong>${esc(title)}</strong><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
}

// Categories
for (const c of categories) {
  const list = [...productsByCategory.get(c.slug)].sort(byNewest);
  const related = posts.filter((post) => post.items.some((i) => productById.get(i.product).categories.includes(c.slug)));
  const body = `
<div class="wrap">
  <nav class="crumb" aria-label="위치"><a href="/">홈</a><span>/</span><span>${esc(c.title)}</span></nav>
  <header class="page-head page-head-row">
    <div>
      <p class="kicker">카테고리</p>
      <h1>${esc(c.title)}</h1>
      <p class="lead">${esc(c.description)}</p>
    </div>
  </header>
  ${list.length ? `${sortBar(list.length)}${grid(list, ' data-sortable')}` : '<p class="empty">아직 등록된 상품이 없습니다. 곧 업데이트됩니다.</p>'}
  ${disclosure()}
  ${related.length ? `<section class="section-tight"><h2 class="h3">이 카테고리가 포함된 글</h2><div class="post-list">${related.slice(0, 4).map(postCard).join('')}</div></section>` : ''}
</div>`;
  pages.set(`categories/${c.slug}.html`, layout({
    title: c.title, description: `${c.title} 할인 상품 모음 · ${c.description}`, path: catHref(c.slug), body, active: c.slug,
    image: list[0]?.image,
  }));
}

// Tags
pages.set('tags/index.html', layout({
  title: '태그', description: '용도와 상황별로 상품을 다시 찾을 수 있는 태그 목록입니다.', path: '/tags/', active: 'tags',
  body: `
<div class="wrap">
  <nav class="crumb" aria-label="위치"><a href="/">홈</a><span>/</span><span>태그</span></nav>
  <header class="page-head"><h1>태그</h1><p class="lead">용도와 상황별로 상품을 다시 찾아보세요.</p></header>
  <div class="tags tags-lg">${tagsSorted.map(([t, list]) => `<a href="${tagHref(t)}">#${esc(t)}<span>${list.length}</span></a>`).join('')}</div>
</div>`,
}));
for (const [t, list] of productsByTag) {
  const sorted = [...list].sort(byNewest);
  pages.set(`tags/${t}.html`, layout({
    title: `#${t}`, description: `#${t} 태그가 붙은 상품 ${list.length}개`, path: tagHref(t), active: 'tags',
    body: `
<div class="wrap">
  <nav class="crumb" aria-label="위치"><a href="/">홈</a><span>/</span><a href="/tags/">태그</a><span>/</span><span>#${esc(t)}</span></nav>
  <header class="page-head"><p class="kicker">태그</p><h1>#${esc(t)}</h1></header>
  ${sortBar(sorted.length)}${grid(sorted, ' data-sortable')}
  ${disclosure()}
</div>`,
    image: sorted[0].image,
  }));
}

// Product pages
for (const p of products) {
  const cat = categoryBySlug.get(p.categories[0]);
  const inPosts = postsByProduct.get(p.id) || [];
  const similar = productsByCategory.get(cat.slug).filter((x) => x !== p).slice(0, 4);
  const body = `
<div class="wrap">
  <nav class="crumb" aria-label="위치"><a href="/">홈</a><span>/</span><a href="${catHref(cat.slug)}">${esc(cat.title)}</a></nav>
  <section class="product">
    <div class="product-media">${img(p, '', true)}</div>
    <div class="product-info">
      <p class="kicker">${p.categories.map((c) => `<a href="${catHref(c)}">${esc(categoryBySlug.get(c).name)}</a>`).join(' · ')}${p.store ? ` · ${esc(p.store)}` : ''}</p>
      <h1>${esc(p.title)}</h1>
      <p class="verdict">${esc(p.summary || '')}</p>
      <div class="buy-box buy-box-col">
        ${priceBlock(p, 'price price-xl')}
        <p class="muted small">${longDate(p.checkedAt)} 가격 확인 · 판매처 가격은 수시로 바뀝니다</p>
        ${buyButton(p, 'btn btn-buy btn-lg')}
      </div>
      ${specTable(p.specs)}
      ${p.caution ? `<p class="caution"><strong>구매 전 체크</strong> ${esc(p.caution)}</p>` : ''}
      ${p.tags.length ? tagChips(p.tags) : ''}
    </div>
  </section>
  ${disclosure()}
  ${inPosts.length ? `<section class="section-tight"><h2 class="h3">이 상품이 소개된 글</h2><div class="post-list">${inPosts.map(postCard).join('')}</div></section>` : ''}
  ${similar.length ? `<section class="section-tight"><h2 class="h3">${esc(cat.title)} 다른 상품</h2>${grid(similar)}</section>` : ''}
</div>
<div class="sticky-buy" aria-hidden="true">
  ${priceBlock(p)}
  ${buyButton(p, 'btn btn-buy')}
</div>`;
  pages.set(`p/${p.id}.html`, layout({
    title: p.title, description: `${p.summary || p.title} · ${priceParts(p).main}`, path: productHref(p), body,
    image: p.image, bodyClass: 'has-sticky-buy',
  }));
}

// Search
pages.set('search.html', layout({
  title: '검색', description: '상품 검색', path: '/search.html',
  body: `
<div class="wrap">
  <header class="page-head"><h1 data-search-title>검색</h1><p class="lead" data-search-status>상품명, 브랜드, 카테고리, 태그로 찾을 수 있어요.</p></header>
  <div class="grid" data-search-results></div>
  <div data-search-empty hidden>
    <p class="empty">검색 결과가 없습니다. 다른 단어로 찾아보거나 아래 태그를 눌러보세요.</p>
    ${tagChips(tagsSorted.slice(0, 12).map(([t]) => t))}
  </div>
</div>`,
}));

// 404
pages.set('404.html', layout({
  title: '페이지를 찾을 수 없습니다', path: '/404.html',
  body: `
<div class="wrap">
  <header class="page-head center">
    <p class="kicker">404</p>
    <h1>페이지를 찾을 수 없습니다</h1>
    <p class="lead">상품이 내려갔거나 주소가 바뀌었을 수 있어요.</p>
    <div class="actions center"><a class="btn btn-primary" href="/">홈으로</a><a class="btn btn-ghost" href="/search.html">검색하기</a></div>
  </header>
</div>`,
}));

// ---------- write ----------
for (const d of GENERATED_DIRS) {
  const dir = join(ROOT, d);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
for (const [rel, html] of pages) {
  const file = join(ROOT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

const searchIndex = products.map((p) => ({
  t: [p.title, p.store, ...p.tags, ...p.categories.map((c) => categoryBySlug.get(c).title)].join(' ').toLowerCase(),
  d: productDate(p),
  html: card(p),
})).sort((a, b) => b.d.localeCompare(a.d));
writeFileSync(join(ROOT, 'assets/search.json'), JSON.stringify(searchIndex));

const urls = [...pages.keys()].filter((k) => k !== '404.html' && k !== 'search.html')
  .map((k) => k === 'index.html' ? '/' : k === 'tags/index.html' ? '/tags/' : `/${k.split('/').map(encodeURIComponent).join('/')}`);
writeFileSync(join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${site.url}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);

console.log(`생성 완료: 페이지 ${pages.size}개, 상품 ${products.length}개, 글 ${posts.length}개, 태그 ${productsByTag.size}개`);
if (warnings.length) {
  console.log(`\n경고 ${warnings.length}건 (수익이 나지 않는 링크):`);
  for (const w of warnings) console.log(`  - ${w}`);
}
