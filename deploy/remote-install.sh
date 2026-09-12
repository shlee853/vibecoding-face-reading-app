#!/usr/bin/env bash
#
# 서버에서 실행되는 설치 스크립트. GitHub Actions가 번들과 함께 올려 실행한다.
#
# 핵심은 **실패하면 되돌린다**는 것이다. 자동 배포에서 가장 위험한 것은
# 잘못된 빌드가 조용히 올라가 서비스가 죽은 채 방치되는 상황이다.
# 새 버전이 헬스체크를 통과하지 못하면 이전 버전으로 자동 복구한다.

set -euo pipefail

APP_DIR="$HOME/face-reading"
NEW_DIR="$HOME/face-reading.new"
OLD_DIR="$HOME/face-reading.old"
BUNDLE="$HOME/deploy-bundle.tar.gz"
HEALTH="http://127.0.0.1:3000/api/health"

log() { echo "[install] $*"; }

test -f "$BUNDLE" || { log "번들이 없습니다: $BUNDLE"; exit 1; }

log "번들 펼치는 중"
rm -rf "$NEW_DIR"
mkdir -p "$NEW_DIR"
tar -xzf "$BUNDLE" -C "$NEW_DIR"

# standalone은 .next/static을 담지 않는 함정이 있다. 여기서 한 번 더 막는다.
log "번들 검증"
test -f "$NEW_DIR/server.js"        || { log "server.js 없음 — 번들이 잘못됐습니다"; exit 1; }
test -d "$NEW_DIR/.next/static"     || { log ".next/static 없음 — 정적 파일이 빠졌습니다"; exit 1; }
test -d "$NEW_DIR/node_modules"     || { log "node_modules 없음"; exit 1; }

log "교체"
rm -rf "$OLD_DIR"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$OLD_DIR"
mv "$NEW_DIR" "$APP_DIR"

log "서비스 재시작"
sudo systemctl restart face-reading

log "헬스체크 대기"
healthy=""
for i in $(seq 1 20); do
  if curl -sf --max-time 3 "$HEALTH" > /tmp/health.json 2>/dev/null; then
    healthy="yes"
    break
  fi
  sleep 1
done

if [ -z "$healthy" ]; then
  log "헬스체크 실패 — 이전 버전으로 되돌립니다"
  if [ -d "$OLD_DIR" ]; then
    rm -rf "$APP_DIR"
    mv "$OLD_DIR" "$APP_DIR"
    sudo systemctl restart face-reading
    log "롤백 완료. 서비스는 이전 버전으로 돌아갑니다"
  else
    log "되돌릴 이전 버전이 없습니다"
  fi
  log "--- 최근 로그 ---"
  sudo journalctl -u face-reading -n 30 --no-pager || true
  exit 1
fi

log "배포 성공"
cat /tmp/health.json
echo
rm -f "$BUNDLE"
