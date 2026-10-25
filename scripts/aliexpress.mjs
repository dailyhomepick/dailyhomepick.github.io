// 알리익스프레스 Ad Center 에서 상품을 받아 후보 파일로 만든다.
//
//   node scripts/aliexpress.mjs            # 수집 → data/inbox/aliexpress-*.json
//   node scripts/aliexpress.mjs --keep     # 받은 xls 를 지우지 않는다(확인용)
//
// 알리는 해외 개발자에게 상품 API 를 열어 주지 않는다. Ad Center 의 Export 기능이
// 유일한 경로라, 저장해 둔 로그인 세션으로 그 화면을 거쳐 파일을 받아온다.
// 계정을 지키려고 하루 한 번, 한 페이지만, 사람 속도로 움직이고, 막히면 바로 멈춘다.
//
// 준비물:
//   ~/.config/dailyhomepick/ali-session.json   로그인 세션 (PC 에서 만들어 옮긴다)
//   ~/.local/preview/node_modules              playwright 와 xlsx

import { writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { today } from './lib/rules.mjs';
import { path as repoPath } from './lib/store.mjs';

const LIB = '/home/kihyeon/.local/preview/node_modules';
const SESSION = join(homedir(), '.config', 'dailyhomepick', 'ali-session.json');
const AD_CENTER = 'https://portals.aliexpress.com/affiportals/web/ad_center.htm';
const KEEP = process.argv.includes('--keep');

if (!existsSync(SESSION)) {
  console.error(`로그인 세션이 없습니다: ${SESSION}`);
  console.error('PC 브라우저에서 포털에 로그인한 뒤 storageState 를 저장해 옮겨 주세요.');
  process.exit(1);
}

// playwright 와 xlsx 는 CommonJS 라 require 로 가져온다.
// 프로젝트에 의존성을 두지 않으려고 ~/.local/preview 쪽을 가리킨다.
const require = createRequire(import.meta.url);
const { chromium } = require(`${LIB}/playwright`);
const XLSX = require(`${LIB}/xlsx`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DL = join(tmpdir(), `ali-${Date.now()}`);
mkdirSync(DL, { recursive: true });

// 커스텀 드롭다운: 현재 값을 눌러 열고 원하는 항목을 고른다.
async function pickCombo(page, currentText, wantRe, label) {
  const box = page.locator(`text="${currentText}"`).last();
  if (!(await box.count())) return false;
  await box.click();
  await wait(1800);
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('li,[role="option"],[class*="option"]')]
      .map((e) => (e.innerText || '').trim()).filter((t) => t && t.length < 40));
  const hit = opts.find((o) => wantRe.test(o));
  if (!hit) { await page.keyboard.press('Escape'); await wait(600); return false; }
  await page.locator(`text="${hit}"`).last().click();
  await wait(1800);
  console.log(`  ${label}: ${hit}`);
  return true;
}

// 크롬은 시스템에 설치하지 않고 ~/.local/preview 아래 라이브러리로 돌린다(sudo 없이 깔아 둔 것).
// 브라우저 프로세스에만 그 경로를 넘긴다.
const previewLib = join(homedir(), '.local', 'preview', 'root', 'usr', 'lib');
const archDir = existsSync(previewLib) ? readdirSync(previewLib).find((d) => d.endsWith('-linux-gnu')) : '';
const browserEnv = archDir ? {
  ...process.env,
  LD_LIBRARY_PATH: join(previewLib, archDir),
  FONTCONFIG_FILE: join(homedir(), '.local', 'preview', 'fonts.conf'),
} : process.env;

const browser = await chromium.launch({ env: browserEnv });
const ctx = await browser.newContext({
  storageState: SESSION,
  locale: 'ko-KR',
  acceptDownloads: true,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  viewport: { width: 1440, height: 1100 },
});
const page = await ctx.newPage();
let saved = '';
page.on('download', async (d) => {
  saved = join(DL, d.suggestedFilename());
  await d.saveAs(saved);
});

