// 이미 기록 중인 쿠팡 상품의 가격을 다시 잰다. 골드박스·베스트는 목록이 매일 바뀌어
// 한 번 잡힌 상품을 다시 못 보는 일이 많아, 30일 가격 기록이 잘 쌓이지 않았다(2026-11-14 기준 7일↑ 153/2,421).
//
//   node scripts/recheck.mjs            # 기본 6번 검색 (cron 매시간, daily.lock 잡고)
//   node scripts/recheck.mjs --max=3
//   node scripts/recheck.mjs --dry      # 고를 상품만 보여 준다(호출 없음)
//
// 방법: 상품명 그대로 파트너스 검색 API 를 부르고, 결과 중 productId 가 같은 상품만 가격을 갱신한다.
// 결과에 섞여 나온 다른 기록 중 상품도 함께 갱신한다(새 상품은 넣지 않는다 — 수집은 daily.sh 몫).
// 이름이 같아도 productId 가 다르면 다른 판매 페이지라 섞지 않는다.
//
// 검색 API 는 호출 한도가 작다. 한도·오류 응답이 오면 바로 멈추고 2시간 쉰다.
// 상태(시도 기록·쉬는 시각)는 저장소 밖 ~/.local/state/dailyhomepick/recheck.json.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import * as api from './lib/coupang.mjs';
import { loadEnv, today, daysBetween, optionOf } from './lib/rules.mjs';
import { readJson, writeJson, path } from './lib/store.mjs';

loadEnv();
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const MAX = Number(args.find((a) => a.startsWith('--max='))?.split('=')[1]) || 6;
const STATE = join(homedir(), '.local/state/dailyhomepick/recheck.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const date = today();

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { tries: {} };
const saveState = () => { if (!dry) writeFileSync(STATE, JSON.stringify(state, null, 1)); };
if (state.backoffUntil && Date.now() < Date.parse(state.backoffUntil)) {
  console.log(`${new Date().toISOString()} 쉬는 중(${state.backoffUntil}까지)`);
  process.exit(0);
}

const products = readJson('data/products.json');
const pidOf = (p) => /^coupang-(\d+)$/.exec(p.sourceId || p.id || '')?.[1];
const byPid = new Map(products.filter((p) => p.network === 'coupang' && pidOf(p)).map((p) => [pidOf(p), p]));

// 생필품 쪽을 먼저 본다(스레드 최저가 글·사이트 메인에 쓰기 좋은 품목).
const DAILY = new Set(['food', 'living', 'kitchen', 'baby', 'pet', 'beauty']);
const missedLately = (t) => t && t.misses >= 2 && daysBetween(t.lastTry, date) < 14;
const queue = [...byPid.values()]
  .filter((p) => p.status === 'published' && p.checkedAt !== date && state.tries[p.id]?.lastTry !== date && !missedLately(state.tries[p.id]))
  .map((p) => ({ p, n: (p.priceHistory || []).length, daily: (p.categories || []).some((c) => DAILY.has(c)) }))
  // 기록이 이미 있는 상품부터(30일 채우기), 그다음 생필품, 그다음 오래전에 시도한 순.
  .sort((a, b) => (b.n >= 2) - (a.n >= 2) || b.daily - a.daily || b.n - a.n
    || String(state.tries[a.p.id]?.lastTry || '').localeCompare(String(state.tries[b.p.id]?.lastTry || '')));

const targets = [];
for (const x of queue) if (targets.length < MAX) targets.push(x.p);
if (dry) {
  console.log(`대상 후보 ${queue.length}개, 이번에 ${targets.length}개`);
  for (const p of targets) console.log(`  ${p.id} 기록 ${(p.priceHistory || []).length} · ${p.title}`);
  process.exit(0);
}
if (!targets.length) { console.log(`${new Date().toISOString()} 오늘 다시 잴 상품 없음`); process.exit(0); }

const found = new Map(); // productId → candidate(같은 옵션)
const otherOpt = new Map(); // productId → { option, price }(다른 옵션)
let calls = 0, hits = 0, stopped = '';
for (const p of targets) {
  if (found.has(pidOf(p)) || otherOpt.has(pidOf(p))) continue; // 앞 검색에서 이미 잡혔다
  let rows;
  try {
    rows = await api.search(p.title, 10);
    calls++;
  } catch (e) {
    stopped = String(e.message).slice(0, 160);
    state.backoffUntil = new Date(Date.now() + 2 * 3600e3).toISOString();
    break;
  }
  const t = state.tries[p.id] || (state.tries[p.id] = { misses: 0 });
  t.lastTry = date;
  const hit = rows.some((r) => String(r.productId) === pidOf(p));
  if (hit) { t.misses = 0; hits++; } else t.misses++;
  for (const r of rows) {
    const known = byPid.get(String(r.productId));
    if (!known || known.status !== 'published') continue;
    const c = { ...api.toCandidate(r, { source: 'coupang-recheck' }), categories: known.categories, tags: known.tags };
    // 쿠팡 검색은 같은 상품이라도 다른 옵션(묶음 수 등)을 대표로 보여 줄 때가 많다(첫 시험 10개 중 7개).
    // 옵션이 다르면 상품의 기준 옵션·링크를 바꾸지 않고, 그 옵션 가격만 기록에 따로 남긴다(otherOpt).
    if (optionOf(c.affiliateLink) === optionOf(known.affiliateLink || known.link)) found.set(String(r.productId), c);
    else if (optionOf(c.affiliateLink) && c.price > 0) otherOpt.set(String(r.productId), { option: optionOf(c.affiliateLink), price: c.price });
  }
  await sleep(3000);
}

// 오래된 시도 기록은 지운다.
for (const [id, t] of Object.entries(state.tries)) if (daysBetween(t.lastTry, date) > 30) delete state.tries[id];
saveState();

let imported = '';
if (found.size) {
  mkdirSync(path('data/inbox'), { recursive: true });
  writeFileSync(join(path('data/inbox'), `coupang-recheck-${date}-${Date.now().toString(36)}.json`), JSON.stringify([...found.values()], null, 2));
  imported = execFileSync(process.execPath, ['scripts/import.mjs'], { encoding: 'utf8' }).split('\n').find((l) => l.includes('가격 갱신'))?.trim() || '';
}
let other = 0;
if (otherOpt.size) {
  const fresh = readJson('data/products.json'); // import 가 방금 쓴 파일을 다시 읽는다
  for (const p of fresh) {
    const o = otherOpt.get(pidOf(p));
    if (!o || found.has(pidOf(p))) continue;
    const hist = (p.priceHistory || []).filter((h) => !(h.date === date && h.option === o.option));
    const last = hist.filter((h) => h.option === o.option).at(-1);
    if (!last || last.price !== o.price) { hist.push({ date, price: o.price, option: o.option }); other++; }
    p.priceHistory = hist.slice(-90);
  }
  writeJson('data/products.json', fresh);
}
console.log(`${new Date().toISOString()} 검색 ${calls}번 · 대상 일치 ${hits}/${targets.length} · 같은 옵션 갱신 ${found.size}개 ${imported ? `(${imported})` : ''}· 다른 옵션 기록 ${otherOpt.size}개(새 값 ${other})${stopped ? ` · 멈춤: ${stopped}` : ''}`);
if (stopped) process.exit(1);
