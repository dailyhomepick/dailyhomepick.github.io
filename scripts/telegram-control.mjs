// Telegram command bridge for Threads.
//
// Usage:
//   node scripts/telegram-control.mjs --once   # poll Telegram updates once and exit
//   node scripts/telegram-control.mjs --dry    # parse/no-op locally (no network)
//
// Commands supported in a private chat with the bot:
//   - /start, 등록, 연결, 도움말
//   - 오늘 스레드 게시물 작성해 줘
//   - 승인 / 게시 / 발행
//   - 취소
//   - 댓글 보여줘 / 댓글 목록
//   - 댓글 숨겨줘 <reply_id>
//   - 성과 알려줘 / 인사이트
//
// Safety:
//   - 처음 메시지를 보낸 private chat만 운영자(chat owner)로 등록
//   - 게시는 "승인"을 다시 받아야 실행
//   - 토큰/인증코드는 로그에 남기지 않음

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, today, daysBetween } from './lib/rules.mjs';
import { DISCLOSURE, pickDeals, loadSent, saveSent, channelLink, productUrl, won, md } from './lib/deals.mjs';
import { hash } from './lib/store.mjs';
import { buildCommentFlow, buildOutreachDrafts, saveOutreachDrafts } from './lib/outreach.mjs';
import { buildReplyDraftsFromBatch, buildFallbackDrafts, loadCommentaryState, saveCommentaryState, commentaryStatePath } from './lib/threads-commentary.mjs';

loadEnv();

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const seed = args.includes('--seed');
const once = args.includes('--once') || seed;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN 이 env 에 없습니다 — 중지');
  process.exit(1);
}

const statePath = join(homedir(), '.local/state/dailyhomepick/telegram-control.json');
const threadsStatePath = join(homedir(), '.local/state/dailyhomepick/threads-state.json');
const threadsSentPath = join(homedir(), '.local/state/dailyhomepick/threads-sent.json');
const THREADS_SUB_ID = 'dhpthreads';
const THREAD_SEED_INTERVAL_MS = 6 * 60 * 60 * 1000;
const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const THREADS_API = 'https://graph.threads.net/v1.0';
const tokenPath = join(homedir(), '.config/dailyhomepick/threads-token.json');
const savedThreads = existsSync(tokenPath) ? JSON.parse(readFileSync(tokenPath, 'utf8')) : null;
let threadsToken = savedThreads?.token || process.env.THREADS_ACCESS_TOKEN || '';
const THREADS_SEARCH_LIMIT = 10;

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

function loadState() {
  if (!existsSync(statePath)) {
    return { offset: 0, ownerChatId: null, ownerUserId: null, pendingKind: null, pendingQueue: [], lastPublished: null, lastApprovedOutreach: null, lastThreadSeedAt: null };
  }
  try {
    const s = JSON.parse(readFileSync(statePath, 'utf8'));
    const pendingQueue = Array.isArray(s.pendingQueue)
      ? s.pendingQueue
      : (s.pending ? [s.pending] : []);
    return {
      offset: Number(s.offset) || 0,
      ownerChatId: s.ownerChatId ?? null,
      ownerUserId: s.ownerUserId ?? null,
      pendingKind: s.pendingKind ?? (pendingQueue.length ? 'threads' : null),
      pendingQueue,
      lastPublished: s.lastPublished ?? null,
      lastApprovedOutreach: s.lastApprovedOutreach ?? null,
      lastThreadSeedAt: s.lastThreadSeedAt ?? null,
    };
  } catch {
    return { offset: 0, ownerChatId: null, ownerUserId: null, pendingKind: null, pendingQueue: [], lastPublished: null, lastApprovedOutreach: null, lastThreadSeedAt: null };
  }
}

