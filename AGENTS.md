# 데일리홈픽 운영 규칙

사이트: https://dailyhomepick.github.io · 저장소: `dailyhomepick/dailyhomepick.github.io`
목표: **할인율이 높고 제휴 링크(쿠팡 파트너스 우선, 그다음 링크프라이스)가 있는 상품**을 매일 많이 올려 검색 노출과 클릭을 늘린다.

## 0. 절대 규칙

1. **HTML을 직접 만들거나 고치지 않는다.** `index.html`, `today.html`, `posts/`, `categories/`, `tags/`, `k/`, `p/`, `search.html`, `review.html`, `404.html`, `sitemap.xml`, `rss.xml`, `robots.txt`, `assets/search.json`은 전부 `node scripts/build.mjs`의 생성물이다.
2. **상품은 `data/products.json`에 손으로 넣지 않는다.** 후보 파일을 `data/inbox/`에 만들고 `node scripts/import.mjs`로 가져온다. 이 스크립트가 자동 검수·중복 제거·제휴 링크 변환·가격 기록을 한다.
3. **API 키·비밀번호·토큰을 저장소, 커밋, 로그, 채팅에 절대 쓰지 않는다.** 이 저장소는 공개다. (아래 "키 보관")
4. `node scripts/build.mjs`가 오류로 멈추면 **오류를 고치고** 다시 빌드한다. 검사를 끄거나 우회하지 않는다.
5. 셸 heredoc이나 `echo`로 JSON을 쓸 때 `$`가 사라지는 사고가 있었다(`$3.79` → `.79`). JSON 파일은 Node나 파일 쓰기 도구로 만든다.

## 1. 매일 순서

```bash
git pull --ff-only
node scripts/coupang.mjs goldbox          # 쿠팡 골드박스 (최종 승인 후 사용 가능)
node scripts/coupang.mjs best             # 쿠팡 카테고리 베스트
#   + 링크프라이스 핫딜/딥링크로 만든 후보 파일 → data/inbox/linkprice-*.json (2장)
node scripts/import.mjs                   # 자동 검수 후 가져오기 (inbox 파일은 data/inbox/done/으로 이동)
node scripts/coupang.mjs deeplink         # 일반 쿠팡 링크 → 파트너스 링크 일괄 변환
node scripts/build.mjs                    # 사이트 생성 (규칙 위반 시 중단)
git add -A && git commit -m "Daily deals YYYY-MM-DD" && git push
```

- 하루 1~2회 실행. 같은 상품이 다시 들어오면 새로 만들지 않고 **가격·확인일만 갱신**되며 가격 기록(`priceHistory`)이 쌓인다.
- `site.json`의 `publish.staleDays`(3일)보다 오래 확인 안 된 상품은 오늘의 할인에서 빠지고, `expireDays`(21일)가 지나면 목록·사이트맵에서 빠진다(상품 페이지는 "지난 할인"으로 남음). **살아있는 상품은 매일 다시 확인해 checkedAt을 갱신**하는 게 노출에 유리하다.

### 검수 단계 (지금은 수동 → 나중에 자동)

- 현재 `data/site.json` → `publish.autoApprove: false`. 가져온 상품은 `pending` 상태가 되고 https://dailyhomepick.github.io/review.html 에 모인다.
- **승인 명령은 review.html을 실제로 본 다음에만 실행한다.** 명령어를 한꺼번에 붙여 넣어 검수 없이 승인되는 일이 있었다.
- 사람이 확인 후: `node scripts/review.mjs approve all` 또는 `approve ID ...`, 문제 상품은 `node scripts/review.mjs reject ID "사유"`(다시 안 들어옴), 게시된 상품 내리기는 `hide ID`.
- 사용자가 자동 전환을 지시하면 `autoApprove: true`로 바꾼다. 그 뒤로는 자동 검수를 통과한 상품이 바로 게시된다.

## 1-1. 자동 실행과 손으로 하는 일

