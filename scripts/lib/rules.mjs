// Shared publishing rules: what may appear on the site, how links/prices are judged.
// Used by import.mjs (auto review), build.mjs (hard validation) and review.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Prohibited goods. Matched against title + category text (lowercased, spaces removed).
export const PROHIBITED = {
  성인용품: ['성인용품', '19금', '콘돔', '러브젤', '윤활젤', '딜도', '바이브레이터', '오나홀', '자위', '텐가', 'tenga', '애널', '페로몬', '최음', '흥분젤', '섹시란제리', '성인완구', 'adulttoy', 'sextoy', 'vibrator', 'dildo', 'condom'],
  담배: ['담배', '전자담배', '액상니코틴', '니코틴', '시가렛', '궐련', '베이프', 'vape'],
  주류: ['소주', '맥주', '와인', '위스키', '보드카', '막걸리', '사케', '하이볼캔', '리큐르', '데킬라', '샴페인'],
  의약품: ['의약품', '전문의약품', '발기', '비아그라', '시알리스', '탈모약', '다이어트약', '식욕억제', '스테로이드'],
  위험물: ['총기', '공기총', '석궁', '전기충격기', '가스총', '도검', '삼단봉', '불꽃놀이', '폭죽'],
  가품: ['레플리카', '이미테이션', '미러급', '정품급', '짝퉁', 'replica'],
  기타: ['도박', '카지노', '토토', '마약', '대마', 'cbd오일'],
};

// Stores we link to directly. Aggregators, community boards and used markets are not sellers.
export const STORES = [
  { name: '쿠팡', hosts: ['coupang.com', 'link.coupang.com', 'coupa.ng'], network: 'coupang' },
  { name: '11번가', hosts: ['11st.co.kr'] },
  { name: 'G마켓', hosts: ['gmarket.co.kr'] },
  { name: '옥션', hosts: ['auction.co.kr'] },
  { name: 'SSG', hosts: ['ssg.com', 'emart.ssg.com'] },
  { name: '롯데ON', hosts: ['lotteon.com'] },
  { name: '롯데하이마트', hosts: ['e-himart.co.kr'] },
  { name: '알리익스프레스', hosts: ['aliexpress.com', 'aliexpress.us', 's.click.aliexpress.com'] },
  { name: '테무', hosts: ['temu.com'] },
  { name: '오늘의집', hosts: ['ohou.se'] },
  { name: 'GS SHOP', hosts: ['gsshop.com'] },
  { name: 'CJ온스타일', hosts: ['cjonstyle.com'] },
  { name: '현대Hmall', hosts: ['hmall.com'] },
  { name: '위메프', hosts: ['wemakeprice.com'] },
  { name: '인터파크', hosts: ['interpark.com'] },
  { name: '무신사', hosts: ['musinsa.com'] },
  { name: '컬리', hosts: ['kurly.com'] },
  { name: '네이버 스마트스토어', hosts: ['smartstore.naver.com', 'brand.naver.com'] },
];
// Affiliate redirect hosts (the link itself is the tracking link).
export const AFFILIATE_HOSTS = {
  coupang: ['link.coupang.com', 'coupa.ng'],
  linkprice: ['click.linkprice.com', 'linkprice.com'],
};
// Never link here as a "buy" destination.
export const BLOCKED_LINK_HOSTS = [
  'danawa.com', 'enuri.com', 'honeydeal.ai', 'goldbox.today', 'rankingbox.kr', 'kimgoon.kr',
  'brandkr.com', 'ddanzi.com', 'bunjang.co.kr', 'joongna.com', 'daangn.com', 'ppomppu.co.kr',
  'quasarzone.com', 'fmkorea.com', 'ruliweb.com', 'clien.net', 'algumon.com',
];

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch { return ''; } };
const hostMatches = (host, list) => list.some((h) => host === h || host.endsWith(`.${h}`));

export function networkOf(url) {
  const host = hostOf(url);
  for (const [net, hosts] of Object.entries(AFFILIATE_HOSTS)) if (hostMatches(host, hosts)) return net;
  return '';
}
export function storeOf(url) {
  const host = hostOf(url);
  return STORES.find((s) => hostMatches(host, s.hosts)) || null;
}
export function isBlockedLink(url) {
  return hostMatches(hostOf(url), BLOCKED_LINK_HOSTS);
}
// A product link must point at a product, not a store front page.
export function isProductUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, '').length > 1 || u.search.length > 1;
  } catch { return false; }
}