function saveState(state) {
  mkdirSync(join(homedir(), '.local/state/dailyhomepick'), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
}

function pendingCount(state) {
  return Array.isArray(state.pendingQueue) ? state.pendingQueue.length : 0;
}

function clearPending(state) {
  state.pendingKind = null;
  state.pendingQueue = [];
}

function selectIndices(text, max) {
  const tail = String(text || '').replace(/^승인\s*/,'').trim();
  if (!tail || /^(all|전체|모두)$/i.test(tail)) return Array.from({ length: max }, (_, i) => i + 1);
  const out = new Set();
  for (const part of tail.split(/[\s,]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = Math.min(Number(range[1]), Number(range[2]));
      const b = Math.max(Number(range[1]), Number(range[2]));
      for (let n = a; n <= b; n++) out.add(n);
      continue;
    }
    if (/^\d+$/.test(part)) out.add(Number(part));
  }
  return [...out].filter((n) => n >= 1 && n <= max).sort((a, b) => a - b);
}

function draftSummary(d) {
  const line = String(d.text || d.message || '').split('\n').find(Boolean) || d.title || d.productId || '';
  return `${d.productId || '?'} · ${line.slice(0, 48)}`;
}

function shouldSeedThreads(state) {
  const last = Number(new Date(state.lastThreadSeedAt || 0));
  return !last || (Date.now() - last) >= THREAD_SEED_INTERVAL_MS;
}

async function seedThreadsDraft(state) {
  const draft = await buildDraft();
  if (!draft) return null;
  state.lastThreadSeedAt = today();
  state.pendingKind = 'threads';
  state.pendingQueue = [draft];
  saveState(state);
  return draft;
}

function formatPendingQueue(state) {
  return (state.pendingQueue || []).map((d, idx) => `${idx + 1}. ${draftSummary(d)}`).join('\n');
}

function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function tg(method, body) {
  if (dry) {
    console.log(`[dry] telegram ${method}: ${JSON.stringify(body).slice(0, 240)}`);
    return { ok: true, result: {} };
  }
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${method} ${res.status}: ${json.description || ''}`);
  return json;
}

async function threadsApi(method, path, params = {}) {
  if (!threadsToken) throw new Error('THREADS_ACCESS_TOKEN 이 없습니다');
  const q = new URLSearchParams({ ...params, access_token: threadsToken });
  const url = method === 'GET' ? `${THREADS_API}${path}?${q}` : `${THREADS_API}${path}`;
  const res = await fetch(url, { method, ...(method === 'POST' ? { body: q } : {}), signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${path} ${res.status}: ${json.error?.message || ''}`);
  return json;
}

async function refreshThreadsToken() {
  if (!threadsToken) return;
  if (savedThreads && daysBetween(savedThreads.refreshedAt, today()) < 7) return;
  const q = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: threadsToken });
  const res = await fetch(`https://graph.threads.net/refresh_access_token?${q}`, { signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (!json.access_token) return;
  threadsToken = json.access_token;
  mkdirSync(join(homedir(), '.config/dailyhomepick'), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify({ token: threadsToken, refreshedAt: today(), expiresInDays: Math.round(json.expires_in / 86400) }), { mode: 0o600 });
}

function shortName(t) {
  return String(t || '').replace(/^\[[^\]]*\]\s*/, '').split(',')[0].trim().slice(0, 40);
}

function feel(drop) {
  return drop >= 45 ? '거의 반값 됐네요' : drop >= 30 ? '꽤 많이 내렸네요' : drop >= 20 ? '꽤 내렸네요' : '조금 내렸어요';
}

function when(peakDate, date) {
  const n = daysBetween(peakDate, date);
  return n <= 1 ? '어제' : n <= 5 ? '며칠 전' : n <= 8 ? '일주일 전' : `${md(peakDate)}`;
}

function threadText({ p, peak, drop }, date, i) {
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
    `${name} ${now}\n${w} ${was}보다 ${won(Math.max(1, peak.price - p.price.min))} 싸졌어요.\n같은 옵션끼리 비교한 가격이에요.`,
    `${name}\n${w}엔 ${was}, 오늘은 ${now}.\n${hook}`,
  ];
  if (name.length > 16) forms.splice(1, 1);
  return `${forms[seed % forms.length]}\n\n${DISCLOSURE}`.slice(0, 500);
}

const replyText = (p, link) => `🔗 쿠팡에서 보기\n${link}\n\n가격 기록: ${productUrl(p, 'threads')}`;

function normalize(t) {
  return String(t || '').trim().replace(/\s+/g, '');
}

function isOwnerAllowed(state, chatId, userId) {
  if (state.ownerChatId == null) return true;
  return String(state.ownerChatId) === String(chatId) && String(state.ownerUserId) === String(userId);
}