매일 반복 작업은 **`scripts/daily.sh`가 cron으로 자동 실행**한다(하루 2회). 같은 명령을 손으로 또 돌리지 않는다.
- 하는 일: git pull → 쿠팡 골드박스·베스트 수집 → import(자동 검수) → 파트너스 링크 변환 → 빌드 → 바뀐 게 있으면 커밋·push.
- 빌드가 규칙 위반으로 멈추면 push하지 않는다. 로그: `~/.local/state/dailyhomepick/daily-YYYY-MM.log`. 텔레그램 값이 env에 있으면 실패·검수 대기를 알린다.
- 수동 실행: `scripts/daily.sh` (테스트는 `scripts/daily.sh --no-push`).

**사람(또는 에이전트)이 맡는 일**

아래 표는 전에 "Hermes가 주 1~2회 한다"로 적혀 있었는데 아무도 하지 않아,
10월 24일에 넣은 인기 검색어가 그대로 남아 있었다. 자동화할 수 있는 건 daily.sh 로 옮겼다.

| 일 | 누가 | 주기 |
|---|---|---|
| 인기 검색어로 쿠팡 검색 보충 (`scripts/trending.mjs`) | daily.sh | 매일 아침, 4개씩 돌아가며 |
| 게시 상품 썸네일 다시 확인·숨김 (`scripts/images.mjs`) | daily.sh | 매 실행 |
| 검색 노출 규칙 검사(5장) | daily.sh(빌드) | 매 실행, 어기면 push 안 함 |
| 텔레그램 채널에 진짜 인하 상품 올리기 (`scripts/telegram.mjs`) | cron(따로) | 매일 08:30·18:30 KST, 5개씩 |
| 인기 검색어 목록(`site.json` → `trending`) 자체를 갈아끼우기 | 사람 | 상품이 안 붙는 키워드가 쌓이면 |
| 링크프라이스 후보 파일 만들기 | 보류 | 상품 API 승인 후 |
| daily.sh 실패 알림이 오면 로그를 보고 원인 보고 | 사람 | 필요 시 |

`node scripts/trending.mjs --check` 로 키워드별 상품 수를 볼 수 있다. 0건이 늘면
그 키워드는 이 사이트가 다루는 상품과 안 맞는 것이니 다른 말로 바꾼다.

저장소를 손으로 고칠 때는 작업 전 `git pull --ff-only`, 작업 후 바로 커밋·push 한다.
커밋하지 않은 변경을 남겨 두면 다음 자동 실행이 `git pull` 단계에서 멈춘다.

## 2. 상품 소스와 우선순위

같은 상품이 여러 곳에 있으면 **쿠팡 파트너스 링크가 있는 쪽**을 쓴다. 그다음 링크프라이스.

### 쿠팡 파트너스 (1순위)
- `scripts/coupang.mjs`가 Open API를 호출한다. API는 **누적 판매 15만 원 이상 "최종 승인" 후**에만 열린다. 승인 전에는 401/403이 나므로 `node scripts/coupang.mjs check`로 상태를 확인한다.
- 승인 전: 사람이 파트너스 대시보드 "링크 생성"으로 만든 `https://link.coupang.com/a/...` 링크를 후보 파일의 `affiliateLink`에 넣는다.
- 골드박스가 할인율이 있어 가장 좋다. 검색 API(`search`)는 호출 한도가 작으니 하루 몇 개 키워드만.
- API가 주는 `productUrl`은 이미 파트너스 링크다. `productImage`가 그 상품의 공식 이미지다(썸네일 일치 보장).

- **골드박스·베스트 API 응답에는 정가·할인율·카테고리명이 없다.** 그래서 골드박스 상품은 `골드박스` 배지로 표시하고, 할인 폭은 우리 가격 기록으로 계산한다(같은 상품을 다시 가져왔을 때 최근 30일 최고가보다 3% 이상 싸면 `priceDropRate`, 화면에는 "↓n%"). **매일 수집해야 이 값이 생긴다.** 정가를 임의로 만들어 넣지 않는다.
- 골드박스는 카테고리명이 없어 상품명으로 분류한다(`guessCategory`). 입장권·이용권·숙박·항공권 같은 상품은 사이트 범위 밖이라 자동 탈락하고, 이미 게시된 것은 자동으로 내려간다.

