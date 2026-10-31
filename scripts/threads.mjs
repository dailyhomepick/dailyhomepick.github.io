// 진짜로 값이 내린 상품을 스레드(Threads) 계정에 올린다. 고르는 기준은 lib/deals.mjs(텔레그램과 같다).
//
//   node scripts/threads.mjs            # 올리기
//   node scripts/threads.mjs --dry      # 올릴 글만 출력(키 없어도 된다)
//   node scripts/threads.mjs --limit=1  # 1개만(시험)
//   node scripts/threads.mjs --check    # 토큰·계정 확인만
//   node scripts/threads.mjs --insights  # 계정 성과 요약
//   node scripts/threads.mjs --replies   # 최근 게시물 댓글 보기
//   node scripts/threads.mjs --hide-reply=REPLY_ID --media=MEDIA_ID
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
const PER_RUN = Number(value('--limit')) || 3;
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
  const res = await api('GET', '/keyword_search', params);
  return {
    me,
    query: q,
    search_type: type,
    data: normalizeSearchResults(res.data || []),
  };
}

const date = today();
const sent = loadSent('threads');

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
function when(peakDate, day) {
  const n = daysBetween(peakDate, day);
  return n <= 1 ? '어제' : n <= 5 ? '며칠 전' : n <= 8 ? '일주일 전' : `${md(peakDate)}`;
}

// 스레드는 서식이 없고 500자까지다. 같은 날 올리는 글끼리 모양이 겹치지 않게 i 를 섞는다.
function text({ p, peak, drop }, day, i) {
  const seed = parseInt(hash(p.id + day).slice(0, 6), 16) + i;
  const cat = (p.categories || []).find((c) => HOOKS[c]) || 'living';
  const month = Number(day.slice(5, 7));
  const pool = cat === 'fashion' && (month >= 10 || month <= 2) ? HOOKS.winter : HOOKS[cat];
  const hook = pool[seed % pool.length];
  const name = shortName(p.title);
  const now = won(p.price.min);
  const was = won(peak.price);
  const w = when(peak.date, day);
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

if (!dry) await refreshToken();
const me = dry ? null : await getMe();

let ok = 0;
for (const [i, x] of picks.entries()) {
  if (dry) {
    console.log(`--- ${x.p.id}\n${text(x, date, i)}\n  └ 댓글: ${replyText(x.p, '(쿠팡 링크)').replace(/\n+/g, ' ')}\n`);
    continue;
  }
  if (i) await new Promise((r) => setTimeout(r, 60_000));
  try {
    const link = await channelLink(x.p, THREADS_SUB_ID);
    const post = await publish({ media_type: 'IMAGE', image_url: x.p.image, text: text(x, date, i) });
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
      price: x.p.price.min,
      image: x.p.image,
      store: x.p.store,
      createdAt: new Date().toISOString(),
    });
    state.posts = state.posts.slice(-200);
    saveState(state);

    sent[x.p.id] = { date, price: x.p.price.min };
    ok++;
  } catch (e) {
    console.error(`  올리기 실패(${x.p.id}): ${e.message}`);
  }
}

if (!dry) saveSent('threads', sent, date);
console.log(`스레드: 후보 ${picks.length}개${dry ? ' (미리보기)' : ` · 올림 ${ok}`}`);