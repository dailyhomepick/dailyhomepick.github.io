// 쿠팡 파트너스 실적을 모아 data/stats.json 에 쌓는다.
//
//   node scripts/stats.mjs            # 최근 60일
//   node scripts/stats.mjs 180        # 기간 지정
//
// 이 사이트가 만드는 링크에는 subId(COUPANG_SUB_ID)가 붙는다. 같은 계정으로 다른 데서
// 만든 링크는 subId 가 비어 있으므로, 둘을 갈라 담는다. 섞어 놓으면 사이트에서 돈이
// 나는 것처럼 오해하게 된다.
//
// 쿠팡은 날짜별 집계만 주고 과거를 다시 고치기도 한다(주문 확정·취소). 그래서 매번
// 기간 전체를 다시 받아 같은 날짜를 덮어쓴다.
// 방문자 수는 여기 없다 — 쿠팡은 "상품을 눌러 쿠팡으로 넘어간 클릭"만 센다.

import { loadEnv, today } from './lib/rules.mjs';
import { readJson, writeJson } from './lib/store.mjs';

loadEnv();
const { hasKeys, reportClicks, reportOrders, reportCommission, reportCancels } = await import('./lib/coupang.mjs');

if (!hasKeys()) {
  console.error('쿠팡 키가 없습니다 (AGENTS.md 키 보관 참고)');
  process.exit(1);
}

const MY_SUB = process.env.COUPANG_SUB_ID || '';
// 채널 링크(scripts/telegram.mjs, threads.mjs)도 이 사이트 실적이다. site 에 합치고 채널별로 따로도 센다.
const CHANNEL_SUBS = { dhptelegram: 'telegram', dhpthreads: 'threads' };
const days = Number(process.argv[2]) || 60;
const ymd = (n) => new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
const dash = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

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

const clicks = await fetchAll(reportClicks);
const commission = await fetchAll(reportCommission);
const orders = await fetchAll(reportOrders);
const cancels = await fetchAll(reportCancels);

const blank = () => ({ clicks: 0, orders: 0, commission: 0, cancels: 0 });
const byDate = new Map();
const pick = (r, dateField) => {
  const d = dash(String(r[dateField] || r.date));
  if (!byDate.has(d)) byDate.set(d, { date: d, site: blank(), other: blank(), telegram: blank(), threads: blank() });
  const row = byDate.get(d);
  const sub = String(r.subId || '');
  // subId 가 우리 것(사이트·텔레그램)이면 사이트 실적, 아니면 기타 경로.
  if (CHANNEL_SUBS[sub]) return [row.site, row[CHANNEL_SUBS[sub]]];
  return [MY_SUB && sub === MY_SUB ? row.site : row.other];
};
const add = (rows, k, v) => { for (const b of rows) b[k] += v; };

for (const r of clicks) add(pick(r, 'date'), 'clicks', Number(r.click || 0));
for (const r of commission) add(pick(r, 'date'), 'commission', Number(r.commission || 0));
for (const r of orders) add(pick(r, 'orderDate'), 'orders', 1);
for (const r of cancels) add(pick(r, 'cancelDate'), 'cancels', 1);

const list = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

// 기존 파일과 합친다. 같은 날짜는 새 값으로 갈음한다(쿠팡이 과거를 고칠 수 있다).
const prev = readJson('data/stats.json') || { days: [] };
const merged = new Map((prev.days || []).map((d) => [d.date, d]));
for (const d of list) merged.set(d.date, d);

const out = {
  updatedAt: new Date().toISOString(),
  source: 'coupang-partners',
  subId: MY_SUB,
  note: '방문자 수는 포함되지 않는다. 쿠팡은 상품 클릭만 집계한다. site = 이 사이트(subId 일치), other = 다른 경로.',
  days: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-400),
};
writeJson('data/stats.json', out);

const sum = (where, k) => list.reduce((s, d) => s + (d[where]?.[k] || 0), 0);
console.log(`실적 수집 (${list.length}일, subId=${MY_SUB || '(설정 없음)'})`);
console.log(`  이 사이트 : 클릭 ${sum('site', 'clicks')} · 주문 ${sum('site', 'orders')} · 수수료 ${Math.round(sum('site', 'commission')).toLocaleString()}원`);
console.log(`  └ 텔레그램 : 클릭 ${sum('telegram', 'clicks')} · 주문 ${sum('telegram', 'orders')} · 수수료 ${Math.round(sum('telegram', 'commission')).toLocaleString()}원`);
console.log(`  └ 스레드   : 클릭 ${sum('threads', 'clicks')} · 주문 ${sum('threads', 'orders')} · 수수료 ${Math.round(sum('threads', 'commission')).toLocaleString()}원`);
console.log(`  기타 경로 : 클릭 ${sum('other', 'clicks')} · 주문 ${sum('other', 'orders')} · 수수료 ${Math.round(sum('other', 'commission')).toLocaleString()}원`);
console.log(`  저장: data/stats.json (누적 ${out.days.length}일, 오늘 ${today()})`);