### 링크프라이스 (2순위)
- 머천트 제휴가 승인된 쇼핑몰만 `data/merchants.json`에 `id`를 채우고 `enabled: true`로 바꾼다. 승인 안 된 머천트 링크는 실적이 잡히지 않는다.
- `merchants.json`의 `template`은 어필리에이트 센터에서 만든 실제 딥링크와 같은 형식인지 확인 후 `verified: true`로 바꾼다. 형식이 다르면 템플릿을 실제 형식에 맞게 고친다(`{merchant}`, `{affiliateId}`, `{subId}`, `{url}` 자리표시자).
- 어필리에이트 ID는 환경변수 `LINKPRICE_AFFILIATE_ID`. 후보에 `affiliateLink`가 없고 판매처가 승인 머천트면 import가 딥링크를 자동으로 만든다.
- 핫딜 API(머천트별 인기·최저가 상품)를 쓸 수 있으면 그 결과를 아래 후보 형식으로 바꿔 `data/inbox/linkprice-hotdeal-YYYYMMDD.json`으로 저장한다. API가 클릭 URL을 주면 그대로 `affiliateLink`에 넣는다.

### 그 밖의 출처
- 핫딜 모음 사이트·커뮤니티는 **상품을 찾는 참고용**일 뿐, 링크·이미지는 반드시 **판매처 상품 페이지의 것**을 쓴다. 판매처 아닌 사이트(다나와·에누리·핫딜 모음·커뮤니티·중고장터) 링크는 자동 탈락한다.
- 다른 사이트의 이미지 프록시 주소(`/_next/image?url=...`)는 import가 원본 주소로 되돌린다.

## 3. 후보 파일 형식 (`data/inbox/*.json`)

JSON 배열. 한 항목:

```json
{
  "source": "linkprice-hotdeal",
  "sourceId": "11st-7019152500",
  "title": "판매 페이지와 같은 실제 상품명",
  "image": "https://판매처 CDN의 상품 대표 이미지",
  "price": 51900,
  "originalPrice": 82000,
  "link": "https://www.11st.co.kr/products/7019152500",
  "affiliateLink": "",
  "store": "11번가",
  "categories": ["pet"],
  "tags": ["반려동물", "자동급식기"],
  "badges": ["무료배송"],
  "summary": "",
  "specs": [["용량", "3.5L"]],
  "caution": ""
}
```

- `price`·`originalPrice`는 숫자(원). 달러는 `"$3.49"`처럼 문자열 가능. **정가는 판매 페이지에 표시된 값만** 쓴다. 정가를 모르면 `discountRate`(숫자)만 넣어도 된다.
- `sourceId`는 출처별 고유 ID(중복 판별에 사용). 쿠팡은 `coupang-상품번호`.
- `categories`: `living, kitchen, solo-living, pet, baby, electronics, food, beauty, fashion, overseas` 중에서. 비우면 상품명으로 자동 분류.
- `summary`는 비워도 된다(판매처·가격·할인율로 자동 문장 생성). 쓸 경우 **상품마다 다른 한 문장**.
- `specs`·`summary`·`caution`에 HTML, `[...필요]` 같은 메모, "미확인" 금지.

## 4. 자동 검수 규칙 (scripts/lib/rules.mjs)

import가 아래 중 하나라도 걸리면 탈락시키고 `data/rejected.json`에 남긴다(같은 상품 재수집 방지).

