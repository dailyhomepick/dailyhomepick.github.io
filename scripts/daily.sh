#!/usr/bin/env bash
# Daily deal run: collect Coupang deals → auto review → partner links → build → push.
# Meant for cron on the Mac mini (see AGENTS.md "자동 실행"). Safe to run by hand.
#
#   scripts/daily.sh            # normal run
#   scripts/daily.sh --no-push  # everything except commit/push (testing)
#
# Optional Telegram alerts: put TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in
# ~/.config/dailyhomepick/env. Without them the run only writes the log.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${DHP_ENV_FILE:-$HOME/.config/dailyhomepick/env}"
LOG_DIR="$HOME/.local/state/dailyhomepick"
LOG="$LOG_DIR/daily-$(date +%Y-%m).log"
SITE="https://dailyhomepick.github.io"
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

mkdir -p "$LOG_DIR"
exec >>"$LOG" 2>&1

# One run at a time.
exec 9>"$LOG_DIR/daily.lock"
if ! flock -n 9; then
  echo "$(date '+%F %T') 이미 실행 중이라 건너뜀"
  exit 0
fi

TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""
if [ -f "$ENV_FILE" ]; then
  TELEGRAM_BOT_TOKEN="$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  TELEGRAM_CHAT_ID="$(grep -E '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi

notify() {
  [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ] || return 0
  curl -s -m 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=[Daily Home Pick] $1" >/dev/null || true
}

fail() {
  echo "$(date '+%F %T') 실패: $1"
  notify "실패: $1 (로그: $LOG)"
  exit 1
}

step() { echo "$(date '+%F %T') ▶ $*"; }

cd "$REPO" || fail "저장소 폴더 없음: $REPO"
echo
echo "===== $(date '+%F %T') daily run ====="

step "git pull"
git pull --ff-only || fail "git pull 실패 (로컬에 커밋 안 된 변경이 있거나 브랜치가 갈라짐)"

# Collection failures (API limit, network) are not fatal: the rest still refreshes the site.
step "쿠팡 골드박스"
node scripts/coupang.mjs goldbox || echo "  경고: 골드박스 수집 실패"
step "쿠팡 카테고리 베스트"
node scripts/coupang.mjs best || echo "  경고: 베스트 수집 실패"

step "가져오기·자동 검수"
IMPORT_OUT="$(node scripts/import.mjs)" || fail "import.mjs 오류"
echo "$IMPORT_OUT"

step "파트너스 링크 변환"
node scripts/coupang.mjs deeplink || echo "  경고: 딥링크 변환 실패"

step "빌드"
BUILD_OUT="$(node scripts/build.mjs 2>&1)" || { echo "$BUILD_OUT"; fail "빌드가 규칙 위반으로 중단됨 — push 안 함"; }
echo "$BUILD_OUT"

if [ "${1:-}" = "--no-push" ]; then
  step "--no-push: 커밋·push 생략"
  exit 0
fi

step "커밋·push"
git add -A
if git diff --cached --quiet; then
  echo "  바뀐 내용 없음"
else
  git commit -q -m "Daily deals $(date '+%F %H:%M')" || fail "커밋 실패"
  if ! git push -q; then
    git pull --rebase -q && git push -q || fail "push 실패"
  fi
fi

PENDING="$(node scripts/review.mjs list | tail -1)"
SUMMARY="$(echo "$IMPORT_OUT" | grep -E '게시|검수 대기' | head -1 | sed 's/^ *//')"
echo "$(date '+%F %T') 완료 · $SUMMARY · $PENDING"
case "$PENDING" in
  *"검수 대기 0개"*) ;;
  *) notify "$PENDING — $SITE/review.html 확인 후 승인해 주세요. ($SUMMARY)" ;;
esac
