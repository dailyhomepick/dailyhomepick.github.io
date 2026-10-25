# 데일리홈픽 설정·운영 메모

마지막 정리: 2026-10-24. 키·토큰 **값**은 이 문서에 적지 않는다(공개 저장소).

## 한눈에 보기

| 항목 | 내용 |
|---|---|
| 사이트 | https://dailyhomepick.github.io |
| 저장소 | GitHub `dailyhomepick/dailyhomepick.github.io` (조직 `dailyhomepick`, 공개) |
| 맥미니 저장소 폴더 | `~/affiliate-site-preview` (브랜치 `main`) |
| 키 보관 | 맥미니 `~/.config/dailyhomepick/env` (권한 600, 저장소 밖) |
| 자동 실행 | cron, 매일 08:10·19:10 `scripts/daily.sh` |
| 실행 로그 | `~/.local/state/dailyhomepick/daily-YYYY-MM.log` |
| 운영 규칙(Hermes용) | [AGENTS.md](../AGENTS.md) |

## 상태

| 연동 | 상태 | 다음 할 일 |
|---|---|---|
| 쿠팡 파트너스 | ✅ API 연결됨 (골드박스·베스트·딥링크) | 없음. 매일 자동 수집 중 |
| 링크프라이스 | ⏳ 머천트 승인 대기 | 승인 후 딥링크 샘플·머천트 목록 확보 (아래) |
| 네이버 서치어드바이저 | ⬜ 미등록 | 사이트 등록 → 인증값을 `site.json`의 `verification.naver`에 |
| 구글 서치 콘솔 | ⬜ 미등록 | 사이트 등록 → 인증값을 `verification.google`에 |
| 검수 | 수동 단계 (`autoApprove: false`) | 익숙해지면 `true`로 |
| 텔레그램 알림 | 선택 | env에 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |

## env 파일에 들어가는 항목 (값은 직접 입력)

```
COUPANG_ACCESS_KEY=
COUPANG_SECRET_KEY=
COUPANG_SUB_ID=dailyhomepick
LINKPRICE_AFFILIATE_ID=
TELEGRAM_BOT_TOKEN=        # 선택
TELEGRAM_CHAT_ID=          # 선택
```

- 편집: `nano ~/.config/dailyhomepick/env` → 저장 `Ctrl+O`, `Enter` → 종료 `Ctrl+X` → `chmod 600 ~/.config/dailyhomepick/env`
- `echo`로 키를 넣지 않는다(셸 기록에 남음). 키를 채팅·커밋에 붙이지 않는다.
- 읽힘 확인(값 대신 글자 수만 표시):
  ```bash
  node -e 'import("./scripts/lib/rules.mjs").then(r=>{r.loadEnv();for(const k of ["COUPANG_ACCESS_KEY","COUPANG_SECRET_KEY","COUPANG_SUB_ID","LINKPRICE_AFFILIATE_ID"])console.log(k, process.env[k]?`OK(${process.env[k].length}자)`:"없음")})'
  ```

## 쿠팡 파트너스

- 연결 확인: `node scripts/coupang.mjs check`
- API는 누적 판매 15만 원 이상 "최종 승인" 후 사용 가능(이미 사용 중).
- **골드박스·베스트 응답에는 정가·할인율·카테고리명이 없다.** 그래서
  - 골드박스 상품은 `골드박스`/`특가` 배지로 표시
  - 할인 폭은 우리 가격 기록으로 계산(최근 30일 최고가보다 3% 이상 싸지면 "↓n%") → 매일 수집해야 생김
  - 카테고리는 상품명으로 추정. 입장권·이용권 등은 자동 제외
- 검색 API는 호출 한도가 작다 → 키워드 보충은 주 1~2회, 한 번에 5개 이내.

## 링크프라이스

### 지금: 머천트 승인 대기
- 딥링크 페이지(광고박스 → 딥링크, `https://ac.linkprice.net/adboxes/deep-link`)는 **승인된 머천트가 있어야** 쓸 수 있다. 승인 전엔 비어 있는 게 정상.
- 승인 알림은 가입 메일로 오는 경우가 많다. 오래 걸리면 고객센터에 일정 문의.

