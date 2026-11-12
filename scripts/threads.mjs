// "최근 30일 중 가장 싼 날"이 된 상품을 가격 그래프와 함께 스레드(Threads) 계정에 올린다(2026-11-12~).
// 고르는 기준은 lib/deals.mjs pickLows, 그림은 lib/pricechart.mjs → charts/ 에 push 한 뒤 공개 주소로 올린다.
// 한 번에 1개(하루 2번 실행). 지난 방식(값 내린 상품 3개씩)은 노출이 막혀 그만뒀다.
//
//   node scripts/threads.mjs            # 올리기
//   node scripts/threads.mjs --dry      # 올릴 글만 출력(키 없어도 된다)
//   node scripts/threads.mjs --limit=2  # 2개까지
//   node scripts/threads.mjs --check    # 토큰·계정 확인만
//   node scripts/threads.mjs --insights  # 계정 성과 요약
//   node scripts/threads.mjs --replies   # 최근 게시물 댓글 보기
//   node scripts/threads.mjs --hide-reply=REPLY_ID --media=MEDIA_ID
//
// 키: ~/.config/dailyhomepick/env 의 THREADS_ACCESS_TOKEN(처음 한 번). 스레드 토큰은 60일이면 끝나서
// 이 스크립트가 주기적으로 새로 받아 ~/.config/dailyhomepick/threads-token.json(권한 600)에 둔다.
// 그 뒤로는 이 파일이 env 값보다 앞선다.
//
//
// 글 모양(2026-10-31 기현님과 정함): 본문은 사람이 쓴 것 같은 짧은 말 + 사진, 쿠팡 링크는 내 댓글로.
// 고지 문구는 본문 끝에 둔다 — 공정위 추천·보증 지침은 본문 첫머리나 끝에 구분해 적으라고 하고,
// 댓글에만 두는 건 인정되지 않는다. "써 봤다" 같은 체험 문장은 쓰지 않는다(써 보지 않았다).

import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, today, daysBetween } from './lib/rules.mjs';
import { DISCLOSURE, SITE, won, loadSent, saveSent, pickLows, channelLink } from './lib/deals.mjs';
import { chartHtml, renderPng } from './lib/pricechart.mjs';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { hash } from './lib/store.mjs';

loadEnv();
setDefaultAutoSelectFamilyAttemptTimeout(5000);

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback = '') => {
  const hit = args.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return fallback;
  const idx = hit.indexOf('=');
  return idx >= 0 ? hit.slice(idx + 1) : 'true';
};

const dry = has('--dry');
const check = has('--check');
const replyList = has('--replies');
const insights = has('--insights');
const searchQuery = value('--search') || value('--keyword') || '';
const searchType = (value('--search-type') || 'TOP').toUpperCase();
const searchLimit = Math.max(1, Math.min(50, Number(value('--search-limit')) || 10));
const PER_RUN = Number(value('--limit')) || 1;
const INSIGHT_DAYS = Number(value('--days')) || 7;
const REPLY_MEDIA = value('--media') || value('--media-id') || '';
const HIDE_REPLY_ID = value('--hide-reply') || value('--reply-id') || '';

export const THREADS_SUB_ID = 'dhpthreads';
const API = 'https://graph.threads.net/v1.0';
const tokenPath = join(homedir(), '.config/dailyhomepick/threads-token.json');
const statePath = join(homedir(), '.local/state/dailyhomepick/threads-state.json');
const saved = existsSync(tokenPath) ? JSON.parse(readFileSync(tokenPath, 'utf8')) : null;
let token = saved?.token || process.env.THREADS_ACCESS_TOKEN || '';
if (!dry && !token) {
  console.error('THREADS_ACCESS_TOKEN 이 env 에 없습니다 — 올리지 않음');
  process.exit(1);
}

function loadState() {
  if (!existsSync(statePath)) return { posts: [] };
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (!Array.isArray(state.posts)) state.posts = [];
    return state;
  } catch {
    return { posts: [] };
  }
}

function saveState(state) {
  mkdirSync(dirnameSafe(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
}

function dirnameSafe(path) {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) || 1);
}

