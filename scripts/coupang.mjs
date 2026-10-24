// Collect Coupang Partners deals into data/inbox/ as import candidates.
//
//   node scripts/coupang.mjs goldbox                 # 골드박스 (오늘의 특가, 할인율 포함)
//   node scripts/coupang.mjs best [categoryId ...]   # 카테고리 베스트 (기본: 사이트 카테고리 전체)
//   node scripts/coupang.mjs search 키워드 [키워드...] # 검색 (호출 한도가 작으니 소량만)
//   node scripts/coupang.mjs deeplink                # 기존 상품의 일반 쿠팡 링크를 파트너스 링크로 변환
//   node scripts/coupang.mjs check                   # 키/승인 상태 확인
//
// Then run `node scripts/import.mjs`.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from './lib/coupang.mjs';
import { loadEnv, today } from './lib/rules.mjs';
import { readJson, writeJson, path } from './lib/store.mjs';

loadEnv();
const [cmd, ...rest] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function save(name, items) {
  mkdirSync(path('data/inbox'), { recursive: true });
  const file = join(path('data/inbox'), `coupang-${name}-${today()}-${Date.now().toString(36)}.json`);
  writeFileSync(file, JSON.stringify(items, null, 2));
  console.log(`후보 ${items.length}개 → ${file}`);
}

try {
  if (cmd === 'check') {
    if (!api.hasKeys()) throw new Error('쿠팡 키가 설정되지 않았습니다');
    const data = await api.goldbox();
    console.log(`쿠팡 API 정상 (골드박스 ${data.length}개 조회됨)`);
  } else if (cmd === 'goldbox') {
    const data = await api.goldbox();
    save('goldbox', data.map((p) => api.toCandidate(p, { source: 'coupang-goldbox' })));
  } else if (cmd === 'best') {
    const ids = rest.length ? rest.map(Number) : Object.keys(api.CATEGORY_MAP).map(Number);
    const all = [];
    for (const id of ids) {
      const data = await api.bestCategory(id);
      all.push(...data.map((p) => api.toCandidate(p, { categoryId: id, source: 'coupang-best' })));
      await sleep(1500);
    }
    save('best', all);
  } else if (cmd === 'search') {
    if (!rest.length) throw new Error('검색어를 넣어 주세요');
    const all = [];
    for (const kw of rest) {
      const data = await api.search(kw);
      all.push(...data.map((p) => ({ ...api.toCandidate(p, { source: 'coupang-search' }), tags: [kw.replace(/\s+/g, '')] })));
      await sleep(1500);
    }
    save('search', all);
  } else if (cmd === 'deeplink') {
    const products = readJson('data/products.json');
    const targets = products.filter((p) => !p.affiliateLink && /(^|\.)coupang\.com\//.test(p.link?.replace(/^https?:\/\/(www\.|m\.)?/, '') || ''));
    let done = 0;
    for (let i = 0; i < targets.length; i += 20) {
      const chunk = targets.slice(i, i + 20);
      const data = await api.deeplink(chunk.map((p) => p.link));
      for (const d of data || []) {
        const p = chunk.find((x) => x.link === d.originalUrl);
        if (p && d.shortenUrl) { p.affiliateLink = d.shortenUrl; p.network = 'coupang'; done++; }
      }
      await sleep(1500);
    }
    writeJson('data/products.json', products);
    console.log(`파트너스 링크로 변환 ${done}/${targets.length}개`);
  } else {
    console.log('명령: check | goldbox | best [categoryId...] | search 키워드... | deeplink');
    process.exit(1);
  }
} catch (e) {
  console.error(`실패: ${e.message}`);
  process.exit(1);
}
