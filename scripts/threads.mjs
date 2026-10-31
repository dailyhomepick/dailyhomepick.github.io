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

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, today, daysBetween } from './lib/rules.mjs';
import { DISCLOSURE, won, md, loadSent, saveSent, pickDeals, channelLink } from './lib/deals.mjs';

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

// 스레드는 서식이 없고 500자까지다. 링크는 본문에 넣으면 눌린다.
function text({ p, peak, drop }, link) {
  return [
    `↓${drop}% ${p.title}`,
    `${won(p.price.min)} (${md(peak.date)} 같은 옵션 ${won(peak.price)})`,
    (p.badges || []).length ? p.badges.join(' · ') : '',
    '',
    `쿠팡에서 보기 👉 ${link}`,
    '',
    DISCLOSURE,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').slice(0, 500);
}

if (!dry) await refreshToken();
const me = dry ? null : await api('GET', '/me', { fields: 'id' });

let ok = 0;
for (const [i, x] of picks.entries()) {
  if (dry) { console.log(`--- ${x.p.id}\n${text(x, x.p.affiliateLink)}\n`); continue; }
  if (i) await new Promise((r) => setTimeout(r, GAP_MS));
  try {
    const link = await channelLink(x.p, THREADS_SUB_ID);
    // 1) 글 상자를 만들고 2) 사진 처리가 끝나면 3) 게시한다.
    const box = await api('POST', `/${me.id}/threads`, { media_type: 'IMAGE', image_url: x.p.image, text: text(x, link) });
    for (let t = 0; t < 10; t++) {
      const st = await api('GET', `/${box.id}`, { fields: 'status,error_message' });
      if (st.status === 'FINISHED') break;
      if (st.status === 'ERROR') throw new Error(`사진 처리 실패: ${st.error_message || ''}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
    await api('POST', `/${me.id}/threads_publish`, { creation_id: box.id });
    sent[x.p.id] = { date, price: x.p.price.min };
    ok++;
  } catch (e) {
    console.error(`  올리기 실패(${x.p.id}): ${e.message}`);
  }
}

if (!dry) saveSent('threads', sent, date);
console.log(`스레드: 후보 ${picks.length}개${dry ? ' (미리보기)' : ` · 올림 ${ok}`}`);
