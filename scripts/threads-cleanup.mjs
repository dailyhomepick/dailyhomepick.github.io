// 데일리홈픽 스레드 계정의 지난 글(과 내 댓글)을 지운다. 2026-11-12 "30일 최저가" 방식으로 바꾸며 만듦.
//
//   node scripts/threads-cleanup.mjs --before=2026-11-13          # 지울 목록만 보기
//   node scripts/threads-cleanup.mjs --before=2026-11-13 --yes    # 실제로 지우기(--gap=초, 기본 15)
//   node scripts/threads-cleanup.mjs --auth                       # 삭제 권한이 든 토큰 받는 주소 출력
//   node scripts/threads-cleanup.mjs --auth '<돌아온 주소>'          # 그 주소로 토큰 저장(터미널에서 직접)
//
// 삭제에는 threads_delete 권한이 필요하다. 스레드는 하루(24시간) 100개까지만 지울 수 있어서
// 한 번에 --max(기본 90)개만 지우고, 남은 건 다음 날 다시 돌리면 된다(지운 글은 목록에서 빠진다).
// 글을 먼저 지우고, 그 뒤에 남은 내 댓글을 지운다.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, today } from './lib/rules.mjs';
import { SITE } from './lib/deals.mjs';

loadEnv();
setDefaultAutoSelectFamilyAttemptTimeout(5000);
const API = 'https://graph.threads.net/v1.0';
const tokenPath = join(homedir(), '.config/dailyhomepick/threads-token.json');
const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const SCOPES = [
  'threads_basic', 'threads_content_publish', 'threads_manage_replies', 'threads_manage_insights',
  'threads_read_replies', 'threads_keyword_search', 'threads_profile_discovery', 'threads_delete',
];
const REDIRECT = `${SITE}/`;

if (args.includes('--auth')) {
  const appId = process.env.THREADS_APP_ID, secret = process.env.THREADS_APP_SECRET;
  if (!appId || !secret) { console.error('env 에 THREADS_APP_ID·THREADS_APP_SECRET 없음'); process.exit(1); }
  const back = args.find((a) => a.startsWith('http') && a.includes('code='));
  if (!back) {
    const q = new URLSearchParams({ client_id: appId, redirect_uri: REDIRECT, scope: SCOPES.join(','), response_type: 'code' });
    console.log(`이 주소를 브라우저에서 열고 @dailyhomepick_ 으로 허용하세요:\n\nhttps://threads.net/oauth/authorize?${q}\n`);
    console.log(`허용 뒤 넘어간 ${REDIRECT}?code=... 주소 전체를 복사해서, 터미널에서:\n  node scripts/threads-cleanup.mjs --auth '<그 주소>'`);
    process.exit(0);
  }
  const code = new URL(back).searchParams.get('code').replace(/#_$/, '');
  const short = await (await fetch('https://graph.threads.net/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: appId, client_secret: secret, grant_type: 'authorization_code', redirect_uri: REDIRECT, code }),
  })).json();
  if (!short.access_token) { console.error(`code 교환 실패: ${short.error?.message || short.error_message || '?'}`); process.exit(1); }
  const long = await (await fetch(`https://graph.threads.net/access_token?${new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: secret, access_token: short.access_token })}`)).json();
  if (!long.access_token) { console.error(`긴 토큰 교환 실패: ${long.error?.message || '?'}`); process.exit(1); }
  mkdirSync(join(homedir(), '.config/dailyhomepick'), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify({ token: long.access_token, refreshedAt: today(), expiresInDays: Math.round(long.expires_in / 86400) }), { mode: 0o600 });
  const dbg = await (await fetch(`${API}/debug_token?${new URLSearchParams({ input_token: long.access_token, access_token: long.access_token })}`)).json();
  console.log(`토큰 저장 완료 · 권한: ${(dbg.data?.scopes || []).join(', ')}`);
  process.exit(0);
}

const token = JSON.parse(readFileSync(tokenPath, 'utf8')).token;
async function api(method, path, params = {}) {
  const q = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${API}${path}?${q}`, { method, signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${path} ${res.status}: ${json.error?.message || ''}`);
  return json;
}
async function listAll(edge) {
  const out = [];
  let after = '';
  for (let i = 0; i < 20; i++) {
    const r = await api('GET', `/me/${edge}`, { fields: 'id,timestamp,text,username', limit: '100', ...(after ? { after } : {}) });
    out.push(...(r.data || []));
    after = r.paging?.cursors?.after;
    if (!after || !r.paging?.next) break;
  }
  return out;
}

const before = opt('before');
if (!before) { console.error('--before=YYYY-MM-DD 가 필요합니다(그날 0시(KST) 전 글만 지움)'); process.exit(1); }
const cut = Date.parse(`${before}T00:00:00+09:00`);
const max = Number(opt('max')) || 90;
const yes = args.includes('--yes');

const dbg = await api('GET', '/debug_token', { input_token: token });
if (!(dbg.data?.scopes || []).includes('threads_delete')) {
  console.error('지금 토큰에 threads_delete 권한이 없습니다 → node scripts/threads-cleanup.mjs --auth');
  if (yes) process.exit(1);
}

const me = await api('GET', '/me', { fields: 'username' });
const posts = (await listAll('threads')).filter((x) => Date.parse(x.timestamp) < cut);
const replies = (await listAll('replies')).filter((x) => Date.parse(x.timestamp) < cut && x.username === me.username);
console.log(`@${me.username} · ${before} 전 글 ${posts.length}개, 내 댓글 ${replies.length}개`);
if (!yes) {
  for (const x of posts.slice(0, 5)) console.log(`  ${x.timestamp.slice(0, 10)} ${String(x.text || '').replace(/\s+/g, ' ').slice(0, 50)}`);
  console.log('(미리보기 — 지우려면 --yes)');
  process.exit(0);
}

let n = 0;
for (const x of [...posts, ...replies]) {
  if (n >= max) break;
  try {
    await api('DELETE', `/${x.id}`);
    n++;
  } catch (e) {
    // 글을 지우면 거기 달린 내 댓글도 같이 없어질 수 있다 — 그건 실패로 치지 않는다.
    if (!/does not exist|Unsupported|not found/i.test(e.message)) console.error(`  ${x.id} 실패: ${e.message}`);
    if (/limit/i.test(e.message)) break;
  }
  await new Promise((r) => setTimeout(r, (Number(opt('gap')) || 15) * 1000));
}
const left = posts.length + replies.length - n;
console.log(`지움 ${n}개${left > 0 ? ` · 남은 것 최대 ${left}개(내일 다시 실행)` : ''}`);
