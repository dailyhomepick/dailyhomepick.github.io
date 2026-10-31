// 채널(텔레그램·스레드)에 올릴 "진짜로 값이 내린" 상품 고르기와 보낸 기록.
//
// "진짜로 내림" = 같은 옵션(vendorItemId) 기준 최근 30일 최고가보다 MIN_DROP% 이상 싸다.
// 쿠팡 정가 대비 할인율은 쿠팡이 주지 않고, 옵션이 섞인 비교는 가짜 할인이 된다(rules.mjs optionOf).
// 보낸 기록은 저장소 밖(~/.local/state/dailyhomepick/<채널>-sent.json)에 둔다. 채널 스크립트는
// daily.sh 와 따로 cron 으로 돌아서, 저장소에 쓰면 push 가 엇갈린다.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { today, daysBetween, historyOf } from './rules.mjs';
import { readJson } from './store.mjs';

export const SITE = 'https://dailyhomepick.github.io';
export const DISCLOSURE = '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
const MIN_DROP = 10;
const RESEND_DAYS = 7;
const stateDir = join(homedir(), '.local/state/dailyhomepick');

export const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
export const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
export const productUrl = (p, source) => `${SITE}/p/${encodeURIComponent(p.id)}.html?utm_source=${source}`;

export function loadSent(channel) {
  const f = join(stateDir, `${channel}-sent.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}
export function saveSent(channel, sent, date = today()) {
  for (const [id, s] of Object.entries(sent)) if (daysBetween(s.date, date) > 30) delete sent[id];
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, `${channel}-sent.json`), JSON.stringify(sent, null, 1));
}

// 같은 옵션의 최근 30일 최고가 기록. 이것보다 싸야 "내렸다"고 말한다.
function peakOf(p, date) {
  const recent = historyOf(p).filter((h) => daysBetween(h.date, date) <= 30 && h.date !== date);
  return recent.reduce((a, h) => (!a || h.price > a.price ? h : a), null);
}

// 오늘 확인한 쿠팡 상품 중 많이 내린 순. 7일 안에 보낸 건 값이 더 내렸을 때만 다시 고른다.
export function pickDeals(sent, limit, date = today()) {
  return readJson('data/products.json')
    .filter((p) => p.status === 'published' && p.checkedAt === date && p.network === 'coupang' && p.affiliateLink)
    .map((p) => ({ p, peak: peakOf(p, date) }))
    .filter(({ p, peak }) => peak && peak.price > p.price.min)
    .map((x) => ({ ...x, drop: Math.round(((x.peak.price - x.p.price.min) / x.peak.price) * 100) }))
    .filter(({ drop }) => drop >= MIN_DROP)
    .filter(({ p }) => {
      const s = sent[p.id];
      return !s || daysBetween(s.date, date) >= RESEND_DAYS || p.price.min < s.price;
    })
    .sort((a, b) => b.drop - a.drop)
    .slice(0, limit);
}

// 채널용 파트너스 링크. 쿠팡 실적에서 채널 클릭을 사이트와 가르려고 채널마다 subId 를 따로 쓴다
// (stats.mjs CHANNEL_SUBS). 못 만들면 사이트 링크를 그대로 쓴다(수익은 같고 집계만 섞인다).
export async function channelLink(p, subId) {
  try {
    const { deeplink } = await import('./coupang.mjs');
    const data = await deeplink([p.link], subId);
    return data?.[0]?.shortenUrl || p.affiliateLink;
  } catch (e) {
    console.error(`  링크 변환 실패(${p.id}): ${String(e.message).slice(0, 60)} — 기존 링크 사용`);
    return p.affiliateLink;
  }
}
