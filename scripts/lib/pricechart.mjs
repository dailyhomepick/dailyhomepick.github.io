// 스레드에 올릴 "30일 가격 그래프" 그림(1080×1350 PNG).
//
// 그림은 HTML+SVG 로 그리고 맥미니 미리보기 브라우저(~/.local/preview, 헤드리스 크롬)로 찍는다.
// 가격은 같은 옵션(historyOf) 기록만 쓴다. 기록이 없는 날은 지어내지 않고 앞 기록에서 계단으로 잇는다.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { daysBetween } from './rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(homedir(), '.local/preview/run.sh');
const RENDER = resolve(here, '../render-chart.cjs');

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// hist: [{date, price}] 같은 옵션, 날짜 오름차순, 마지막이 오늘.
export function chartHtml({ name, image, hist, date, windowDays = 30 }) {
  const W = 1080, H = 1350;
  const start = addDays(date, -30);
  const pts = hist.filter((h) => h.date >= start && h.date <= date);
  const now = pts.at(-1).price;
  const prev = pts.slice(0, -1);
  const hi = Math.max(...pts.map((h) => h.price));
  const prevLo = Math.min(...prev.map((h) => h.price));
  const drop = Math.round(((hi - now) / hi) * 100);

  // 그래프 영역
  const gx = 110, gy = 640, gw = 880, gh = 470;
  const span = Math.max(hi - now, hi * 0.04);
  const top = hi + span * 0.18, bottom = now - span * 0.22;
  const first = pts[0].date;
  const days = Math.max(daysBetween(first, date), 1);
  const X = (d) => gx + (daysBetween(first, d) / days) * gw;
  const Y = (v) => gy + ((top - v) / (top - bottom)) * gh;

  let path = `M${X(pts[0].date).toFixed(1)},${Y(pts[0].price).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    path += ` H${X(pts[i].date).toFixed(1)} V${Y(pts[i].price).toFixed(1)}`;
  }
  const area = `${path} V${gy + gh} H${X(pts[0].date).toFixed(1)} Z`;
  const hiPt = pts.find((h) => h.price === hi);
  const dots = pts.slice(0, -1).map((h) => `<circle cx="${X(h.date).toFixed(1)}" cy="${Y(h.price).toFixed(1)}" r="5" fill="#14161a"/>`).join('');

  // 가로 점선(최고·직전 최저). 값은 위 문장에 적어서 선 위에는 글자를 두지 않는다(겹친다).
  const guide = (v) => `<line x1="${gx}" x2="${gx + gw}" y1="${Y(v)}" y2="${Y(v)}" stroke="#737a86" stroke-width="2" stroke-dasharray="6 8" opacity=".5"/>`;
  const ticks = [first, ...[0.5].map((f) => addDays(first, Math.round(days * f))), date]
    .map((d) => `<text x="${X(d)}" y="${gy + gh + 48}" text-anchor="middle" font-size="28" fill="#737a86">${md(d)}</text>`).join('');

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4f2e" stop-opacity=".18"/><stop offset="1" stop-color="#ff4f2e" stop-opacity="0"/></linearGradient></defs>
    <rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" fill="none"/>
    <line x1="${gx}" x2="${gx + gw}" y1="${gy + gh}" y2="${gy + gh}" stroke="#e4e7ec" stroke-width="2"/>
    ${guide(hi)}
    ${prevLo !== hi ? guide(prevLo) : ''}
    <path d="${area}" fill="url(#g)"/>
    <path d="${path}" fill="none" stroke="#14161a" stroke-width="5" stroke-linejoin="round"/>
    ${dots}
    <circle cx="${X(hiPt.date)}" cy="${Y(hi)}" r="9" fill="#fff" stroke="#14161a" stroke-width="4"/>
    <circle cx="${X(date)}" cy="${Y(now)}" r="22" fill="#ff4f2e" opacity=".22"/>
    <circle cx="${X(date)}" cy="${Y(now)}" r="12" fill="#ff4f2e"/>
    <text x="${X(date) - 26}" y="${Y(now) + 10}" text-anchor="end" font-size="34" font-weight="800" fill="#ff4f2e">오늘 ${won(now)}</text>
    ${ticks}
  </svg>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:${W}px;height:${H}px;background:#fff;font-family:'NanumSquare Neo','NanumSquare','NanumGothic',sans-serif;color:#14161a;position:relative;overflow:hidden}
  .head{position:absolute;left:80px;right:80px;top:80px;display:flex;gap:36px;align-items:center}
  .thumb{width:200px;height:200px;border-radius:24px;background:#fff;border:2px solid #e4e7ec;object-fit:contain;flex:none}
  .name{font-size:44px;font-weight:800;line-height:1.3;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .badge{position:absolute;left:80px;top:340px;background:#ff4f2e;color:#fff;font-size:34px;font-weight:800;padding:12px 24px;border-radius:999px}
  .price{position:absolute;left:80px;top:420px;font-size:104px;font-weight:900;letter-spacing:-2px}
  .sub{position:absolute;left:84px;top:550px;font-size:34px;color:#3d434d}
  .sub b{color:#ff4f2e}
  svg{position:absolute;left:0;top:0}
  .foot{position:absolute;left:80px;right:80px;bottom:60px;display:flex;justify-content:space-between;font-size:26px;color:#737a86}
  .foot b{color:#14161a}
  </style></head><body>
  ${svg}
  <div class="head"><img class="thumb" src="${esc(image)}"><div class="name">${esc(name)}</div></div>
  <div class="badge">최근 ${windowDays}일 최저가</div>
  <div class="price">${won(now)}</div>
  <div class="sub">${windowDays}일 최고 ${won(hi)}보다 <b>${drop}% 낮음</b> · 직전 최저 ${won(prevLo)}</div>
  <div class="foot"><span><b>데일리홈픽</b> 가격 기록 · 같은 옵션 기준</span><span>${md(date)} 기준 · 가격은 바뀔 수 있어요</span></div>
  </body></html>`;
}

// HTML → PNG. 미리보기 브라우저 환경(run.sh)에서 찍는다.
export function renderPng(html, outPath) {
  const out = resolve(outPath);
  // HTML 은 저장소 밖에 둔다(저장소에 두면 daily.sh 의 git add -A 로 올라간다).
  const tmpDir = join(homedir(), '.local/state/dailyhomepick/chart-html');
  const htmlPath = join(tmpDir, out.split('/').pop().replace(/\.png$/, '.html'));
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(htmlPath, html);
  execFileSync('bash', [RUNNER, RENDER, htmlPath, out], { stdio: 'pipe', timeout: 90_000 });
  return out;
}
