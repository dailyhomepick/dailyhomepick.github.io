// Manual review of pending products (initial phase, before auto publishing).
//
//   node scripts/review.mjs list                 # pending items
//   node scripts/review.mjs approve all          # publish every pending item
//   node scripts/review.mjs approve id1 id2      # publish some
//   node scripts/review.mjs reject id1 "사유"     # remove and remember (never re-imported)
//   node scripts/review.mjs hide id1             # take a published item down

import { today } from './lib/rules.mjs';
import { readJson, writeJson, addToDailyPost, linkKey } from './lib/store.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const products = readJson('data/products.json');
const posts = readJson('data/posts.json');
const rejected = readJson('data/rejected.json', []);
const byId = new Map(products.map((p) => [p.id, p]));
const pending = products.filter((p) => p.status === 'pending');

function need(id) {
  const p = byId.get(id);
  if (!p) { console.error(`없는 상품 id: ${id}`); process.exit(1); }
  return p;
}

if (!cmd || cmd === 'list') {
  for (const p of pending) console.log(`${p.id}\t${p.discountRate ? `${p.discountRate}%` : '-'}\t${p.price.min}\t${p.title}`);
  console.log(`검수 대기 ${pending.length}개`);
} else if (cmd === 'approve') {
  const targets = rest[0] === 'all' ? pending : rest.map(need);
  for (const p of targets) { p.status = 'published'; p.publishedAt = today(); }
  addToDailyPost(posts, today(), targets.map((p) => p.id), byId);
  writeJson('data/products.json', products);
  writeJson('data/posts.json', posts);
  console.log(`게시 ${targets.length}개`);
} else if (cmd === 'reject') {
  const [id, reason = '수동 반려'] = rest;
  const p = need(id);
  rejected.push({ key: p.sourceId || linkKey(p.link), title: p.title, reasons: [reason], at: today() });
  writeJson('data/products.json', products.filter((x) => x !== p));
  for (const post of posts) post.items = post.items.filter((i) => i.product !== id);
  writeJson('data/posts.json', posts.filter((post) => post.items.length));
  writeJson('data/rejected.json', rejected);
  console.log(`반려: ${p.title}`);
} else if (cmd === 'hide') {
  for (const id of rest) need(id).status = 'hidden';
  writeJson('data/products.json', products);
  console.log(`내림 ${rest.length}개`);
} else {
  console.error('명령: list | approve all|id... | reject id 사유 | hide id...');
  process.exit(1);
}