### 승인되면 할 일
1. 광고박스 → 딥링크에서 승인된 쇼핑몰을 고르고, 그 쇼핑몰 상품 주소 하나로 딥링크를 만든다.
2. 만든 링크(딥링크 샘플)와 **승인된 머천트 이름·ID 목록**을 Claude에게 전달한다. A코드가 들어 있어도 공개 정보라 괜찮다.
3. Claude가 `data/merchants.json`의 링크 형식을 실제 샘플에 맞추고, 승인 머천트를 `enabled: true`로 켠다.
4. 그 뒤로 승인 쇼핑몰 상품 주소는 import 때 자동으로 링크프라이스 링크로 바뀐다.

딥링크 샘플이란: 상품 주소를 내 실적 추적 링크로 바꾼 것.
- 변환 전 `https://www.11st.co.kr/products/7019152500`
- 변환 후 `https://click.linkprice.com/click.php?m=...&a=A100...&...&tu=...` 형태(실제 형식은 샘플로 확인)

### 상품 공급 (승인 후)
- **핫딜 API**(머천트별 인기·최저가 상품): 어필리에이트 센터 툴박스에서 신청. 메뉴가 안 보이면 고객센터에 요청:
  > 핫딜 API와 딥링크 API를 사용하고 싶습니다. 신청 방법과 API 문서를 받을 수 있을까요? 사이트: https://dailyhomepick.github.io
- 승인되면 Claude가 쿠팡처럼 자동 수집기를 만든다. 그 전에는 Hermes가 승인 쇼핑몰 특가 페이지에서 후보 파일(`data/inbox/linkprice-*.json`, 형식은 AGENTS.md 3장)을 만든다.
- 링크프라이스 상품이 들어오면 "오늘의 할인"에 쿠팡 외 쇼핑몰을 일정 비율로 섞는 설정을 추가할 수 있다.

## 자주 쓰는 명령 (맥미니, `~/affiliate-site-preview`에서)

```bash
# 수동으로 하루치 실행 / 테스트(push 안 함)
scripts/daily.sh
scripts/daily.sh --no-push        # 끝나고 git stash push -u 로 정리

# 검수 대기 확인 → https://dailyhomepick.github.io/review.html 을 본 뒤에만 승인
node scripts/review.mjs list
git pull --ff-only && node scripts/review.mjs approve all && node scripts/build.mjs && git add -A && git commit -m "Approve deals" && git push

# 문제 상품 반려(다시 안 들어옴) / 게시 상품 내리기
node scripts/review.mjs reject 상품ID "사유"
node scripts/review.mjs hide 상품ID

# 최근 로그
tail -50 ~/.local/state/dailyhomepick/daily-$(date +%Y-%m).log

# cron 확인 / 재등록
crontab -l
(crontab -l 2>/dev/null | grep -v dailyhomepick; echo "10 8,19 * * * $HOME/affiliate-site-preview/scripts/daily.sh # dailyhomepick") | crontab -
```

- 맥미니에 커밋 안 한 변경이 남으면 다음 자동 실행이 `git pull`에서 멈춘다 → `git status`로 확인.
- 명령을 붙여 넣을 때 설명 문장까지 같이 붙이지 않는다(검수 없이 승인된 적 있음).

## Hermes에게 전달할 말

> AGENTS.md의 "1-1. 자동 실행과 Hermes 역할"을 읽어. 매일 수집·빌드·배포는 cron의 scripts/daily.sh가 하니까 너는 같은 명령을 돌리지 마. 너는 주 1~2회 인기 검색어 갱신과 키워드 보충 수집, 실패 알림이 오면 원인 보고를 맡아. 작업 전엔 항상 git pull --ff-only, 작업 후엔 바로 커밋·push.

## 남은 일 체크리스트

- [ ] 맥미니: `git pull` → `scripts/daily.sh --no-push` 시험 → `git stash push -u` → cron 등록
- [ ] (선택) 텔레그램 알림 값 env에 추가
- [ ] Hermes에게 역할 전달
- [ ] 링크프라이스 머천트 승인 → 딥링크 샘플·머천트 목록 전달
- [ ] 링크프라이스 핫딜 API 신청/문의
- [ ] 네이버 서치어드바이저·구글 서치 콘솔 등록, 인증값 전달, 사이트맵(`/sitemap.xml`)·RSS(`/rss.xml`) 제출
- [ ] 검수 익숙해지면 `autoApprove: true`, 제휴 링크 안정되면 `requireAffiliate: true`
