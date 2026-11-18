// 링크프라이스 실적(주문·수수료)을 날짜·u_id(subId)별로 모아 운영판이 읽는 파일에 쌓는다.
//
//   node scripts/linkprice-stats.mjs        # 최근 35일
//   node scripts/linkprice-stats.mjs 120    # 기간 지정(처음 한 번 길게)
//
// 실적조회 API(translist)는 하루 단위로만 주고, 주문 확정·취소로 과거가 바뀐다. 그래서 매번
// 기간 전체를 다시 받아 같은 날짜를 덮어쓴다. 클릭 수는 이 API 에 없다(운영판에는 0 으로 나온다).
// 우리 링크의 u_id 는 data/merchants.json template 의 {subId} — 사이트 dailyhomepick, 채널 dhptelegram·dhpthreads.
// subId 별 원본은 저장소 밖(~/.local/state/dailyhomepick/linkprice-by-sub.json)에 둔다. ~/threads-diary/stats.mjs 가 읽는다.
// 키: ~/.config/dailyhomepick/env 의 LINKPRICE_AFFILIATE_ID, LINKPRICE_AUTH_KEY

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadEnv } from './lib/rules.mjs';

loadEnv();
const A = process.env.LINKPRICE_AFFILIATE_ID, KEY = process.env.LINKPRICE_AUTH_KEY;
if (!A || !KEY) { console.error('링크프라이스 키가 없습니다 (LINKPRICE_AFFILIATE_ID, LINKPRICE_AUTH_KEY)'); process.exit(1); }

const days = Number(process.argv[2]) || 35;
const ymd = (n) => new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
const dash = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const num = (v) => Number(String(v ?? 0).replace(/,/g, '')) || 0;
// 취소 주문: status 3xx 이거나 취소 표시가 있는 것. 수수료·주문에서 빼고 cancels 로 센다.
const isCancel = (r) => /^3/.test(String(r.status ?? '')) || /^(y|1|true)$/i.test(String(r.cancel_flag ?? r.is_cancel ?? '')) || num(r.commission) < 0;

const subPath = join(homedir(), '.local/state/dailyhomepick/linkprice-by-sub.json');
const blank = () => ({ clicks: 0, orders: 0, commission: 0, cancels: 0 });
const got = {};
let failed = 0, total = 0;
for (let n = days - 1; n >= 0; n--) {
  const day = ymd(n);
  const url = `https://api.linkprice.com/affiliate/translist.php?${new URLSearchParams({ a_id: A, auth_key: KEY, yyyymmdd: day, type: 'json' })}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const j = await res.json();
    if (String(j.result) !== '0') throw new Error(`result ${j.result}`); // 300 = 인증 실패
    const cells = {};
    for (const r of j.order_list || []) {
      const sub = String(r.user_id ?? r.u_id ?? '') || '(없음)';
      const c = (cells[sub] ||= blank());
      if (isCancel(r)) { c.cancels += 1; continue; }
      c.orders += 1; c.commission += num(r.commission); total += 1;
    }
    got[dash(day)] = cells;
  } catch (e) {
    failed++; console.error(`  ${day} 실패: ${String(e.message).slice(0, 80)}`); // 키는 찍지 않는다
  }
  await new Promise((r) => setTimeout(r, 300));
}

const old = existsSync(subPath) ? JSON.parse(readFileSync(subPath, 'utf8')) : { days: {} };
Object.assign(old.days, got);
mkdirSync(dirname(subPath), { recursive: true });
writeFileSync(subPath, JSON.stringify({ updatedAt: new Date().toISOString(), days: old.days }));
console.log(`링크프라이스 실적 ${Object.keys(got).length}일 받음 · 주문 ${total}건${failed ? ` · 실패 ${failed}일` : ''} → ${subPath}`);
process.exit(failed && !Object.keys(got).length ? 1 : 0);
