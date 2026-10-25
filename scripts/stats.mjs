// 쿠팡 파트너스 실적을 모아 data/stats.json 에 쌓는다.
//
//   node scripts/stats.mjs            # 최근 60일
//   node scripts/stats.mjs 180        # 기간 지정
//
// 쿠팡은 날짜별 집계만 주고 과거를 다시 고쳐 주기도 한다(주문 확정·취소).
// 그래서 매번 기간 전체를 다시 받아 같은 날짜는 덮어쓴다.
// 방문자 수는 여기 없다 — 쿠팡은 "상품을 눌러 쿠팡으로 넘어간 클릭"만 센다.

import { loadEnv, today } from './lib/rules.mjs';
import { readJson, writeJson } from './lib/store.mjs';

loadEnv();
const { hasKeys, reportClicks, reportOrders, reportCommission, reportCancels } = await import('./lib/coupang.mjs');

if (!hasKeys()) {
  console.error('쿠팡 키가 없습니다 (AGENTS.md 키 보관 참고)');
  process.exit(1);
}

const days = Number(process.argv[2]) || 60;
const ymd = (n) => new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
const dash = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const startDate = ymd(days - 1);
const endDate = ymd(0);

// 쿠팡 조회 상한이 걸리면 한 달씩 끊어 받는다.
async function fetchAll(fn) {
  const out = [];
  for (let from = days - 1; from >= 0; from -= 30) {
    const s = ymd(from);
    const e = ymd(Math.max(0, from - 29));
    try {
      const part = await fn(s, e);
      if (Array.isArray(part)) out.push(...part);
    } catch (err) {
      console.error(`  ${s}~${e} 실패: ${String(err.message).slice(0, 80)}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

const [clicks, commission, orders, cancels] = [
  await fetchAll(reportClicks),
  await fetchAll(reportCommission),
  await fetchAll(reportOrders),
  await fetchAll(reportCancels),
];

// 날짜별로 합친다. 같은 날짜가 여러 행으로 쪼개져 오므로(subId·ctag 별) 더한다.
const byDate = new Map();
const row = (d) => {
  if (!byDate.has(d)) byDate.set(d, { date: d, clicks: 0, orders: 0, commission: 0, cancels: 0 });
  return byDate.get(d);
};
for (const r of clicks) row(dash(String(r.date))).clicks += Number(r.click || 0);
for (const r of commission) row(dash(String(r.date))).commission += Number(r.commission || 0);
for (const r of orders) row(dash(String(r.orderDate || r.date))).orders += 1;
for (const r of cancels) row(dash(String(r.cancelDate || r.date))).cancels += 1;

const list = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

// 기존 파일과 합친다. 같은 날짜는 새 값으로 갈음한다(쿠팡이 과거를 고칠 수 있다).
const prev = readJson('data/stats.json') || { days: [] };
const merged = new Map((prev.days || []).map((d) => [d.date, d]));
for (const d of list) merged.set(d.date, d);

const out = {
  updatedAt: new Date().toISOString(),
  source: 'coupang-partners',
  note: '방문자 수는 포함되지 않는다. 쿠팡은 상품 클릭만 집계한다.',
  days: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-400),
};
writeJson('data/stats.json', out);

const sum = (k) => list.reduce((s, d) => s + d[k], 0);
console.log(`실적 수집 (${dash(startDate)} ~ ${dash(endDate)}, ${list.length}일)`);
console.log(`  클릭 ${sum('clicks')} · 주문 ${sum('orders')} · 취소 ${sum('cancels')} · 수수료 ${Math.round(sum('commission')).toLocaleString()}원`);
console.log(`  저장: data/stats.json (누적 ${out.days.length}일, 오늘 ${today()})`);