| 항목 | 기준 |
|---|---|
| 썸네일 | https 절대경로, 실제로 열리는 이미지(image/*), 아이콘·로고·배지·플레이스홀더 아님. **반드시 그 상품 페이지의 대표 이미지** |
| 가격 | 숫자, 0원 아님, 100원~2천만 원, 정가 ≥ 판매가, 할인율 95% 이하 |
| 할인율 | `publish.minDiscount`(10%) 미만 탈락. 할인율 모르는 상품은 `allowUnknownDiscount`가 true일 때만 통과 |
| 범위 밖 | 입장권·이용권·숙박·항공권·상품권 등 (`OUT_OF_SCOPE`) |
| 금지 품목 | 성인용품, 담배·전자담배, 주류, 의약품, 무기·위험물, 가품, 도박 (`PROHIBITED` 목록). 와인잔·맥주컵 같은 용품은 예외 |
| 링크 | 판매처 **상품 페이지**(첫 화면 X). 비교·핫딜·커뮤니티·중고 사이트 X |
| 문구 | HTML 태그, 내부 메모 금지 |
| 제휴 링크 | `publish.requireAffiliate`가 true면 제휴 링크 없는 상품 탈락(쿠팡/링크프라이스 연동이 안정되면 true로) |

금지 단어가 새로 필요하면 `PROHIBITED`에 추가한다. 빌드도 같은 규칙으로 게시 상품을 다시 검사한다.

**이미 올라간 상품의 썸네일**: import는 새 후보의 사진만 본다. 판매처가 나중에 사진을 내리면 빈 카드가 남으므로
`scripts/images.mjs`가 매 실행마다 게시 상품 전체의 사진을 다시 연다. 404·이미지 아님은 바로 숨기고,
429·5xx·시간 초과는 판매처가 잠깐 막은 것일 수 있어 3일 연속일 때만 숨긴다. 숨긴 상품은 `hiddenReason`이
`썸네일 없음:`으로 시작하고, 사진이 다시 열리면(또는 import가 열리는 새 사진을 받으면) 자동으로 되살아난다.

## 5. 검색 노출(SEO)을 위해 할 일

정렬 기본값: **제휴 링크 있는 상품 → 할인율·가격 인하·골드박스** 순. 생성기가 자동으로 하는 것: 페이지별 제목·설명, canonical, Open Graph, 상품 구조화 데이터(Product/Offer), 목록(ItemList), 경로(BreadcrumbList), 사이트 검색(SearchAction), `sitemap.xml`(lastmod 포함), `rss.xml`, 오래된 상품 noindex, 인기 검색어 랜딩 페이지(`/k/키워드.html`), 태그 페이지(`/tags/태그.html`), 품목별 FAQ(FAQPage).

**빌드가 매번 검사하는 규칙** (어기면 빌드가 멈추고 push 하지 않는다):
- 사이트맵에는 **모아 보는 페이지만** 싣는다 — 메인·오늘의 할인·카테고리·글·키워드·태그. 상품 페이지(`/p/`)는 사이트에 두되 사이트맵에서 뺀다. 새 사이트가 자동 생성 페이지를 한꺼번에 내밀면 구글이 "크롤링됨 - 색인 안 함"으로 미뤄 둔다(2026-10-28, 4일 만에 1,827개가 되어 유입 0).
- 상품이 `publish.sitemapMinTag`(3)개 미만인 태그 페이지도 사이트맵에서 뺀다.
- 사이트맵 주소는 `publish.sitemapMax`(400)개 이하. 넘으면 기준을 올리기 전에 얇은 페이지가 늘었는지부터 본다.
- 사이트맵의 모든 페이지는 제목·설명·canonical(자기 주소)이 있고 noindex가 아니어야 하며, 제목이 서로 겹치면 안 된다.

손으로 챙길 것:
- **인기 검색어 갱신(주 1~2회)**: `data/site.json`의 `trending`(16개 안팎)을 네이버 데이터랩 쇼핑인사이트·쿠팡 검색 추이 등에서 생활용품 위주로 고른다. 상품이 1개 이상 매칭되는 키워드만 `/k/` 페이지가 생긴다. 키워드에 맞는 상품을 `coupang.mjs search 키워드`로 보충한다.
- **태그**: `scripts/lib/keywords.mjs`의 사전으로 상품명에서 자동으로 붙는다(품목 1개 + 특징·대상 최대 3개). 손으로 넣은 태그가 있으면 그대로 둔다. 사전에 없는 품목은 태그가 비는데, 그런 상품이 쌓이면 `ITEMS`에 품목 이름을 넣는다. **확신이 없으면 비워 두는 쪽이 낫다** — 틀린 태그는 엉뚱한 태그 페이지를 만든다.
- **품목별 FAQ**: `scripts/lib/faq.mjs`에 품목 이름을 키로 문답을 넣으면 그 품목 상품 페이지에 FAQ 블록과 FAQPage 구조화 데이터가 붙는다. 상품이 아니라 **품목**을 설명한다(특정 제품의 착용감·내구성처럼 확인할 수 없는 건 쓰지 않고, 브랜드마다 다른 값은 "표기를 확인하라"고 연다). 모든 상품에 같은 문답을 붙이면 중복 콘텐츠가 되므로 사전에 있는 품목에만 붙는다.
- **카테고리**: 소스가 준 분류가 틀릴 때가 있다(쿠팡 베스트 카테고리 id 매핑 탓에 사람용 영양제와 고양이 사료가 '유아용품'으로 들어왔다). `rules.mjs`의 `strongCategory()`가 제목이 명백할 때만 덮어쓴다. 손으로 재분류할 때는 틀린 카테고리를 **지우고 대체**한다 — 덧붙이면 빌드가 양쪽 카테고리 페이지에 모두 올린다.
- **상품명**: 판매처 상품명 그대로(브랜드+모델+용량). 꾸밈말 추가 금지.
- **매일 갱신**: 같은 상품이라도 가격을 다시 확인해 import하면 확인일·가격 기록이 쌓여 페이지가 "살아있는" 상태로 유지된다.
- 검색엔진 등록용 인증값은 `site.json`의 `verification.naver` / `verification.google`에 넣는다(값만, 태그 전체 X).

## 6. 지킬 것 (광고·표시)

- 별점·리뷰 수·배송 문구는 **판매처에 실제 표시된 것만**. 임의 수치 금지(표시광고법).
- 쿠팡 링크가 있는 페이지에는 쿠팡 지정 문구가 자동으로 표시된다(`coupangDisclosure`). 문구를 지우거나 바꾸지 않는다.
- 클릭 유도용 가짜 타이머·"마감 임박" 같은 허위 문구 금지.

## 7. 키 보관

환경변수 또는 저장소 밖 파일 `~/.config/dailyhomepick/env`(스크립트가 자동으로 읽음, 권한 600):

```
COUPANG_ACCESS_KEY=...
COUPANG_SECRET_KEY=...
COUPANG_SUB_ID=dailyhomepick
LINKPRICE_AFFILIATE_ID=A100...
```

`.env`, `.env.*`, `data/inbox/`는 `.gitignore`에 있다. 그래도 커밋 전 `git diff --cached`에 키가 없는지 확인한다.

## 8. 파일 지도

| 파일 | 역할 |
|---|---|
| `data/site.json` | 사이트 설정, 게시 규칙(`publish`), 인기 검색어(`trending`), 고지 문구, 검색엔진 인증값 |
| `data/products.json` | 상품 (import/review 스크립트가 관리). `status`: published / pending / hidden |
| `data/posts.json` | 날짜별 글. import·approve가 그날 `YYYY-MM-DD-deals` 글에 자동 추가 |
| `data/categories.json` | 카테고리 10개 (living, kitchen, solo-living, pet, baby, electronics, food, beauty, fashion, overseas) |
| `data/merchants.json` | 링크프라이스 머천트·딥링크 형식 |
| `data/rejected.json` | 탈락·반려 기록 |
| `scripts/coupang.mjs` | 쿠팡 수집·딥링크 |
| `scripts/import.mjs` | 후보 가져오기 + 자동 검수 |
| `scripts/review.mjs` | 승인·반려·내리기 |
| `scripts/make-session.mjs` | 브라우저에서 복사한 cURL → 헤드리스용 로그인 세션 파일 |
| `scripts/build.mjs` | 사이트 생성 |
| `scripts/lib/rules.mjs` | 검수 규칙(금지 품목, 판매처, 이미지, 가격), 카테고리 추정·보정 |
| `scripts/images.mjs` | 게시 상품 썸네일 재확인, 사진이 없어진 상품 숨김·되살림 |
| `scripts/lib/keywords.mjs` | 상품명 → 태그 사전(품목·특징·대상). 제목·설명의 검색 키워드도 여기서 나온다 |
| `scripts/lib/faq.mjs` | 품목별 자주 묻는 질문 |
| `assets/styles.css`, `assets/app.js` | 디자인·검색·정렬·필터 |
