// 인기 검색어(site.json 의 trending)를 상품으로 채우고, 비어 가는 키워드를 알려준다.
//
//   node scripts/trending.mjs          # 오늘 차례인 키워드로 쿠팡 검색 → data/inbox/
//   node scripts/trending.mjs --check  # 수집 없이 키워드별 상품 수만 센다
//
// 전에는 이 일을 사람(또는 에이전트)이 주 1~2 회 하기로 돼 있었는데 아무도 하지 않아,
// 10월 24일에 넣은 키워드가 그대로 남아 있었다. daily.sh 가 대신 돌린다.
//
// 쿠팡 검색은 호출 한도가 작다. 그래서 한 번에 다 돌리지 않고 날짜로 갈라
// 하루 몇 개씩 돌아가며 받는다. 16 개면 나흘에 한 바퀴다.

import { execFileSync } from 'node:child_process';
import { readJson } from './lib/store.mjs';
import { today } from './lib/rules.mjs';

const PER_RUN = 4;
const CHECK_ONLY = process.argv.includes('--check');

const site = readJson('data/site.json') || {};
const trending = site.trending || [];
if (!trending.length) {
  console.log('인기 검색어가 비어 있습니다 (site.json 의 trending)');
  process.exit(0);
}

// 키워드마다 지금 걸리는 상품이 몇 개인지. 0 이면 /k/ 페이지가 아예 안 생긴다.
const products = readJson('data/products.json') || [];
const live = (Array.isArray(products) ? products : products.products || [])
  .filter((p) => p.status === 'published');
const squash = (s) => String(s).replace(/\s+/g, '').toLowerCase();
const count = (kw) => {
  const k = squash(kw);
  return live.filter((p) => squash(`${p.title} ${(p.tags || []).join(' ')}`).includes(k)).length;
};

const counts = trending.map((kw) => [kw, count(kw)]);
const empty = counts.filter(([, n]) => n === 0).map(([kw]) => kw);
const thin = counts.filter(([, n]) => n > 0 && n < 3).map(([kw, n]) => `${kw}(${n})`);

console.log(`인기 검색어 ${trending.length}개 · 상품 없음 ${empty.length} · 3개 미만 ${thin.length}`);
if (empty.length) console.log(`  비어 있음: ${empty.join(', ')}`);
if (thin.length) console.log(`  적음: ${thin.join(', ')}`);

if (CHECK_ONLY) process.exit(0);

// 상품이 없는 키워드를 먼저 채우고, 남는 자리는 날짜로 돌아가며 고른다.
const day = Math.floor(Date.parse(today()) / 86400e3);
const rotation = trending.filter((kw) => !empty.includes(kw));
const picked = [...empty];
for (let i = 0; picked.length < PER_RUN && i < rotation.length; i += 1) {
  picked.push(rotation[(day * PER_RUN + i) % rotation.length]);
}
const words = [...new Set(picked)].slice(0, PER_RUN);

console.log(`검색: ${words.join(', ')}`);
try {
  const out = execFileSync(process.execPath, ['scripts/coupang.mjs', 'search', ...words], { encoding: 'utf8' });
  process.stdout.write(out);
} catch (err) {
  console.error(`  검색 실패: ${String(err.message).slice(0, 120)}`);
  process.exit(1);
}
