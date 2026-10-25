// 브라우저에서 복사한 cURL 명령을 헤드리스 브라우저용 로그인 세션 파일로 바꾼다.
//
//   node scripts/make-session.mjs <복사한파일> <세션파일>
//   node scripts/make-session.mjs ~/linkprice-curl.txt ~/.config/dailyhomepick/linkprice-session.json
//
// 쓰는 법:
//   1. PC 브라우저에서 해당 사이트에 로그인한다.
//   2. 개발자도구(F12) → Network 탭을 열고 화면을 한 번 움직인다(메뉴 클릭 등).
//   3. 목록에서 그 사이트로 가는 요청을 하나 골라 우클릭 → Copy → Copy as cURL.
//   4. 메모장에 붙여넣어 파일로 저장한다. 여러 번 복사해 이어 붙여도 된다
//      (도메인이 여럿이면 각각 하나씩 복사하는 편이 안전하다).
//   5. 그 파일을 맥미니로 옮기고 이 명령을 돌린다.
//
// 복사한 파일에는 로그인 쿠키가 들어 있다. 저장소나 채팅에 올리지 말고,
// 세션 파일을 만든 뒤에는 지운다. 이 스크립트는 쿠키 값을 화면에 찍지 않는다.

import { readFileSync, writeFileSync, chmodSync } from 'node:fs';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('사용법: node scripts/make-session.mjs <복사한파일> <세션파일>');
  process.exit(2);
}

const raw = readFileSync(src, 'utf8');

// 셸 줄바꿈(\ 또는 ^)을 지워 한 줄로 만든 뒤 curl 단위로 자른다.
const flat = raw.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
const blocks = flat.split(/(?=\bcurl\b)/).filter((b) => /\bcurl\b/.test(b));
if (!blocks.length) {
  console.error('cURL 명령을 찾지 못했습니다. "Copy as cURL" 로 복사한 내용이 맞는지 확인해 주세요.');
  process.exit(1);
}

// 같은 이름이라도 도메인이 다르면 다른 쿠키다.
const jar = new Map();
let hosts = [];

for (const block of blocks) {
  const urlMatch = block.match(/curl\s+(?:-[a-zA-Z-]+\s+)*['"]?(https?:\/\/[^\s'"]+)/);
  if (!urlMatch) continue;
  let host = '';
  try { host = new URL(urlMatch[1]).hostname; } catch { continue; }
  // 쿠키는 보통 상위 도메인에 걸려 있다. example.co.kr 같은 2단계 TLD 도 고려한다.
  const parts = host.split('.');
  const tail = /\.(co|or|ne|go|re|pe)\.[a-z]{2}$/.test(host) ? 3 : 2;
  const domain = `.${parts.slice(-tail).join('.')}`;
  hosts.push(host);

  const cookieHeader = block.match(/-H\s+['"]cookie:\s*([^'"]+)['"]/i)
    || block.match(/--header\s+['"]cookie:\s*([^'"]+)['"]/i)
    || block.match(/\s-b\s+['"]([^'"]+)['"]/);
  if (!cookieHeader) continue;

  for (const pair of cookieHeader[1].split(';')) {
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (!name) continue;
    jar.set(`${domain}|${name}`, {
      name, value, domain, path: '/',
      expires: Math.floor(Date.now() / 1000) + 60 * 86400,
      httpOnly: false, secure: true, sameSite: 'Lax',
    });
  }
}

if (!jar.size) {
  console.error('쿠키를 찾지 못했습니다. 로그인한 상태에서 복사한 요청이 맞는지 확인해 주세요.');
  process.exit(1);
}

writeFileSync(dest, `${JSON.stringify({ cookies: [...jar.values()], origins: [] }, null, 2)}\n`);
try { chmodSync(dest, 0o600); } catch {}

const domains = [...new Set([...jar.values()].map((c) => c.domain))];
console.log(`세션 저장: ${dest}`);
console.log(`  쿠키 ${jar.size}개 · 도메인 ${domains.join(', ')}`);
console.log(`  복사한 요청: ${[...new Set(hosts)].join(', ')}`);
console.log('복사한 원본 파일은 지워 주세요.');
