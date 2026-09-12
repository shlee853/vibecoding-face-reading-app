#!/usr/bin/env bash
#
# 배포용 번들을 만든다.
#
# ★ 개발 서버의 .next를 절대 건드리지 않는다.
#   예전에 이 스크립트가 .next를 지우고 다시 빌드했는데, 그때 next dev가 돌고 있으면
#   그 밑의 캐시가 사라져 개발 서버가 깨졌다
#   (Cannot find module '.next/server/middleware-manifest.json'). 두 번 겪은 뒤
#   배포 빌드를 .next-deploy 로 분리했다.
#
# Next.js의 output:'standalone'은 server.js와 필요한 node_modules만 담고
# **.next/static 과 public 은 담지 않는다.** 이걸 빠뜨리면 서버는 뜨는데
# 클라이언트 청크가 404가 나서 화면만 보이고 버튼이 전혀 동작하지 않는다 —
# 원인을 찾기 어려운 대표적인 배포 사고라 스크립트로 못박는다.
#
# 사용법:  ./scripts/build-deploy.sh
# 결과물:  deploy-bundle.tar.gz  (서버에 이것만 올리면 된다)

set -euo pipefail

cd "$(dirname "$0")/.."

# 개발 서버가 쓰는 .next 와 분리한다.
export NEXT_DIST_DIR=".next-deploy"
DIST="$NEXT_DIST_DIR"
BUNDLE_DIR="$DIST/standalone"
ARTIFACT="deploy-bundle.tar.gz"

# 빌드에 버전을 박아 헬스체크로 "서버에 무엇이 올라가 있는지" 확인할 수 있게 한다.
# CI가 이미 넘겨줬으면 그 값을 쓰고, 로컬 실행이면 현재 커밋에서 뽑는다.
export APP_VERSION="${APP_VERSION:-$(git rev-parse HEAD 2>/dev/null || echo local)}"
export APP_BUILT_AT="${APP_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

echo "==> 이전 산출물 정리 ($DIST)"
rm -rf "$DIST" "$ARTIFACT"

echo "==> 프로덕션 빌드 (version=${APP_VERSION:0:12}, distDir=$DIST)"
npx next build

echo "==> standalone 에 static / public 채워넣기"
mkdir -p "$BUNDLE_DIR/$DIST"
cp -R "$DIST/static" "$BUNDLE_DIR/$DIST/static"
if [ -d public ] && [ -n "$(ls -A public 2>/dev/null)" ]; then
  cp -R public "$BUNDLE_DIR/public"
fi

# standalone의 server.js는 자기 옆의 `.next`를 찾는다. distDir을 바꿨으므로
# 서버에서 기대하는 이름(.next)으로 맞춰준다.
if [ "$DIST" != ".next" ]; then
  mv "$BUNDLE_DIR/$DIST" "$BUNDLE_DIR/.next"
  # server.js 안의 distDir 설정도 함께 맞춘다.
  # Next는 "./.next-deploy" 처럼 ./ 접두사를 붙여 기록하므로 두 형태를 모두 처리한다.
  sed -i.bak \
    -e "s|\"distDir\":\"\./$DIST\"|\"distDir\":\"./.next\"|g" \
    -e "s|\"distDir\":\"$DIST\"|\"distDir\":\"./.next\"|g" \
    "$BUNDLE_DIR/server.js"
  rm -f "$BUNDLE_DIR/server.js.bak"
fi

echo "==> 번들 검증"
test -f "$BUNDLE_DIR/server.js"      || { echo "server.js 없음"; exit 1; }
test -d "$BUNDLE_DIR/.next/static"   || { echo ".next/static 없음"; exit 1; }
test -d "$BUNDLE_DIR/node_modules"   || { echo "node_modules 없음"; exit 1; }
grep -qE '"distDir":"\.?/?\.next"' "$BUNDLE_DIR/server.js" \
  || { echo "server.js의 distDir이 .next가 아닙니다 — 서버에서 산출물을 못 찾습니다"; \
       grep -o '"distDir":"[^"]*"' "$BUNDLE_DIR/server.js" | head -1; exit 1; }
grep -q "$DIST" "$BUNDLE_DIR/server.js" \
  && { echo "server.js에 배포 전용 경로($DIST)가 남아 있습니다"; exit 1; } || true

echo "==> 압축"
tar -czf "$ARTIFACT" -C "$BUNDLE_DIR" .

SIZE=$(du -h "$ARTIFACT" | cut -f1)
echo
echo "완료: $ARTIFACT ($SIZE)"
echo "(개발 서버의 .next는 건드리지 않았습니다)"
echo
echo "다음 단계 — 서버로 전송:"
echo "  scp -i ~/.ssh/oracle_face_reading $ARTIFACT ubuntu@168.107.8.13:~/"
