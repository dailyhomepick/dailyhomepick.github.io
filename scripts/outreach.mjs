// Draft cross-platform outreach comments to drive traffic back to the site.
//
// This does not post anything. It creates a safe set of candidate replies for manual approval.

import { loadEnv } from './lib/rules.mjs';
import { readJson, writeJson } from './lib/store.mjs';
import { buildCommentFlow, buildOutreachDrafts, saveOutreachDrafts } from './lib/outreach.mjs';

loadEnv();

const [cmd = 'draft', ...rest] = process.argv.slice(2);
const countArg = rest.find((a) => /^--count=/.test(a));
const modeArg = rest.find((a) => /^--mode=/.test(a));
const count = Number(countArg?.split('=')[1]) || 5;
const mode = modeArg?.split('=')[1] || 'default';

if (cmd === 'flow') {
  for (const line of buildCommentFlow({ mode })) console.log(line);
  process.exit(0);
}

if (cmd === 'draft') {
  const drafts = buildOutreachDrafts({ count, mode });
  saveOutreachDrafts(drafts);
  for (const d of drafts) {
    console.log(`--- ${d.productId}\n${d.message}\n`);
  }
  console.log(`초안 ${drafts.length}개 저장: data/outreach-drafts.json`);
  process.exit(0);
}

if (cmd === 'flow') {
  for (const line of buildCommentFlow({ mode })) console.log(line);
  process.exit(0);
}

if (cmd === 'list') {
  const data = readJson('data/outreach-drafts.json', { drafts: [] });
  for (const d of data.drafts || []) console.log(`${d.productId}\t${d.discountRate}%\t${d.title}`);
  console.log(`초안 ${data.drafts?.length || 0}개`);
  process.exit(0);
}

if (cmd === 'clear') {
  writeJson('data/outreach-drafts.json', { updatedAt: new Date().toISOString(), drafts: [] });
  console.log('초안을 비웠습니다.');
  process.exit(0);
}

console.error('명령: draft | flow | list | clear');
process.exit(1);