try {
  await page.goto(AD_CENTER, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // 상품이 그려질 때까지 기다린다. 덜 그려진 채 누르면 선택이 0 이 된다.
  await page.waitForSelector('text=Promote now', { timeout: 30000 });
  await wait(3500);

  // 로그인이 풀렸으면 바로 멈춘다. 다시 두드리면 그때 진짜 막힌다.
  const needLogin = await page.evaluate(() => /Sign in|Register/i.test(document.body.innerText) && !/Kihyeon|Account/i.test(document.body.innerText));
  if (needLogin) throw new Error('세션 만료 — ali-session.json 을 다시 만들어 주세요');

  const selectAll = page.getByText('Select all', { exact: true }).first();
  await selectAll.waitFor({ state: 'visible', timeout: 15000 });
  await selectAll.click();
  await wait(2800);
  const picked = Number((await page.evaluate(() => (document.body.innerText.match(/Selected\s*[：:]\s*(\d+)/) || [])[1])) || 0);
  console.log(`선택: ${picked}개`);
  if (!picked) throw new Error('상품이 선택되지 않았습니다');

  await page.getByText('Export selected', { exact: true }).first().click();
  await wait(3500);

  // 배송국가·통화·언어를 한국으로. 캐나다/USD 로 받으면 한국에서 못 사는 가격이 나온다.
  const combo = page.locator('text=/^[A-Za-z ]+\\/[A-Z]{3}\\/[A-Za-z가-힣]+$/').first();
  if (await combo.count()) { await combo.click(); await wait(1800); }
  await pickCombo(page, 'Canada', /korea/i, 'Ship to');
  await pickCombo(page, 'USD', /KRW/i, 'Currency');
  await pickCombo(page, 'English', /korean|한국어/i, 'Language');

  await page.getByRole('button', { name: /^Export$/ }).first().click();
  console.log('내보내기 요청함 — 처리될 때까지 기다립니다');
  // 모달이 남아 뒤의 버튼을 가린다. 닫기를 시도하는 것보다 새로 고치는 편이 확실하다.
  await wait(4000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Promote now', { timeout: 30000 }).catch(() => {});
  await wait(3000);

  // 비동기 처리라 Export history 에서 Completed 가 될 때까지 기다렸다 받는다.
  for (let i = 1; i <= 10 && !saved; i += 1) {
    await wait(8000);
    await page.getByText('Export history', { exact: true }).first().click();
    await wait(3000);
    const dl = page.getByText('Download', { exact: true }).first();
    if (await dl.count()) { await dl.click(); await wait(6000); }
    if (!saved) {
      const close = page.getByText('Close', { exact: true }).first();
      if (await close.count()) { await close.click(); await wait(1500); }
      console.log(`  대기 ${i}회차...`);
    }
  }
  if (!saved) throw new Error('내보낸 파일을 받지 못했습니다 (아직 처리 중일 수 있습니다)');
  console.log('받음:', saved.split('/').pop());
} catch (err) {
  console.error('실패:', String(err.message).slice(0, 160));
  await browser.close();
  if (!KEEP) rmSync(DL, { recursive: true, force: true });
  process.exit(1);
}
await browser.close();

// ── xls → 후보 ────────────────────────────────────────────────
const wb = XLSX.readFile(saved);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const num = (v) => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;

const candidates = [];
for (const r of rows) {
  const id = String(r.ProductId || '').trim();
  const title = String(r['Product Desc'] || '').trim();
  const link = String(r['Promotion Url'] || '').trim();
  if (!id || !title || !link) continue;
  const price = num(r['Discount Price']);
  const original = num(r['Origin Price']);
  if (!price) continue;
  candidates.push({
    source: 'aliexpress-adcenter',
    sourceId: `aliexpress-${id}`,
    title,
    image: String(r['Image Url'] || '').trim(),
    // import 는 숫자나 "17,320원" 같은 문자열을 받는다. 객체를 주면 가격 없음으로 떨어진다.
    price,
    ...(original > price ? { originalPrice: original } : {}),
    store: '알리익스프레스',
    link: `https://www.aliexpress.com/item/${id}.html`,
    affiliateLink: link,
    network: 'aliexpress',
    // 알리 상품은 배송이 길고 성격이 제각각이라 한 카테고리로 모은다.
    categories: ['overseas'],
    specs: [],
    badges: ['해외직구'],
  });
}

if (!candidates.length) {
  console.error('받은 파일에서 쓸 만한 행이 없습니다');
  if (!KEEP) rmSync(DL, { recursive: true, force: true });
  process.exit(1);
}

const out = repoPath(`data/inbox/aliexpress-${today()}.json`);
mkdirSync(repoPath('data/inbox'), { recursive: true });
writeFileSync(out, `${JSON.stringify(candidates, null, 2)}\n`);
console.log(`후보 ${candidates.length}건 저장: data/inbox/aliexpress-${today()}.json`);
if (KEEP) console.log('원본 xls:', saved);
else rmSync(DL, { recursive: true, force: true });