function recentPosts(limit = 10) {
  const state = loadState();
  return [...(state.posts || [])].slice(-limit).reverse();
}

function formatSnippet(text, max = 120) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function metricValue(entry) {
  if (entry?.total_value && typeof entry.total_value.value !== 'undefined') return Number(entry.total_value.value) || 0;
  if (Array.isArray(entry?.values) && entry.values.length) return entry.values.reduce((s, v) => s + (Number(v?.value) || 0), 0);
  if (Array.isArray(entry?.link_total_values) && entry.link_total_values.length) {
    return entry.link_total_values.reduce((s, v) => s + (Number(v?.value) || 0), 0);
  }
  return 0;
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
  if (saved && daysBetween(saved.refreshedAt, today()) < 7) return;
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

async function getMe() {
  return api('GET', '/me', { fields: 'id,username' });
}

async function getReplies(mediaId) {
  const fields = 'id,text,username,hide_status,created_at,permalink';
  try {
    const res = await api('GET', `/${mediaId}/replies`, { fields });
    return res.data || [];
  } catch {
    const res = await api('GET', `/${mediaId}/replies`);
    return res.data || [];
  }
}

async function hideReply(replyId, hide = true) {
  return api('POST', `/${replyId}/manage_reply`, { hide: hide ? 'true' : 'false' });
}

async function getInsights(days = INSIGHT_DAYS) {
  const me = await getMe();
  const until = Math.floor(Date.now() / 1000);
  const since = until - (days * 86400);
  const core = await api('GET', `/${me.id}/threads_insights`, {
    metric: 'views,likes,replies,reposts,quotes,clicks',
    since: String(since),
    until: String(until),
  });
  const followers = await api('GET', `/${me.id}/threads_insights`, { metric: 'followers_count' });
  return { me, core: core.data || [], followers: followers.data || [] };
}

function normalizeSearchResults(data = []) {
  return data.map((item) => ({
    id: item.id || '',
    author: item.username || item.owner_username || item.author || '',
    text: item.text || item.caption || '',
    date: item.timestamp || item.created_time || item.created_at || '',
    permalink: item.permalink || '',
    media_type: item.media_type || '',
    is_reply: Boolean(item.is_reply),
    is_quote_post: Boolean(item.is_quote_post),
    has_replies: Boolean(item.has_replies),
  }));
}

async function searchThreads(keyword, type = 'TOP') {
  const q = String(keyword || '').trim();
  if (!q) throw new Error('검색어가 필요합니다');
  const me = await getMe();
  const fields = 'id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply';
  const params = { q, search_type: type, fields, limit: String(searchLimit) };
  const raw = await api('GET', '/keyword_search', params);
  const data = normalizeSearchResults(raw.data || []);
  return {
    me,
    query: q,
    search_type: type,
    raw,
    data,
  };
}

const date = today();
const sent = loadSent('threads');
const runLockPath = join(homedir(), '.local/state/dailyhomepick/threads.run.lock');
let runLockFd = null;
function acquireRunLock() {
  mkdirSync(dirnameSafe(runLockPath), { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    try {
      runLockFd = openSync(runLockPath, 'wx', 0o600);
      writeFileSync(runLockFd, `${process.pid}\n${new Date().toISOString()}\n`);
      return true;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      const stamp = readFileSync(runLockPath, 'utf8').split('\n')[1] || '';
      const age = Date.now() - Date.parse(stamp || 0);
      if (tries === 0 && Number.isFinite(age) && age > 30 * 60 * 1000) {
        try { unlinkSync(runLockPath); } catch {}
        continue;
      }
      return false;
    }
  }
  return false;
}
function releaseRunLock() {
  if (runLockFd === null) return;
  try { closeSync(runLockFd); } catch {}
  try { unlinkSync(runLockPath); } catch {}
  runLockFd = null;
}

if (check) {
  const me = await getMe();
  const lim = await api('GET', `/${me.id}/threads_publishing_limit`, { fields: 'quota_usage,config' });
  console.log(`계정 @${me.username} · 24시간 게시 ${lim.data?.[0]?.quota_usage ?? '?'} / ${lim.data?.[0]?.config?.quota_total ?? 250}`);
  process.exit(0);
}

if (insights) {
  if (!dry) await refreshToken();
  const report = await getInsights(INSIGHT_DAYS);
  console.log(`Threads 인사이트 @${report.me.username} (${INSIGHT_DAYS}일)`);
  for (const item of report.core) {
    console.log(`- ${item.name}: ${metricValue(item).toLocaleString('ko-KR')}`);
  }
  for (const item of report.followers) {
    console.log(`- ${item.name}: ${metricValue(item).toLocaleString('ko-KR')}`);
  }
  process.exit(0);
}

if (replyList || HIDE_REPLY_ID) {
  if (!dry) await refreshToken();
  let mediaId = REPLY_MEDIA;
  const state = loadState();
  if (!mediaId) mediaId = state.posts?.at(-1)?.postId || '';
  if (!mediaId) {
    console.error('조회할 Threads 게시물이 없습니다. 먼저 게시를 1회 이상 실행해 주세요.');
    process.exit(1);
  }

  if (HIDE_REPLY_ID) {
    await hideReply(HIDE_REPLY_ID, true);
    console.log(`댓글 숨김 완료: ${HIDE_REPLY_ID}`);
    process.exit(0);
  }

  const replies = await getReplies(mediaId);
  const post = state.posts?.find((p) => p.postId === mediaId);
  console.log(`게시물: ${post?.title || post?.productId || mediaId}`);
  if (!replies.length) {
    console.log('댓글 없음');
  } else {
    for (const r of replies) {
      const hidden = r.hide_status || 'VISIBLE';
      const who = r.username ? `@${r.username}` : '(unknown)';
      console.log(`- ${r.id} ${who} [${hidden}] ${formatSnippet(r.text)}`);
    }
  }
  process.exit(0);
}

if (searchQuery) {
  if (!dry) await refreshToken();
  try {
    const result = await searchThreads(searchQuery, searchType === 'RECENT' ? 'RECENT' : 'TOP');
    console.log(`Threads keyword search @${result.me.username} [${result.search_type}]`);
    console.log(`query: ${result.query}`);
    console.log(`count: ${result.data.length}`);
    console.log(`raw: ${JSON.stringify(result.raw).slice(0, 1200)}`);
    for (const [idx, item] of result.data.entries()) {
      const body = formatSnippet(item.text, 180);
      const dateText = item.date ? new Date(item.date).toISOString() : '';
      console.log(`${idx + 1}. @${item.author || '?'} | ${dateText} | ${item.permalink || ''}`);
      console.log(`   ${body}`);
    }
  } catch (e) {
    console.error(`검색 실패: ${e.message}`);
    process.exitCode = 1;
  }
  process.exit(0);
}

// 하루 최대 2개(2026-11-12 기현님). 오늘 이미 올린 만큼 뺀다.
const DAILY_MAX = 2;
const postedToday = loadState().posts.filter((x) => x.date === date && x.kind === 'low').length;
const picks = pickLows(sent, Math.max(0, Math.min(PER_RUN, DAILY_MAX - postedToday)), date);

// 주제 태그는 늘 하나 붙인다(카테고리로 고름). 태그가 거절되면 태그 없이 다시 올린다.
const TOPIC = { food: '장보기', kitchen: '주방템', living: '살림템', 'solo-living': '자취템', beauty: '뷰티', baby: '육아템', pet: '반려동물', electronics: '전자기기', fashion: '패션', overseas: '해외직구' };
const topicOf = (p) => TOPIC[(p.categories || []).find((c) => TOPIC[c])] || '최저가';

// 글(2026-11-12 기현님과 정함): "최근 N일 중 가장 싼 날" 하나만, 가격 그래프 그림과 함께.
// 숫자는 전부 같은 옵션 가격 기록에서 나온다. 덧붙이는 감상·체험 문장은 쓰지 않는다.
const shortName = (t) => t.replace(/^\[[^\]]*\]\s*/, '').split(',')[0].trim().slice(0, 40);
function text({ p, now, prevLo, hi, drop, windowDays }) {
  return [
    shortName(p.title),
    `최근 ${windowDays}일 중 오늘이 가장 싸요.`,
    `${windowDays}일 최고 ${won(hi)} → 오늘 ${won(now)} (${drop}% ↓)`,
    `직전 최저는 ${won(prevLo)}이었어요.`,
    '',
    DISCLOSURE,
  ].join('\n').slice(0, 500);
}

// 그래프 그림을 저장소 charts/ 에 넣고 바로 push 한다. 스레드는 공개 주소의 그림만 받는다.
// cron 이 daily.lock 을 잡고 돌려서 daily.sh 의 push 와 겹치지 않는다. 30일 지난 그림은 지운다.
const CHART_DIR = 'charts';
function git(...a) { return execFileSync('git', a, { stdio: 'pipe', encoding: 'utf8' }); }
function publishChart(x) {
  const name = `${x.p.id}-${date}.png`;
  const html = chartHtml({ name: shortName(x.p.title), image: x.p.image, hist: x.hist, date, windowDays: x.windowDays });
  // 미리보기(--dry)는 저장소 밖에 그린다. 저장소에 두면 daily.sh 가 올려 버린다.
  if (dry) return renderPng(html, join(homedir(), '.local/state/dailyhomepick/chart-preview', name));
  mkdirSync(CHART_DIR, { recursive: true });
  renderPng(html, `${CHART_DIR}/${name}`);
  for (const f of readdirSync(CHART_DIR)) {
    const d = /-(\d{4}-\d{2}-\d{2})\.png$/.exec(f)?.[1];
    if (d && daysBetween(d, date) > 30) unlinkSync(`${CHART_DIR}/${f}`);
  }
  git('add', '-A', CHART_DIR);
  git('commit', '-q', '-m', `Threads chart ${date} ${x.p.id}`);
  try { git('push', '-q', 'origin', 'HEAD:main'); } catch { git('pull', '--rebase', '-q'); git('push', '-q', 'origin', 'HEAD:main'); }
  return `${SITE}/${CHART_DIR}/${name}`;
}
async function waitPublic(url) {
  for (let t = 0; t < 30; t++) {
    try {
      const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      if (r.ok && /image/.test(r.headers.get('content-type') || '')) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return false;
}
// 댓글엔 쿠팡 링크 하나만. 스레드가 링크 미리보기(상품 사진)를 붙이므로 본문엔 상품 사진을 다시 넣지 않는다
// (2026-11-12 기현님: 글 사진과 댓글 미리보기가 겹쳐 보여 보기 안 좋다).
const replyText = (p, link) => `쿠팡에서 보기 👉 ${link}`;

// 1) 글 상자를 만들고 2) 처리가 끝나면 3) 게시한다. 게시된 글을 돌려준다(댓글을 달 때 쓴다).
async function publish(params) {
  const me = await getMe();
  const box = await api('POST', `/${me.id}/threads`, params);
  for (let t = 0; t < 10; t++) {
    const st = await api('GET', `/${box.id}`, { fields: 'status,error_message' });
    if (st.status === 'FINISHED') break;
    if (st.status === 'ERROR') throw new Error(`처리 실패: ${st.error_message || ''}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  return api('POST', `/${me.id}/threads_publish`, { creation_id: box.id });
}

async function waitBox(id) {
  for (let t = 0; t < 10; t++) {
    const st = await api('GET', `/${id}`, { fields: 'status,error_message' });
    if (st.status === 'FINISHED') return;
    if (st.status === 'ERROR') throw new Error(`처리 실패: ${st.error_message || ''}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
// 그림 여러 장(그래프 → 상품 사진). 실패하면 그래프 한 장으로 올린다.
async function publishImages(urls, body, topic) {
  try {
    return await publishImagesOnce(urls, body, topic);
  } catch (e) {
    if (!topic) throw e;
    console.error(`  주제 태그(${topic}) 실패: ${e.message} — 태그 없이 다시`);
    return publishImagesOnce(urls, body, '');
  }
}
async function publishImagesOnce(urls, body, topic) {
  const me = await getMe();
  const tag = topic ? { topic_tag: topic } : {};
  if (urls.length === 1) return publish({ media_type: 'IMAGE', image_url: urls[0], text: body, ...tag });
  try {
    const kids = [];
    for (const u of urls) {
      const k = await api('POST', `/${me.id}/threads`, { media_type: 'IMAGE', image_url: u, is_carousel_item: 'true' });
      await waitBox(k.id);
      kids.push(k.id);
    }
    const box = await api('POST', `/${me.id}/threads`, { media_type: 'CAROUSEL', children: kids.join(','), text: body, ...tag });
    await waitBox(box.id);
    return await api('POST', `/${me.id}/threads_publish`, { creation_id: box.id });
  } catch (e) {
    console.error(`  여러 장 실패: ${e.message} — 그래프 한 장으로`);
    return publish({ media_type: 'IMAGE', image_url: urls[0], text: body, ...tag });
  }
}

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function shortcodeToMediaId(shortcode) {
  const code = String(shortcode || '').trim().split('?')[0].split('/').filter(Boolean).at(-1) || '';
  if (!code || /^\d+$/.test(code)) return code;
  let value = 0n;
  for (const ch of code) {
    const idx = SHORTCODE_ALPHABET.indexOf(ch);
    if (idx < 0) return code;
    value = value * 64n + BigInt(idx);
  }
  return value.toString();
}

if (!dry && !acquireRunLock()) {
  console.log('스레드: 이미 실행 중 — 건너뜀');
  process.exit(0);
}
try {
  if (!dry) await refreshToken();
  const me = dry ? null : await getMe();

  let ok = 0;
  for (const [i, x] of picks.entries()) {
    if (dry) {
      const png = publishChart(x);
      console.log(`--- ${x.p.id} #${topicOf(x.p)}\n${text(x)}\n  └ 그림: ${png}\n  └ 댓글: ${replyText(x.p, '(쿠팡 링크)').replace(/\n+/g, ' ')}\n`);
      continue;
    }
    if (i) await new Promise((r) => setTimeout(r, 60_000));
    try {
      const link = await channelLink(x.p, THREADS_SUB_ID);
      const chartUrl = publishChart(x);
      if (!(await waitPublic(chartUrl))) throw new Error(`그래프 주소가 안 열림: ${chartUrl}`);
      const post = await publishImages([chartUrl], text(x), topicOf(x.p));
      let reply = null;
      let replyError = '';
      try {
        reply = await publish({ media_type: 'TEXT', text: replyText(x.p, link), reply_to_id: post.id });
      } catch (e) {
        replyError = e.message;
        await new Promise((r) => setTimeout(r, 5000));
        try {
          reply = await publish({ media_type: 'TEXT', text: replyText(x.p, link), reply_to_id: post.id });
        } catch (e2) {
          replyError = e2.message;
          console.error(`  댓글(링크) 실패(${x.p.id}): ${e2.message} — 손으로 달아야 함`);
        }
      }

      const state = loadState();
      state.posts.push({
        date,
        productId: x.p.id,
        title: x.p.title,
        postId: post.id,
        replyId: reply?.id || '',
        replyError,
        price: x.now,
        image: x.p.image,
        chart: chartUrl,
        kind: 'low',
        topic: topicOf(x.p),
        store: x.p.store,
        createdAt: new Date().toISOString(),
      });
      state.posts = state.posts.slice(-200);
      saveState(state);

      sent[x.p.id] = { date, price: x.now };
      saveSent('threads', sent, date);
      ok++;
    } catch (e) {
      console.error(`  올리기 실패(${x.p.id}): ${e.message}`);
      sent[x.p.id] = { date, price: x.now };
      saveSent('threads', sent, date);
    }
  }

  console.log(`스레드: 후보 ${picks.length}개${dry ? ' (미리보기)' : ` · 올림 ${ok}`}`);
} finally {
  releaseRunLock();
}