// Accessories that merely mention a prohibited word (와인잔, 맥주컵) are fine.
const EXCEPTIONS = { 주류: ['잔', '컵', '글라스', '오프너', '병따개', '랙', '냉장고', '셀러', '거치대', '보관함', '디캔터', '스토퍼'] };

export function prohibitedReason(...texts) {
  // 값마다 따로 공백을 지운 뒤 구분자로 잇는다. 한 값 안의 띄어쓰기 우회("성 인 용 품")는
  // 그대로 걸리되, 서로 다른 값이 맞붙어 없던 단어가 생기지는 않는다
  // (제목 "완숙 토마토" + 태그 "토마토" → 예전엔 "토마토토마토"가 되어 '토토'에 걸렸다).
  const hay = texts.filter(Boolean).map((t) => String(t).toLowerCase().replace(/\s+/g, '')).join('|');
  for (const [reason, words] of Object.entries(PROHIBITED)) {
    if (EXCEPTIONS[reason]?.some((w) => hay.includes(w))) continue;
    const hit = words.find((w) => hay.includes(w.toLowerCase()));
    if (hit) return `${reason}(${hit})`;
  }
  return '';
}

// "17,320원" / "$3.49부터" / 17320 → { value, currency }
export function parsePrice(v) {
  if (typeof v === 'number') return { value: v, currency: 'KRW' };
  if (typeof v !== 'string') return null;
  const usd = /\$|usd/i.test(v);
  const m = v.replace(/,/g, '').match(/\d+(\.\d+)?/);
  if (!m) return null;
  return { value: Number(m[0]), currency: usd ? 'USD' : 'KRW' };
}

export function discountOf(price, originalPrice) {
  if (!price || !originalPrice || originalPrice <= price) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

// Text shown to visitors must be plain and free of internal notes.
const NOTE_PATTERNS = [/<[a-z/][^>]*>/i, /\[[^\]]*(필요|가입|적용|미확인|TODO|todo|확인 중)[^\]]*\]/, /파트너스 링크 (적용|미적용)/, /어필리에이트 (가입|미적용)/];
export function textProblem(s) {
  if (typeof s !== 'string') return '';
  const p = NOTE_PATTERNS.find((re) => re.test(s));
  return p ? `내부 메모/HTML 포함: "${s.slice(0, 40)}"` : '';
}

export const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

