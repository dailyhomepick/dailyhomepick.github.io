// 진짜로 값이 내린 상품을 텔레그램 채널에 올린다.
//
//   node scripts/telegram.mjs          # 보내기
//   node scripts/telegram.mjs --dry    # 보낼 글만 출력(키 없어도 된다)
//
// 키: ~/.config/dailyhomepick/env 의 TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID(@채널이름 또는 -100...).
// 봇은 채널 관리자로 넣어 둬야 한다. TELEGRAM_CHAT_ID(실패 알림용)와는 따로다.
//
// "진짜로 내림" = 같은 옵션(vendorItemId) 기준 최근 30일 최고가보다 MIN_DROP% 이상 싸다.
// 쿠팡 정가 대비 할인율은 쿠팡이 주지 않고, 옵션이 섞인 비교는 가짜 할인이 된다(rules.mjs optionOf).
// 보낸 기록은 저장소 밖(~/.local/state/dailyhomepick/telegram-sent.json)에 둔다. 이 스크립트는
// daily.sh 와 따로 cron 으로 돌아서, 저장소에 쓰면 push 가 엇갈린다.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, today, daysBetween, historyOf } from './lib/rules.mjs';
import { readJson } from './lib/store.mjs';

loadEnv();
const dry = process.argv.includes('--dry');
const MIN_DROP = 10;
const PER_RUN = 5;
const RESEND_DAYS = 7;
// 쿠팡 실적에서 채널 클릭을 사이트와 가르려고 링크를 이 subId 로 새로 만든다(stats.mjs 참고).
export const TELEGRAM_SUB_ID = 'dhptelegram';
const SITE = 'https://dailyhomepick.github.io';
const DISCLOSURE = '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const channel = process.env.TELEGRAM_CHANNEL_ID || '';
if (!dry && (!token || !channel)) {
  console.error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID 가 env 에 없습니다 — 보내지 않음');
  process.exit(1);
}

const stateDir = join(homedir(), '.local/state/dailyhomepick');
const statePath = join(stateDir, 'telegram-sent.json');
const sent = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const date = today();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// 같은 옵션의 최근 30일 최고가 기록. 이것보다 싸야 "내렸다"고 말한다.
function peakOf(p) {
  const recent = historyOf(p).filter((h) => daysBetween(h.date, date) <= 30 && h.date !== date);
  return recent.reduce((a, h) => (!a || h.price > a.price ? h : a), null);
}

const picks = readJson('data/products.json')
  .filter((p) => p.status === 'published' && p.checkedAt === date && p.network === 'coupang' && p.affiliateLink)
  .map((p) => ({ p, peak: peakOf(p) }))
  .filter(({ p, peak }) => peak && peak.price > p.price.min)
  .map((x) => ({ ...x, drop: Math.round(((x.peak.price - x.p.price.min) / x.peak.price) * 100) }))
  .filter(({ drop }) => drop >= MIN_DROP)
  .filter(({ p }) => {
    const s = sent[p.id];
    return !s || daysBetween(s.date, date) >= RESEND_DAYS || p.price.min < s.price;
  })
  .sort((a, b) => b.drop - a.drop)
  .slice(0, PER_RUN);

function caption({ p, peak, drop }) {
  return [
    `<b>↓${drop}%</b> ${esc(p.title)}`,
    `<b>${won(p.price.min)}</b>  <s>${won(peak.price)}</s> (${md(peak.date)} 같은 옵션 가격)`,
    (p.badges || []).length ? esc(p.badges.join(' · ')) : '',
    `<a href="${SITE}/p/${encodeURIComponent(p.id)}.html?utm_source=telegram">가격 기록 보기</a>`,
    '',
    `<i>${DISCLOSURE}</i>`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

// 채널용 파트너스 링크. 못 만들면 사이트 링크를 그대로 쓴다(수익은 같고 집계만 섞인다).
async function channelLink(p) {
  if (dry) return p.affiliateLink;
  try {
    const { deeplink } = await import('./lib/coupang.mjs');
    const data = await deeplink([p.link], TELEGRAM_SUB_ID);
    return data?.[0]?.shortenUrl || p.affiliateLink;
  } catch (e) {
    console.error(`  링크 변환 실패(${p.id}): ${String(e.message).slice(0, 60)} — 기존 링크 사용`);
    return p.affiliateLink;
  }
}

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${method} ${res.status}: ${json.description || ''}`);
}

let ok = 0;
for (const x of picks) {
  const text = caption(x);
  if (dry) { console.log(`--- ${x.p.id}\n${text}\n[쿠팡에서 보기]\n`); continue; }
  const url = await channelLink(x.p);
  const markup = { inline_keyboard: [[{ text: '쿠팡에서 보기', url }]] };
  try {
    try {
      await tg('sendPhoto', { chat_id: channel, photo: x.p.image, caption: text, parse_mode: 'HTML', reply_markup: markup });
    } catch {
      // 텔레그램이 사진을 못 받아 가면 글만 보낸다.
      await tg('sendMessage', { chat_id: channel, text, parse_mode: 'HTML', reply_markup: markup, link_preview_options: { is_disabled: true } });
    }
    sent[x.p.id] = { date, price: x.p.price.min };
    ok++;
  } catch (e) {
    console.error(`  보내기 실패(${x.p.id}): ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

if (!dry) {
  for (const [id, s] of Object.entries(sent)) if (daysBetween(s.date, date) > 30) delete sent[id];
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(sent, null, 1));
}
console.log(`텔레그램: 후보 ${picks.length}개${dry ? ' (미리보기)' : ` · 보냄 ${ok}`}`);
