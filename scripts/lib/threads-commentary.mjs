// Manual Threads comment/reply draft helpers.
//
// The safe path is: user provides a batch of target URLs or a single batch message,
// the script drafts natural replies, and Telegram approval decides what gets used.

import { readJson, writeJson } from './store.mjs';
import { SITE } from './deals.mjs';

const STATE_PATH = 'data/threads-commentary.json';

function modePhrases(mode = 'forum') {
  if (mode === 'threads') {
    return {
      lead: ['이건 그냥 지나치기 어렵네요.', '이런 건 바로 눈이 가죠.'],
      body: ['가격이나 체감 기준으로 보면 한 번 볼 만합니다.', '비슷한 걸 찾는 분들한테는 참고가 되겠네요.'],
      tail: ['정리해 둔 페이지: {link}', '같은 기준으로 모아둔 페이지: {link}'],
    };
  }
  if (mode === 'cafe') {
    return {
      lead: ['저도 이런 건 먼저 비교해 보게 되더라고요.', '이런 건 필요할 때 찾게 되죠.'],
      body: ['비슷한 기준으로 한 번 묶어보면 보기 편합니다.', '이런 주제는 정리해 두면 나중에 편하죠.'],
      tail: ['정리해 둔 페이지: {link}', '같은 기준으로 묶어둔 페이지: {link}'],
    };
  }
  return {
    lead: ['이런 주제는 늘 눈에 들어오네요.', '저도 비슷한 걸 자주 보게 됩니다.'],
    body: ['한 번 정리해 두면 비교하기 편하더라고요.', '같은 맥락이면 모아보는 게 좋습니다.'],
    tail: ['정리해 둔 페이지: {link}', '상세는 여기: {link}'],
  };
}

function trimText(s, n = 110) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function extractUrls(text) {
  const urls = String(text || '').match(/https?:\/\/[^\s)\]]+/g) || [];
  return [...new Set(urls.map((u) => u.replace(/[>,.;]+$/, '')))].filter(Boolean);
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const bits = u.pathname.split('/').filter(Boolean).slice(-3).join('-');
    return decodeURIComponent(bits).replace(/[-_]+/g, ' ').trim().slice(0, 40) || u.hostname;
  } catch {
    return String(url).slice(0, 40);
  }
}

function targetLabel(target) {
  return target.title || target.text || slugFromUrl(target.url || target.targetUrl || target.id || '');
}

function draftFromTarget(target, { mode = 'forum' } = {}) {
  const theme = modePhrases(mode);
  const label = targetLabel(target);
  const link = target.siteLink || `${SITE}/`;
  const head = theme.lead[(label.length + link.length) % theme.lead.length];
  const mid = theme.body[(label.length + (target.text || '').length) % theme.body.length];
  const tail = theme.tail[(label.length + link.length) % theme.tail.length].replace('{link}', link);
  const context = trimText(target.text || '', 90);
  return [
    head,
    context ? `글 흐름은 ${context}` : `대상: ${label}`,
    mid,
    tail,
  ].filter(Boolean).join('\n');
}

export function buildReplyDraftsFromBatch(batchText, { mode = 'forum', siteLink = `${SITE}/` } = {}) {
  const urls = extractUrls(batchText);
  const plain = String(batchText || '')
    .replace(/https?:\/\/[^\s)\]]+/g, ' ')
    .replace(/^(댓글후보|댓글대상|댓글초안)\s*/i, '')
    .trim();

  const targets = urls.length ? urls.map((url) => ({ url, siteLink })) : [];
  const drafts = targets.map((target, idx) => ({
    kind: 'reply-draft',
    index: idx + 1,
    url: target.url,
    targetUrl: target.url,
    targetLabel: slugFromUrl(target.url),
    mode,
    text: draftFromTarget(target, { mode }),
  }));

  return {
    mode,
    sourceText: plain,
    targets,
    drafts,
    note: urls.length ? '' : 'no_urls',
  };
}

export function buildFallbackDrafts({ count = 3, mode = 'forum' } = {}) {
  const site = readJson('data/site.json', {});
  const keywords = Array.isArray(site.trending) ? site.trending.slice(0, count) : [];
  const drafts = keywords.map((keyword, idx) => ({
    kind: 'reply-draft',
    index: idx + 1,
    keyword,
    targetLabel: keyword,
    targetUrl: `${SITE}/k/${encodeURIComponent(keyword)}.html`,
    mode,
    text: draftFromTarget({ title: keyword, text: keyword, siteLink: `${SITE}/k/${encodeURIComponent(keyword)}.html` }, { mode }),
  }));
  return { mode, keywords, drafts };
}

export function saveCommentaryState(state) {
  writeJson(STATE_PATH, { updatedAt: new Date().toISOString(), ...state });
}

export function loadCommentaryState() {
  return readJson(STATE_PATH, { updatedAt: null, mode: 'forum', sourceText: '', keywords: [], targets: [], drafts: [], approved: [] });
}

export function commentaryStatePath() {
  return STATE_PATH;
}
