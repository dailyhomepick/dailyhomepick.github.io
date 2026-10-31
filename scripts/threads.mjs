// 진짜로 값이 내린 상품을 스레드(Threads) 계정에 올린다. 고르는 기준은 lib/deals.mjs(텔레그램과 같다).
//
//   node scripts/threads.mjs            # 올리기
//   node scripts/threads.mjs --dry      # 올릴 글만 출력(키 없어도 된다)
//   node scripts/threads.mjs --limit=1  # 1개만(시험)
//   node scripts/threads.mjs --check    # 토큰·계정 확인만
//
// 키: ~/.config/dailyhomepick/env 의 THREADS_ACCESS_TOKEN(처음 한 번). 스레드 토큰은 60일이면 끝나서
// 이 스크립트가 주기적으로 새로 받아 ~/.config/dailyhomepick/threads-token.json(권한 600)에 둔다.
// 그 뒤로는 이 파일이 env 값보다 앞선다.
//
// 텔레그램보다 적게(한 번 3개) 올리고 사이를 띄운다. 링크 글을 한꺼번에 몰아 올리면 스팸으로 보인다.
//
// 글 모양(2026-10-31 기현님과 정함): 본문은 사람이 쓴 것 같은 짧은 말 + 사진, 쿠팡 링크는 내 댓글로.
// 고지 문구는 본문 끝에 둔다 — 공정위 추천·보증 지침은 본문 첫머리나 끝에 구분해 적으라고 하고,
// 댓글에만 두는 건 인정되지 않는다. "써 봤다" 같은 체험 문장은 쓰지 않는다(써 보지 않았다).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, today, daysBetween } from './lib/rules.mjs';
import { DISCLOSURE, won, md, productUrl, loadSent, saveSent, pickDeals, channelLink } from './lib/deals.mjs';
import { hash } from './lib/store.mjs';

loadEnv();
setDefaultAutoSelectFamilyAttemptTimeout(5000);
const dry = process.argv.includes('--dry');
const check = process.argv.includes('--check');
const PER_RUN = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8)) || 3;
const GAP_MS = 60_000;
const REFRESH_DAYS = 7;
export const THREADS_SUB_ID = 'dhpthreads';
const API = 'https://graph.threads.net/v1.0';

const tokenPath = join(homedir(), '.config/dailyhomepick/threads-token.json');
const saved = existsSync(tokenPath) ? JSON.parse(readFileSync(tokenPath, 'utf8')) : null;
let token = saved?.token || process.env.THREADS_ACCESS_TOKEN || '';
if (!dry && !token) {
  console.error('THREADS_ACCESS_TOKEN 이 env 에 없습니다 — 올리지 않음');
  process.exit(1);
}

