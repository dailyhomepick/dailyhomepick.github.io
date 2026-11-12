// 상품 한 개의 "같은 옵션" 가격 기록으로 알 수 있는 것들. 사이트(build.mjs)와 스레드(deals.mjs)가 같이 쓴다.
//
// - hist: 최근 30일, 하루 한 값(그날 마지막 기록), 날짜 오름차순
// - dayDrop: 오늘 값이 바로 앞 기록보다 몇 % 내렸나(앞 기록이 7일 넘게 전이면 안 센다)
// - low: "최근 N일 최저가" 조건을 채우면 { windowDays, prevLo, hi, drop }
//
// 폭이 1.5배를 넘으면 같은 상품의 가격 변동이 아니라 옵션이 섞인 것으로 보고 아무 판단도 하지 않는다.

import { historyOf, daysBetween } from './rules.mjs';

export const LOW_MIN_DAYS = 7;   // 오늘 말고 기록이 이만큼 있어야 "최저가"라고 한다
export const LOW_MIN_DROP = 5;   // 기간 최고가보다 이 % 이상 낮아야 한다
export const DAY_MIN_DROP = 5;   // "오늘 내린 가격"에 넣는 최소 하락폭
const PREV_MAX_GAP = 7;

export function insight(p, date) {
  const byDay = new Map();
  for (const h of historyOf(p)) {
    if (h.date <= date && daysBetween(h.date, date) <= 30) byDay.set(h.date, h);
  }
  const hist = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out = { hist, dayDrop: 0, prev: null, low: null };
  if (hist.length < 2) return out;
  const lo = Math.min(...hist.map((h) => h.price));
  const hi = Math.max(...hist.map((h) => h.price));
  if (hi > lo * 1.5) return { ...out, hist: [] };

  const nowRec = hist.at(-1);
  if (nowRec.date !== date) return out;
  const now = nowRec.price;
  const prevs = hist.slice(0, -1);
  const prev = prevs.at(-1);
  if (prev && daysBetween(prev.date, date) <= PREV_MAX_GAP && prev.price > now) {
    out.prev = prev;
    out.dayDrop = Math.round(((prev.price - now) / prev.price) * 100);
  }
  if (prevs.length >= LOW_MIN_DAYS) {
    const prevLo = Math.min(...prevs.map((h) => h.price));
    const prevHi = Math.max(...prevs.map((h) => h.price));
    const drop = Math.round(((prevHi - now) / prevHi) * 100);
    if (now < prevLo && drop >= LOW_MIN_DROP) {
      out.low = { windowDays: Math.min(30, daysBetween(prevs[0].date, date)), prevLo, hi: prevHi, drop, now };
    }
  }
  return out;
}
