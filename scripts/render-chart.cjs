// HTML 파일을 1080×1350 PNG 로 찍는다. lib/pricechart.mjs 가 ~/.local/preview/run.sh 로 부른다.
//   bash ~/.local/preview/run.sh scripts/render-chart.cjs <in.html> <out.png>
const { chromium } = require(require('os').homedir() + '/.local/preview/node_modules/playwright');

(async () => {
  const [, , input, output] = process.argv;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    await page.goto('file://' + input, { waitUntil: 'networkidle', timeout: 45000 });
    await page.screenshot({ path: output, type: 'png' });
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
