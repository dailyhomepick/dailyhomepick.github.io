// Re-check the thumbnail of every published product and take down the ones that no longer have one.
//
//   node scripts/images.mjs          # check and write data/products.json
//   node scripts/images.mjs --dry    # print only
//
// import.mjs 는 새로 들어오는 후보의 사진만 본다. 이미 올라간 상품은 판매처가 사진을 내려도
// 그대로 남아서, 빈 썸네일 카드가 목록에 뜬다. 그래서 매일 게시 상품 전체를 다시 연다.
// - 404·이미지 아님 같은 확실한 실패 → 바로 숨김
// - 429·5xx·시간 초과(판매처가 잠깐 막은 것) → 3일 연속일 때만 숨김
// - 썸네일 때문에 숨긴 상품은 사진이 다시 열리면 되살린다

import { checkImage, imageProblem, THUMB_HIDDEN } from './lib/rules.mjs';
import { readJson, writeJson } from './lib/store.mjs';

const dry = process.argv.includes('--dry');
const TEMP_LIMIT = 3;
const products = readJson('data/products.json');
const targets = products.filter((p) => p.status === 'published'
  || (p.status === 'hidden' && p.hiddenReason?.startsWith(THUMB_HIDDEN)));

const hidden = [];
const revived = [];
const flaky = [];
let next = 0;
async function worker() {
  while (next < targets.length) {
    const p = targets[next++];
    const ruleBad = imageProblem(p.image);
    const r = ruleBad ? { problem: ruleBad, temporary: false } : await checkImage(p.image);
    if (!r.problem) {
      delete p.thumbFail;
      if (p.status === 'hidden') {
        p.status = 'published';
        delete p.hiddenReason;
        revived.push(p.id);
      }
      continue;
    }
    if (p.status !== 'published') continue;
    if (r.temporary) {
      p.thumbFail = (p.thumbFail || 0) + 1;
      if (p.thumbFail < TEMP_LIMIT) { flaky.push(`${p.id} (${r.problem}, ${p.thumbFail}일째)`); continue; }
    }
    p.status = 'hidden';
    p.hiddenReason = `${THUMB_HIDDEN}: ${r.problem}`;
    delete p.thumbFail;
    hidden.push(`${p.id} (${r.problem})`);
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

if (!dry) writeJson('data/products.json', products);
console.log(`썸네일 확인: ${targets.length}개 · 숨김 ${hidden.length} · 되살림 ${revived.length} · 일시 실패 ${flaky.length}`);
for (const x of hidden) console.log(`  숨김 ${x}`);
for (const x of revived) console.log(`  되살림 ${x}`);
for (const x of flaky.slice(0, 20)) console.log(`  일시 실패 ${x}`);
