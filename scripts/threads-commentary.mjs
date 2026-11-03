#!/usr/bin/env node
// Manage Threads comment/reply drafts from Telegram or the CLI.

import { loadEnv } from './lib/rules.mjs';
import { loadCommentaryState, saveCommentaryState, buildReplyDraftsFromBatch, buildFallbackDrafts, commentaryStatePath } from './lib/threads-commentary.mjs';

loadEnv();

const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith('--mode='));
const limitArg = args.find((a) => a.startsWith('--limit='));
const textArg = args.find((a) => a.startsWith('--text='));
const mode = modeArg ? modeArg.split('=')[1] : 'friendly';
const limit = Number(limitArg?.split('=')[1]) || 8;
const text = textArg ? textArg.slice('--text='.length) : '';

const state = loadCommentaryState();
if (!text.trim() && Array.isArray(state.drafts) && state.drafts.some((d) => d?.targetUrl && /threads\.(com|net)|threads\.com/i.test(d.targetUrl))) {
  console.log(`기존 Threads 댓글 초안 ${state.drafts.length}개 유지: ${commentaryStatePath()}`);
  process.exit(0);
}
const batch = text.trim()
  ? buildReplyDraftsFromBatch(text, { mode })
  : buildFallbackDrafts({ count: limit, mode });

const next = {
  ...state,
  mode,
  sourceText: text.trim(),
  keywords: batch.keywords || [],
  targets: batch.targets || [],
  drafts: batch.drafts || [],
};
saveCommentaryState(next);

for (const d of batch.drafts || []) {
  console.log(`--- ${d.targetLabel || d.keyword || d.url || d.index}\n${d.text}\n[${d.targetUrl || d.url || ''}]\n`);
}
console.log(`댓글 초안 ${batch.drafts?.length || 0}개 저장: ${commentaryStatePath()}`);