async function buildDraft() {
  const date = today();
  const sent = loadSent('threads');
  const picks = pickDeals(sent, 1, date);
  if (!picks.length) return null;
  const x = picks[0];
  const link = await channelLink(x.p, THREADS_SUB_ID);
  return {
    date,
    productId: x.p.id,
    title: x.p.title,
    image: x.p.image,
    price: x.p.price.min,
    link,
    text: threadText(x, date, 0),
    replyText: replyText(x.p, link),
    peakDate: x.peak.date,
    peakPrice: x.peak.price,
    drop: x.drop,
    store: x.p.store,
  };
}

async function publishDraft(draft) {
  const me = await threadsApi('GET', '/me', { fields: 'id' });
  const box = await threadsApi('POST', `/${me.id}/threads`, {
    media_type: 'IMAGE',
    image_url: draft.image,
    text: draft.text,
  });
  for (let tries = 0; tries < 10; tries++) {
    const st = await threadsApi('GET', `/${box.id}`, { fields: 'status,error_message' });
    if (st.status === 'FINISHED') break;
    if (st.status === 'ERROR') throw new Error(`처리 실패: ${st.error_message || ''}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const post = await threadsApi('POST', `/${me.id}/threads_publish`, { creation_id: box.id });
  try {
    await threadsApi('POST', `/${me.id}/threads`, { media_type: 'TEXT', text: draft.replyText, reply_to_id: post.id });
  } catch {
    await new Promise((r) => setTimeout(r, 5000));
    await threadsApi('POST', `/${me.id}/threads`, { media_type: 'TEXT', text: draft.replyText, reply_to_id: post.id });
  }
  const state = { posts: [] };
  if (existsSync(threadsStatePath)) {
    try { Object.assign(state, JSON.parse(readFileSync(threadsStatePath, 'utf8'))); } catch {}
  }
  if (!Array.isArray(state.posts)) state.posts = [];
  state.posts.push({
    date: draft.date,
    productId: draft.productId,
    title: draft.title,
    postId: post.id,
    price: draft.price,
    image: draft.image,
    store: draft.store,
    createdAt: new Date().toISOString(),
  });
  state.posts = state.posts.slice(-200);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(threadsStatePath, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });

  const sent = loadSent('threads');
  sent[draft.productId] = { date: draft.date, price: draft.price };
  saveSent('threads', sent, draft.date);
  return post.id;
}

function dirname(path) {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) || 1);
}

async function getReplies(mediaId) {
  const fields = 'id,text,username,hide_status,created_at,permalink';
  try {
    const res = await threadsApi('GET', `/${mediaId}/replies`, { fields });
    return res.data || [];
  } catch {
    const res = await threadsApi('GET', `/${mediaId}/replies`);
    return res.data || [];
  }
}

async function hideReply(replyId, hide = true) {
  return threadsApi('POST', `/${replyId}/manage_reply`, { hide: hide ? 'true' : 'false' });
}

async function getInsights(days = 7) {
  const me = await threadsApi('GET', '/me', { fields: 'id,username' });
  const until = Math.floor(Date.now() / 1000);
  const since = until - (days * 86400);
  const core = await threadsApi('GET', `/${me.id}/threads_insights`, {
    metric: 'views,likes,replies,reposts,quotes,clicks',
    since: String(since),
    until: String(until),
  });
  const followers = await threadsApi('GET', `/${me.id}/threads_insights`, { metric: 'followers_count' });
  return { me, core: core.data || [], followers: followers.data || [] };
}

function formatSearchItems(items) {
  return items.map((item, idx) => {
    const text = String(item.text || '').replace(/\s+/g, ' ').trim();
    const date = item.date ? new Date(item.date).toISOString() : '';
    return `${idx + 1}. @${item.author || '?'} | ${date} | ${item.permalink || ''}\n   ${text.slice(0, 180)}`;
  }).join('\n');
}

async function searchThreads(keyword, type = 'TOP') {
  const q = String(keyword || '').trim();
  if (!q) throw new Error('검색어가 필요합니다');
  const fields = 'id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply';
  const res = await threadsApi('GET', '/keyword_search', { q, search_type: type, fields, limit: String(THREADS_SEARCH_LIMIT) });
  return {
    query: q,
    search_type: type,
    data: (res.data || []).map((item) => ({
      author: item.username || '',
      text: item.text || '',
      date: item.timestamp || '',
      permalink: item.permalink || '',
      id: item.id || '',
    })),
  };
}

async function handleCommand(message, state) {
  const chatId = message.chat.id;
  const userId = message.from?.id ?? chatId;
  const text = String(message.text || '').trim();
  const compact = normalize(text);

  if (!state.ownerChatId && message.chat.type === 'private') {
    state.ownerChatId = chatId;
    state.ownerUserId = userId;
    saveState(state);
  }
  if (!isOwnerAllowed(state, chatId, userId)) return;

  const reply = (msg, extra = {}) => tg('sendMessage', { chat_id: chatId, text: msg, ...extra });

  if (/^(\/start|\/help|도움|도움말|등록|연결)$/i.test(text) || compact.includes('쓰레드연결')) {
    const lines = [
      'Threads 제어가 연결되었습니다.',
      '가능한 명령:',
      '- 오늘 스레드 게시물 작성해 줘',
      '- 승인 / 승인 1 3 / 승인 all',
      '- 취소',
      '- 댓글 보여줘',
      '- 댓글 숨겨줘 <reply_id>',
      '- 성과 알려줘',
      '- 댓글유입 <대상 URL 또는 글 전문>',
      '- 댓글초안',
    ];
    await reply(lines.join('\n'));
    return;
  }

  if (compact.includes('취소')) {
    clearPending(state);
    saveState(state);
    await reply('대기 중인 Threads/초안 작업을 취소했습니다.');
    return;
  }

  if (compact.includes('오늘') && compact.includes('스레드') && (compact.includes('작성') || compact.includes('게시') || compact.includes('써줘'))) {
    const draft = await buildDraft();
    if (!draft) {
      await reply('오늘 조건에 맞는 Threads 후보가 없습니다.');
      return;
    }
    state.pendingKind = 'threads';
    state.pendingQueue = [draft];
    saveState(state);
    await reply([
      'Threads 초안입니다.',
      '',
      draft.text,
      '',
      `링크: ${draft.link}`,
      `상품: ${draft.title}`,
      '',
      '게시하려면 `승인` 또는 `승인 1` 이라고 답장해 주세요.',
    ].join('\n'));
    return;
  }

  if (/^승인(\s|$)/.test(compact) || compact.includes('게시승인') || compact.includes('발행승인') || compact.includes('올려줘')) {
    if (!pendingCount(state)) {
      await reply('대기 중인 초안이 없습니다. 먼저 요청해 주세요.');
      return;
    }
    const indices = selectIndices(text, pendingCount(state));
    if (!indices.length) {
      await reply('승인할 번호를 찾지 못했습니다. 예: `승인 1 3` 또는 `승인 all`');
      return;
    }

    const draftList = state.pendingQueue;
    const chosen = indices.map((n) => draftList[n - 1]).filter(Boolean);
    const results = [];
    for (const draft of chosen) {
      try {
        if (draft.mode === 'threads' || draft.postId || draft.replyText) {
          await refreshThreadsToken();
          const postId = await publishDraft(draft);
          state.lastPublished = { postId, productId: draft.productId, at: new Date().toISOString() };
          results.push(`게시 완료: ${draft.title} → ${postId}`);
        } else {
          results.push(`초안 확인만: ${draft.title}`);
        }
      } catch (e) {
        results.push(`실패: ${draft.title} · ${e.message}`);
      }
    }
    clearPending(state);
    saveState(state);
    await reply(results.join('\n'));
    return;
  }

  if (compact.includes('댓글') && (compact.includes('보여') || compact.includes('목록') || compact.includes('확인'))) {
    const stateFile = existsSync(threadsStatePath) ? JSON.parse(readFileSync(threadsStatePath, 'utf8')) : { posts: [] };
    const latest = [...(stateFile.posts || [])].at(-1);
    if (!latest?.postId) {
      await reply('최근 Threads 게시물을 찾지 못했습니다. 먼저 1개 이상 게시해 주세요.');
      return;
    }
    const replies = await getReplies(latest.postId);
    if (!replies.length) {
      await reply('댓글이 없습니다.');
      return;
    }
    const lines = [`최근 Threads 게시물 댓글 (${replies.length}개)`];
    for (const r of replies.slice(0, 10)) lines.push(`- ${r.id} ${r.username ? `@${r.username}` : '(unknown)'} [${r.hide_status || 'VISIBLE'}] ${String(r.text || '').replace(/\s+/g, ' ').slice(0, 120)}`);
    await reply(lines.join('\n'));
    return;
  }

  const hideMatch = text.match(/(?:댓글\s*숨겨줘|댓글\s*숨김|hide\s*reply)\s+([A-Za-z0-9_-]+)/i);
  if (hideMatch) {
    const replyId = hideMatch[1];
    try {
      await hideReply(replyId, true);
      await reply(`댓글을 숨겼습니다: ${replyId}`);
    } catch (e) {
      await reply(`댓글 숨김 실패: ${e.message}`);
    }
    return;
  }

  if (compact.includes('성과') || compact.includes('인사이트') || compact.includes('분석')) {
    try {
      await refreshThreadsToken();
      const report = await getInsights(7);
      const lines = [`Threads 인사이트 @${report.me.username} (7일)`];
      for (const item of report.core) {
        const value = item?.total_value?.value ?? item?.values?.reduce((s, v) => s + (Number(v?.value) || 0), 0) ?? 0;
        lines.push(`- ${item.name}: ${Number(value).toLocaleString('ko-KR')}`);
      }
      for (const item of report.followers) {
        const value = item?.total_value?.value ?? item?.values?.reduce((s, v) => s + (Number(v?.value) || 0), 0) ?? 0;
        lines.push(`- ${item.name}: ${Number(value).toLocaleString('ko-KR')}`);
      }
      await reply(lines.join('\n'));
    } catch (e) {
      await reply(`인사이트 조회 실패: ${e.message}`);
    }
    return;
  }

  if (compact.includes('댓글유입') || compact.includes('유입댓글') || compact.includes('외부댓글') || compact.includes('댓글초안')) {
    const seedText = text.replace(/^(댓글유입|유입댓글|외부댓글|댓글초안)\s*/,'').trim();
    let batch;
    if (seedText) {
      batch = buildReplyDraftsFromBatch(seedText, { mode: 'friendly' });
    } else {
      batch = buildFallbackDrafts({ count: 5, mode: 'friendly' });
    }
    const state = loadCommentaryState();
    saveCommentaryState({
      ...state,
      mode: 'friendly',
      sourceText: seedText,
      keywords: batch.keywords || [],
      targets: batch.targets || [],
      drafts: batch.drafts || [],
    });
    const lines = ['댓글 유입용 초안'];
    for (const d of batch.drafts || []) lines.push(`- ${d.targetLabel || d.keyword || d.url || d.index}: ${d.text.replace(/\n+/g, ' | ')}`);
    await reply(lines.join('\n'));
    return;
  }

  if (compact.includes('예약') && compact.includes('스레드')) {
    const seedAt = today();
    state.lastThreadSeedAt = seedAt;
    state.pendingKind = 'threads';
    state.pendingQueue = [await buildDraft()];
    saveState(state);
    await reply(`주기 실행 기준으로 초안을 만들 준비를 했습니다. 마지막 생성일: ${seedAt}`);
    return;
  }

  if (compact.includes('현재상태') || compact.includes('상태')) {
    const pending = state.pending ? `대기 중 초안: ${state.pending.title}` : '대기 중 초안 없음';
    const registered = state.ownerChatId ? `운영자 chat_id: ${state.ownerChatId}` : '운영자 미등록';
    await reply([registered, pending].join('\n'));
    return;
  }
}

async function main() {
  const state = loadState();
  const params = new URLSearchParams({ timeout: '20', limit: '50' });
  if (state.offset) params.set('offset', String(state.offset));
  if (dry) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  if (seed) {
    if (!shouldSeedThreads(state)) {
      console.log('seed skipped: interval not reached');
      return;
    }
    const draft = await seedThreadsDraft(state);
    console.log(draft ? `seeded: ${draftSummary(draft)}` : 'seed skipped: no draft');
    return;
  }

  const res = await fetch(`${API}/getUpdates?${params}`, { signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`getUpdates ${res.status}: ${json.description || ''}`);
  const updates = json.result || [];
  for (const update of updates) {
    state.offset = Number(update.update_id || 0) + 1;
    if (update.message?.chat?.type !== 'private') continue;
    if (!update.message?.text) continue;
    try {
      await handleCommand(update.message, state);
    } catch (e) {
      await tg('sendMessage', {
        chat_id: update.message.chat.id,
        text: `오류: ${e.message}`,
      });
    }
  }
  saveState(state);
  console.log(`Telegram control: ${updates.length} update(s)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
