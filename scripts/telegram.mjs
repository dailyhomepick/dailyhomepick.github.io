// 진짜로 값이 내린 상품을 텔레그램 채널에 올린다. 고르는 기준은 lib/deals.mjs.
//
//   node scripts/telegram.mjs          # 보내기
//   node scripts/telegram.mjs --dry    # 보낼 글만 출력(키 없어도 된다)
//   node scripts/telegram.mjs --limit=1  # 1개만(시험 발송)
//
// 키: ~/.config/dailyhomepick/env 의 TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID(@채널이름 또는 -100...).
// 봇은 채널 관리자로 넣어 둬야 한다. TELEGRAM_CHAT_ID(실패 알림용)와는 따로다.

import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { loadEnv, today } from './lib/rules.mjs';
import { DISCLOSURE, won, md, productUrl, loadSent, saveSent, pickDeals, channelLink } from './lib/deals.mjs';

loadEnv();
// 맥미니에서 api.telegram.org 연결에 0.5초 넘게 걸리는데, Node 는 주소 하나당 0.25초만 기다리고
// 끊는다(IPv6 가 없어 IPv4 하나만 남는데도). 그래서 가끔이 아니라 아무 때나 ETIMEDOUT 이 났다.
setDefaultAutoSelectFamilyAttemptTimeout(5000);
const dry = process.argv.includes('--dry');
const PER_RUN = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8)) || 5;
export const TELEGRAM_SUB_ID = 'dhptelegram';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const channel = process.env.TELEGRAM_CHANNEL_ID || '';
if (!dry && (!token || !channel)) {
  console.error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID 가 env 에 없습니다 — 보내지 않음');
  process.exit(1);
}

const date = today();
const sent = loadSent('telegram');
const picks = pickDeals(sent, PER_RUN, date);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function caption({ p, peak, drop }) {
  return [
    `<b>↓${drop}%</b> ${esc(p.title)}`,
    `<b>${won(p.price.min)}</b>  <s>${won(peak.price)}</s> (${md(peak.date)} 같은 옵션 가격)`,
    (p.badges || []).length ? esc(p.badges.join(' · ')) : '',
    `<a href="${productUrl(p, 'telegram')}">가격 기록 보기</a>`,
    '',
    `<i>${DISCLOSURE}</i>`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

// 그래도 연결이 실패하면 두 번 더 시도한다.
async function tg(method, body, tries = 3) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    if (tries <= 1) throw new Error(`${method} 연결 실패: ${e.cause?.code || e.name}`);
    await new Promise((r) => setTimeout(r, 3000));
    return tg(method, body, tries - 1);
  }
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${method} ${res.status}: ${json.description || ''}`);
}

let ok = 0;
for (const x of picks) {
  const text = caption(x);
  if (dry) { console.log(`--- ${x.p.id}\n${text}\n[쿠팡에서 보기]\n`); continue; }
  const url = await channelLink(x.p, TELEGRAM_SUB_ID);
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

if (!dry) saveSent('telegram', sent, date);
console.log(`텔레그램: 후보 ${picks.length}개${dry ? ' (미리보기)' : ` · 보냄 ${ok}`}`);
