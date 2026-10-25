// 실적 대시보드의 "지금 새로고침" 버튼을 받는 작은 서버.
//
//   node scripts/refresh-server.mjs        # 127.0.0.1:8899 에서 대기
//
// 사이트는 GitHub Pages 라 서버가 없다. 버튼을 누르면 이 서버가 맥미니에서
// scripts/daily.sh --stats-only 를 돌려 쿠팡 실적을 다시 받고, 빌드해서 push 한다.
//
// 바깥에 열지 않는다. Tailscale Serve 로 tailnet 안에서만 닿게 두고, 그래서
// 토큰을 따로 두지 않았다 — 할 수 있는 일이 "실적을 다시 받아 다시 빌드" 하나뿐이고,
// 지우거나 바꾸는 경로가 없다. 바깥에 노출할 거라면 그때는 인증이 필요하다.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO = process.env.DHP_REPO || join(homedir(), 'affiliate-site-preview');
const PORT = Number(process.env.DHP_REFRESH_PORT) || 8899;
const ORIGIN = process.env.DHP_ORIGIN || 'https://dailyhomepick.github.io';
const TIMEOUT_MS = 4 * 60e3;

let running = null; // 한 번에 하나만. 겹쳐 돌면 git push 가 서로 막는다.

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
};

const send = (res, code, body) => {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

// 끝난 뒤 대시보드에 바로 보여 줄 한 줄. 페이지 자체는 Pages 가 다시 배포해야 바뀐다.
function summary() {
  try {
    const s = JSON.parse(readFileSync(join(REPO, 'data', 'stats.json'), 'utf8'));
    const days = s.days || [];
    const sum = (where, k) => days.reduce((a, r) => a + Number(r[where]?.[k] || 0), 0);
    const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
    const part = (where) => `${won(sum(where, 'commission'))} · 클릭 ${sum(where, 'clicks')}`;
    return {
      updatedAt: s.updatedAt || '',
      text: `전체 기간 — 데일리홈픽 ${part('site')} / 기타 경로 ${part('other')}`,
    };
  } catch {
    return { updatedAt: '', text: '' };
  }
}

function refresh() {
  if (running) return running;
  running = new Promise((resolve) => {
    const child = spawn('bash', [join(REPO, 'scripts', 'daily.sh'), '--stats-only'], {
      cwd: REPO,
      stdio: 'ignore', // daily.sh 가 알아서 로그 파일로 보낸다
    });
    const kill = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.on('exit', (code) => { clearTimeout(kill); resolve(code); });
    child.on('error', () => { clearTimeout(kill); resolve(-1); });
  }).finally(() => { running = null; });
  return running;
}

createServer(async (req, res) => {
  const path = (req.url || '').split('?')[0];
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (path === '/health') return send(res, 200, { ok: true, repo: REPO });
  if (path !== '/refresh') return send(res, 404, { ok: false, error: '없는 경로' });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST 로 보내세요' });

  if (running) return send(res, 409, { ok: false, error: '이미 새로고침 중입니다' });
  const code = await refresh();
  if (code !== 0) {
    return send(res, 500, { ok: false, error: `실행 실패 (종료 코드 ${code}) — 로그를 확인하세요` });
  }
  return send(res, 200, { ok: true, ...summary() });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`새로고침 서버: http://127.0.0.1:${PORT} · 저장소 ${REPO}`);
});
