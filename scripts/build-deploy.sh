#!/usr/bin/env bash
#
# 배포용 번들을 만든다.
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

BUNDLE_DIR=".next/standalone"
ARTIFACT="deploy-bundle.tar.gz"

echo "==> 이전 산출물 정리"
rm -rf .next "$ARTIFACT"

echo "==> 프로덕션 빌드"
npx next build

echo "==> standalone 에 static / public 채워넣기"
mkdir -p "$BUNDLE_DIR/.next"
cp -R .next/static "$BUNDLE_DIR/.next/static"
if [ -d public ] && [ -n "$(ls -A public 2>/dev/null)" ]; then
  cp -R public "$BUNDLE_DIR/public"
fi

echo "==> 번들 검증"
test -f "$BUNDLE_DIR/server.js"          || { echo "server.js 없음"; exit 1; }
test -d "$BUNDLE_DIR/.next/static"       || { echo ".next/static 없음"; exit 1; }
test -d "$BUNDLE_DIR/node_modules"       || { echo "node_modules 없음"; exit 1; }

echo "==> 압축"
tar -czf "$ARTIFACT" -C "$BUNDLE_DIR" .

SIZE=$(du -h "$ARTIFACT" | cut -f1)
echo
echo "완료: $ARTIFACT ($SIZE)"
echo
echo "다음 단계 — 서버로 전송:"
echo "  scp -i ~/.ssh/oracle_face_reading $ARTIFACT ubuntu@168.107.8.13:~/"
