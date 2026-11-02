// Manual Threads comment/reply draft helpers.
//
// The safe path is: user provides a batch of target URLs or a single batch message,
// the script drafts natural replies, and Telegram approval decides what gets used.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { path as repoPath, readJson } from './store.mjs';
import { SITE } from './deals.mjs';

const LEGACY_STATE_PATH = 'data/threads-commentary.json';
const STATE_PATH = join(homedir(), '.local/state/dailyhomepick/threads-commentary.json');

function modePhrases(mode = 'friendly') {
  const variants = {
    threads: [
      { body: '가격이나 체감 기준으로 보면 한 번 볼 만해.', tail: '정리해 둔 페이지: {link}' },
      { body: '비슷한 거 찾는 사람한텐 참고되겠네.', tail: '같은 기준으로 모아둔 페이지: {link}' },
      { body: '필요한 사람한텐 바로 도움 될 느낌이야.', tail: '상세는 여기: {link}' },
      { body: '가볍게 보기에도 흐름 괜찮아.', tail: '정리해 둔 페이지: {link}' },
      { body: '같은 상황인 사람들한텐 딱 맞겠어.', tail: '링크는 여기: {link}' },
      { body: '실제로 써보는 느낌으로 봐도 괜찮아.', tail: '같은 기준으로 묶어둔 페이지: {link}' },
      { body: '용도만 맞으면 꽤 괜찮은 선택 같아.', tail: '정리해 둔 페이지: {link}' },
      { body: '한 번 비교해 볼 만한 흐름이야.', tail: '상세는 여기: {link}' },
      { body: '비슷한 거 찾는 사람한테 도움 되겠네.', tail: '같은 기준으로 모아둔 페이지: {link}' },
      { body: '가볍게 공유하기에도 무난해 보여.', tail: '정리해 둔 페이지: {link}' },
    ],
    friendly: [
      { body: '가볍게 참고하기 좋고, 비교해 보면 더 편해.', tail: '정리해 둔 페이지: {link}' },
      { body: '조금만 정리해 두면 나중에 보기 좋아.', tail: '같은 기준으로 모아둔 페이지: {link}' },
      { body: '필요한 사람한텐 바로 도움 될 것 같아.', tail: '상세는 여기: {link}' },
      { body: '나도 이런 글은 오래 보게 되더라.', tail: '정리해 둔 페이지: {link}' },
      { body: '비슷한 상황이면 한 번 볼 만해.', tail: '같은 기준으로 묶어둔 페이지: {link}' },
      { body: '실제로 써보면 더 좋을 듯해.', tail: '링크는 여기: {link}' },
      { body: '필요한 사람들한테 잘 닿을 것 같아.', tail: '정리해 둔 페이지: {link}' },
      { body: '가볍게 보기에도 흐름이 자연스럽네.', tail: '같은 기준으로 모아둔 페이지: {link}' },
      { body: '필요한 사람 입장에선 꽤 유용해 보여.', tail: '상세는 여기: {link}' },
      { body: '무겁지 않게 보기 좋은 편이야.', tail: '정리해 둔 페이지: {link}' },
    ],
    cafe: [
      { body: '비슷한 기준으로 한 번 묶어보면 보기 편해.', tail: '정리해 둔 페이지: {link}' },
      { body: '이런 주제는 정리해 두면 나중에 편하더라.', tail: '같은 기준으로 묶어둔 페이지: {link}' },
      { body: '실사용 기준으로 보면 무난한 편이야.', tail: '정리해 둔 페이지: {link}' },
      { body: '조건만 맞으면 꽤 괜찮아.', tail: '상세는 여기: {link}' },
      { body: '가볍게 참고하기 좋은 쪽이야.', tail: '링크는 여기: {link}' },
      { body: '나중에 다시 보기에도 편해.', tail: '정리해 둔 페이지: {link}' },
      { body: '용도 맞으면 괜찮은 선택이야.', tail: '같은 기준으로 모아둔 페이지: {link}' },
      { body: '실용성 기준으로 보기에 무난해.', tail: '정리해 둔 페이지: {link}' },
      { body: '같은 조건으로 보는 사람들한테 유용해.', tail: '상세는 여기: {link}' },
      { body: '무난하게 참고하기 좋은 흐름이야.', tail: '같은 기준으로 묶어둔 페이지: {link}' },
    ],
    default: [
      { body: '가격 기준으로 보면 꽤 괜찮아.', tail: '정리해 둔 페이지: {link}' },
      { body: '실용성 있는 쪽이면 참고할 만해.', tail: '상세는 여기: {link}' },
      { body: '비교해 보면 더 괜찮아 보일 수 있어.', tail: '같은 기준으로 모아둔 페이지: {link}' },
      { body: '필요한 사람들한텐 유용할 듯해.', tail: '정리해 둔 페이지: {link}' },
      { body: '무난하게 보기 좋은 편이야.', tail: '링크는 여기: {link}' },
      { body: '조건 맞으면 꽤 실속 있어.', tail: '정리해 둔 페이지: {link}' },
      { body: '비슷한 것 찾는 사람들한테 맞을 것 같아.', tail: '상세는 여기: {link}' },
      { body: '가볍게 참고하기 괜찮아.', tail: '같은 기준으로 모아둔 페이지: {link}' },
      { body: '실사용 기준으로 봐도 무난해.', tail: '정리해 둔 페이지: {link}' },
      { body: '무난하게 참고할 만해.', tail: '링크는 여기: {link}' },
    ],
  };
  return variants[mode] || variants.default;
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

function draftFromTarget(target, { mode = 'friendly' } = {}) {
  const theme = modePhrases(mode);
  const label = targetLabel(target);
  const link = target.siteLink || `${SITE}/`;
  const phrase = theme[(label.length + (target.text || '').length) % theme.length];
  const mid = phrase.body;
  const tail = phrase.tail.replace('{link}', link);
  return [mid, tail].filter(Boolean).join('\n');
}

export function buildReplyDraftsFromBatch(batchText, { mode = 'friendly', siteLink = `${SITE}/` } = {}) {
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

export function buildFallbackDrafts({ count = 3, mode = 'friendly' } = {}) {
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
  mkdirSync(join(homedir(), '.local/state/dailyhomepick'), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...state }, null, 2)}\n`, { mode: 0o600 });
}

function migrateLegacyState() {
  const legacy = repoPath(LEGACY_STATE_PATH);
  if (!existsSync(STATE_PATH) && existsSync(legacy)) {
    mkdirSync(join(homedir(), '.local/state/dailyhomepick'), { recursive: true });
    renameSync(legacy, STATE_PATH);
  }
}

export function loadCommentaryState() {
  migrateLegacyState();
  if (!existsSync(STATE_PATH)) return { updatedAt: null, mode: 'friendly', sourceText: '', keywords: [], targets: [], drafts: [], approved: [] };
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

export function commentaryStatePath() {
  return STATE_PATH;
}