async function api(method, path, params = {}) {
  const q = new URLSearchParams({ ...params, access_token: token });
  const url = method === 'GET' ? `${API}${path}?${q}` : `${API}${path}`;
  let res;
  for (let tries = 3; ; tries--) {
    try {
      res = await fetch(url, { method, ...(method === 'POST' ? { body: q } : {}), signal: AbortSignal.timeout(30000) });
      break;
    } catch (e) {
      if (tries <= 1) throw new Error(`${path} 연결 실패: ${e.cause?.code || e.name}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const json = await res.json().catch(() => ({}));
  // 토큰이 응답 오류 문구에 섞여 나오지 않게 message 만 쓴다.
  if (!res.ok || json.error) throw new Error(`${path} ${res.status}: ${json.error?.message || ''}`);
  return json;
}

// 60일짜리 토큰을 일주일에 한 번 새로 받는다(받은 지 하루가 지나야 갱신할 수 있다).
async function refreshToken() {
  if (saved && daysBetween(saved.refreshedAt, today()) < REFRESH_DAYS) return;
  const q = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: token });
  const res = await fetch(`https://graph.threads.net/refresh_access_token?${q}`, { signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (!json.access_token) {
    console.error(`  토큰 갱신 실패: ${json.error?.message || res.status} — 지금 토큰으로 계속`);
    return;
  }
  token = json.access_token;
  mkdirSync(join(homedir(), '.config/dailyhomepick'), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify({ token, refreshedAt: today(), expiresInDays: Math.round(json.expires_in / 86400) }), { mode: 0o600 });
  console.log(`  토큰 갱신(${Math.round(json.expires_in / 86400)}일)`);
}

const date = today();
const sent = loadSent('threads');

if (check) {
  const me = await api('GET', '/me', { fields: 'id,username' });
  const lim = await api('GET', `/${me.id}/threads_publishing_limit`, { fields: 'quota_usage,config' });
  console.log(`계정 @${me.username} · 24시간 게시 ${lim.data?.[0]?.quota_usage ?? '?'}/${lim.data?.[0]?.config?.quota_total ?? 250}`);
  process.exit(0);
}

const picks = pickDeals(sent, PER_RUN, date);

// 본문 문장 재료. 가격·날짜는 실제 기록만 쓰고, 덧붙이는 말은 카테고리에 맞는 일반적인 한 줄이다.
const HOOKS = {
  food: ['장 볼 때 참고하세요.', '냉장고 비었으면 지금 담아두기 좋아요.', '식비 아끼는 중이면 참고하세요.'],
  kitchen: ['주방용품 떨어질 때 된 분들 참고하세요.', '이럴 때 쟁여두면 한동안 걱정 없어요.'],
  living: ['생필품은 쌀 때 쟁여두는 게 이득이에요.', '다 써가는 분들은 참고하세요.'],
  beauty: ['다 써가는 분들은 참고하세요.', '쓰던 제품이면 이번에 채워두기 좋아요.'],
  baby: ['아기 키우는 집이면 참고하세요.', '육아용품은 쌀 때 챙겨두는 게 이득이에요.'],
  pet: ['집사분들 참고하세요.', '반려동물 용품 떨어질 때 된 분들 참고하세요.'],
  electronics: ['필요했던 분들은 이번에 보세요.', '살까 말까 했던 분들 참고하세요.'],
  fashion: ['필요했던 분들은 참고하세요.'],
  winter: ['슬슬 추워지니 하나 챙겨두면 좋을 듯.', '겨울 준비 중이면 참고하세요.'],
};
const shortName = (t) => t.replace(/^\[[^\]]*\]\s*/, '').split(',')[0].trim().slice(0, 40);
const won0 = (n) => (n >= 10000 ? `${Math.floor(n / 10000)}만 원 넘게` : n >= 1000 ? `${Math.floor(n / 1000)}천 원 넘게` : `${n}원`);
const feel = (d) => (d >= 45 ? '거의 반값 됐네요' : d >= 30 ? '꽤 많이 내렸네요' : d >= 20 ? '꽤 내렸네요' : '조금 내렸어요');
function when(peakDate, date) {
  const n = daysBetween(peakDate, date);
  return n <= 1 ? '어제' : n <= 5 ? '며칠 전' : n <= 8 ? '일주일 전' : `${md(peakDate)}`;
}

// 스레드는 서식이 없고 500자까지다. 같은 날 올리는 글끼리 모양이 겹치지 않게 i 를 섞는다.
function text({ p, peak, drop }, date, i) {
  const seed = parseInt(hash(p.id + date).slice(0, 6), 16) + i;
  const cat = (p.categories || []).find((c) => HOOKS[c]) || 'living';
  const month = Number(date.slice(5, 7));
  const pool = cat === 'fashion' && (month >= 10 || month <= 2) ? HOOKS.winter : HOOKS[cat];
  const hook = pool[seed % pool.length];
  const name = shortName(p.title);
  const now = won(p.price.min);
  const was = won(peak.price);
  const w = when(peak.date, date);
  const forms = [
    `${name} ${now}\n${w}엔 ${was}이었는데 ${feel(drop)}.\n${hook}`,
    `${name} 찾던 분 있나요?\n${md(peak.date)} ${was} → 오늘 ${now}\n매일 가격 기록하다가 ${drop >= 20 ? '크게' : '조금'} 내려서 공유해요.`,
    `${hook}\n${name}\n${was} → ${now}`,
    `${name} ${now}\n${w} ${was}보다 ${won0(peak.price - p.price.min)} 싸졌어요.\n같은 옵션끼리 비교한 가격이에요.`,
    `${name}\n${w}엔 ${was}, 오늘은 ${now}.\n${hook}`,
  ];
  // 이름이 길면 "…찾던 분 있나요?"가 어색해서 묻는 모양은 짧은 이름에만 쓴다.
  if (name.length > 16) forms.splice(1, 1);
  return `${forms[seed % forms.length]}\n\n${DISCLOSURE}`.slice(0, 500);
}
const replyText = (p, link) => `🔗 쿠팡에서 보기\n${link}\n\n가격 기록: ${productUrl(p, 'threads')}`;

// 1) 글 상자를 만들고 2) 처리가 끝나면 3) 게시한다. 게시된 글을 돌려준다(댓글을 달 때 쓴다).
async function publish(params) {
  const box = await api('POST', `/${me.id}/threads`, params);
  for (let t = 0; t < 10; t++) {
    const st = await api('GET', `/${box.id}`, { fields: 'status,error_message' });
    if (st.status === 'FINISHED') break;
    if (st.status === 'ERROR') throw new Error(`처리 실패: ${st.error_message || ''}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  return api('POST', `/${me.id}/threads_publish`, { creation_id: box.id });
}

if (!dry) await refreshToken();
const me = dry ? null : await api('GET', '/me', { fields: 'id' });

let ok = 0;
for (const [i, x] of picks.entries()) {
  if (dry) { console.log(`--- ${x.p.id}\n${text(x, date, i)}\n  └ 댓글: ${replyText(x.p, '(쿠팡 링크)').replace(/\n+/g, ' ')}\n`); continue; }
  if (i) await new Promise((r) => setTimeout(r, GAP_MS));
  try {
    const link = await channelLink(x.p, THREADS_SUB_ID);
    const post = await publish({ media_type: 'IMAGE', image_url: x.p.image, text: text(x, date, i) });
    sent[x.p.id] = { date, price: x.p.price.min };
    ok++;
    // 링크는 내 댓글로. 실패하면 링크 없는 글이 되므로 한 번 더 해 보고, 그래도 안 되면 알린다.
    try {
      await publish({ media_type: 'TEXT', text: replyText(x.p, link), reply_to_id: post.id });
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
      await publish({ media_type: 'TEXT', text: replyText(x.p, link), reply_to_id: post.id })
        .catch((e) => console.error(`  댓글(링크) 실패(${x.p.id}): ${e.message} — 손으로 달아야 함`));
    }
  } catch (e) {
    console.error(`  올리기 실패(${x.p.id}): ${e.message}`);
  }
}

if (!dry) saveSent('threads', sent, date);
console.log(`스레드: 후보 ${picks.length}개${dry ? ' (미리보기)' : ` · 올림 ${ok}`}`);