// Minimal .env loader so secrets stay outside the repo (see AGENTS.md).
export function loadEnv() {
  const files = [process.env.DHP_ENV_FILE, join(homedir(), '.config', 'dailyhomepick', 'env'), '.env.local'].filter(Boolean);
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// Not products we list (time-limited tickets, travel, services).
const OUT_OF_SCOPE = /입장권|이용권|관람권|숙박권|숙박|항공권|티켓|패키지여행|종일권|1인권|체험권|상품권|기프티콘|방문설치비|호텔형|객실|양실|온돌실|펜션|글램핑|카라반|풀빌라|콘도미니엄|\d박\s*\d일/;
export function outOfScope(title = '') {
  return OUT_OF_SCOPE.test(title) ? '여행·티켓·이용권' : '';
}

// Fallback category guess from the title when a source gives none.
const CATEGORY_WORDS = [
  ['pet', ['반려', '강아지', '고양이', '애견', '애묘', '펫', '배변패드', '사료', '캣', '츄르', '모래', '독 ']],
  ['baby', ['아기', '유아', '기저귀', '젖병', '분유', '물티슈', '이유식', '아동', '키즈', '신생아']],
  ['beauty', ['마스크팩', '마스크 팩', '컨실러', '쿠션', '립스틱', '립밤', '파운데이션', '에센스', '세럼', '토너', '스킨', '로션', '크림', '선크림', '선블록', '샴푸', '린스', '트리트먼트', '바디오일', '바디워시', '바디로션', '헤어', '브러쉬', '향수', '네일', '클렌징', '앰플', '마스카라', '아이섀도', '면도', '치약', '칫솔']],
  ['fashion', ['슈즈', '신발', '운동화', '플랫', '샌들', '부츠', '슬리퍼', '티셔츠', '셔츠', '바지', '청바지', '원피스', '자켓', '재킷', '패딩', '코트', '니트', '가디건', '맨투맨', '후드', '가방', '백팩', '지갑', '모자', '레깅스', '속옷', '팬티', '브라', '스커트']],
  ['electronics', ['충전', '이어폰', '헤드폰', '청소기', '드라이기', '전자레인지', '에어프라이어', '모니터', '노트북', '태블릿', '스피커', '가습기', '선풍기', '히터', '케이블', '보조배터리', '밥솥', '블렌더', '커피머신', '인덕션', '로봇청소기', '전기', '무선']],
  ['food', ['즉석', '햇반', '라면', '만두', '생수', '커피', '과자', '김치', '반찬', '간편식', '냉동', '닭가슴살', '견과', '시리얼', '음료', '쌀', '치즈', '라떼', '짜장', '삼겹', '두유', '빼빼로', '우유', '요거트', '두부', '소시지', '샌드위치', '황태', '로켓프레시', '한돈', '한우', '과일', '사과', '귤', '고구마', '계란']],
  ['kitchen', ['냄비', '프라이팬', '밀폐', '주방', '도마', '수저', '그릇', '텀블러', '보관용기', '지퍼백', '랩', '키친타올', '행주', '수세미', '식기', '머그']],
];
// 소스가 준 카테고리를 덮어쓰는 경우. 쿠팡 베스트 카테고리 id 매핑이 실제와
// 어긋나, 사람용 영양제와 고양이 사료가 '유아용품'으로 들어온 적이 있다.
// 제목이 명백한 신호를 줄 때만 쓰고, 애매하면 손대지 않는다.
const STRONG_CATEGORY = [
  // 반려동물이 건강식품보다 앞이다. "강아지 오메가3 져키"는 영양제가 아니라 펫 간식이다.
  ['pet', /강아지|고양이|반려견|반려묘|반려동물|애견|애묘|배변패드|건식사료|키튼|퍼피|츄르|캣타워|스크래쳐/],
  ['beauty', /유산균|비타민|오메가-?3|루테인|콜라겐|프로바이오틱|밀크씨슬|홍삼|마그네슘|글루코사민|프로폴리스|영양제|건강기능식품|락토핏|프로메가|쏘팔메토|엽산|철분제|코엔자임|아르기닌/],
  ['kitchen', /냄비|프라이팬|후라이팬|편수|양수|뚝배기|찜기|도마|식기|그릇|텀블러|보온병|밀폐용기|반찬통|수저|국자|뒤집개|채칼|거름망|수세미/],
  // 쿠팡 검색이 가전을 식품으로 보내온 적이 있다(미니 가습기 → 식품). 기기 이름이
  // 제목에 있으면 그게 더 확실한 신호다.
  ['electronics', /가습기|공기청정기|제습기|에어프라이어|전자레인지|인덕션|전기레인지|밥솥|청소기|선풍기|서큘레이터|드라이기|고데기|전기장판|전기요|토스터|커피머신|전기포트|블렌더|믹서기|정수기|모니터|노트북|태블릿|이어폰|헤드폰|스피커|충전기|보조배터리/],
];
export function strongCategory(title = '') {
  for (const [slug, re] of STRONG_CATEGORY) if (re.test(title)) return slug;
  return '';
}

// 1인 가구를 겨냥한 상품인지. '미니'·'소형'만으로는 약해서(미니 화장솜은 자취템이
// 아니다) 혼자 쓰는 살림살이에 해당할 때만 참으로 본다.
const SOLO_STRONG = /자취|원룸|1인\s*가구|일인가구|1인용|1인분|혼밥|혼술|기숙사/;
const SOLO_SMALL = /미니|소형|초소형|슬림|컴팩트|접이식|폴딩|휴대용|1구|2구|싱글|좁은/;
const SOLO_ITEM = /밥솥|인덕션|전기레인지|가스레인지|냉장고|세탁기|전자레인지|에어프라이어|토스터|커피포트|전기포트|냄비|프라이팬|도마|식탁|책상|행거|선반|수납|빨래건조대|청소기|가습기|선풍기|히터|전기장판|제습기|쿠커|그릴|샌드위치메이커|찜기|옷걸이|빨래바구니|매트|소파|침대|거울|조명|스탠드/;

export function isSoloLiving(title = '') {
  if (outOfScope(title)) return false;
  return SOLO_STRONG.test(title) || (SOLO_SMALL.test(title) && SOLO_ITEM.test(title));
}

// Returns '' when the title is out of scope.
export function guessCategory(title = '', store = '') {
  if (outOfScope(title)) return '';
  if (/알리|aliexpress|테무|temu/i.test(store)) return 'overseas';
  const t = ` ${title} `;
  for (const [slug, words] of CATEGORY_WORDS) if (words.some((w) => t.includes(w))) return slug;
  return 'living';
}

// Thumbnails must be a real product photo URL: absolute https, not a site icon/badge/placeholder.
// ads-partners.coupang.com 은 상품 사진이 아니라 제휴 배너로 리다이렉트한다(320x100 짜리).
// 쿠팡 검색 API 가 productImage 로 이 주소를 주는 경우가 있어 막아 둔다.
const ICON_PATTERNS = [/\/icons?\//i, /\/badges?\//i, /sprite/i, /placeholder/i, /no[_-]?image/i, /\/logo/i, /favicon/i, /rocket-(delivery|fresh)/i, /\/wow\.png/i, /\/event\.png/i, /\/image\/affiliate\//i, /ads-partners\.coupang\.com\/image\/(?!1\/)/i];
// ads-partners.coupang.com/image1/ 은 진짜 상품 사진(coupangcdn)으로 넘겨주는 주소지만,
// 광고 차단 목록(EasyList `||ads-partners.coupang.com^`)에 있어 차단기를 쓰는 방문자에게는
// 빈 썸네일이 된다. 서버에서 열면 멀쩡해서 checkImage 로는 안 잡혔다(2026-10-31, 250개).
// 저장 전에 resolveImage 로 넘어가는 곳의 주소로 바꾼다.
const AD_BLOCKED_IMAGE = /^https:\/\/ads-partners\.coupang\.com\//i;
export function imageProblem(url) {
  if (!url || !/^https:\/\//.test(url)) return `이미지 주소가 https 절대경로가 아님: ${String(url).slice(0, 60)}`;
  if (ICON_PATTERNS.some((re) => re.test(url))) return `상품 사진이 아닌 아이콘/로고 이미지: ${url.slice(0, 80)}`;
  if (AD_BLOCKED_IMAGE.test(url)) return `광고 차단기에 막히는 이미지 주소(ads-partners): ${url.slice(0, 60)}`;
  return '';
}
// 광고 차단기에 막히는 주소면 리다이렉트를 따라가 실제 사진 주소를 돌려준다. 그 밖의 주소는 그대로.
// 못 바꾸면 problem 을 채운다(temporary 는 checkImage 와 같은 뜻).
export async function resolveImage(url) {
  if (!url || !AD_BLOCKED_IMAGE.test(url)) return { url, problem: '', temporary: false };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 DailyHomePickBot' } });
    clearTimeout(t);
    const type = res.headers.get('content-type') || '';
    ctrl.abort();
    if (!res.ok) return { url, problem: `이미지 응답 ${res.status}`, temporary: res.status === 429 || res.status >= 500 };
    if (!type.startsWith('image/')) return { url, problem: `이미지가 아님(${type || '형식 없음'})`, temporary: false };
    const bad = imageProblem(res.url);
    if (bad) return { url, problem: bad, temporary: false };
    return { url: res.url, problem: '', temporary: false };
  } catch (e) {
    return { url, problem: `이미지 열기 실패(${e.name === 'AbortError' ? '시간 초과' : e.message})`, temporary: true };
  }
}
// 썸네일이 지금 실제로 열리는지. temporary 는 판매처가 잠깐 막은 것(429·5xx·시간 초과)이라
// 이것만으로 게시 중인 상품을 내리지 않는다. 새 후보는 temporary 여도 탈락시킨다.
export async function checkImage(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 DailyHomePickBot' } });
    clearTimeout(t);
    const type = res.headers.get('content-type') || '';
    ctrl.abort();
    if (!res.ok) return { problem: `이미지 응답 ${res.status}`, temporary: res.status === 429 || res.status >= 500 };
    if (!type.startsWith('image/')) return { problem: `이미지가 아님(${type || '형식 없음'})`, temporary: false };
    return { problem: '', temporary: false };
  } catch (e) {
    return { problem: `이미지 열기 실패(${e.name === 'AbortError' ? '시간 초과' : e.message})`, temporary: true };
  }
}
export const THUMB_HIDDEN = '썸네일 없음';
// Image proxies of other deal sites (e.g. Next.js /_next/image?url=...) → original image URL.
export function unwrapImage(url) {
  try {
    const u = new URL(url);
    const inner = u.searchParams.get('url');
    if (inner && /_next\/image|\/image\?|imgproxy/i.test(u.pathname + u.search)) return unwrapImage(inner);
  } catch { /* keep as is */ }
  return url;
}
