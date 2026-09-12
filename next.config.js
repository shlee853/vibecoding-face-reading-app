/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * 배포용 산출물을 한 덩어리로 만든다.
   *
   * `.next/standalone`에 필요한 node_modules까지 추려 담아주므로, 서버에서 다시
   * `npm install`이나 `next build`를 하지 않아도 된다. Oracle Always Free의 AMD 인스턴스는
   * RAM이 1GB뿐이라 거기서 빌드하면 메모리 부족으로 실패하기 쉽다 —
   * **빌드는 개발 기계에서 하고 산출물만 올리는** 방식이 안전하다.
   */
  output: 'standalone',

  // 배포 산출물에 소스맵을 넣지 않는다 (용량과 노출 최소화).
  productionBrowserSourceMaps: false,

  /**
   * 빌드 시점에 버전을 박아 넣는다.
   *
   * 왜: 서버에 어떤 코드가 올라가 있는지 밖에서 알 방법이 없으면, 고친 게 반영됐는지
   * 매번 추측하게 된다. 실제로 "키 검증 수정이 서버에 있나?"를 확인할 수 없어 곤란했다.
   * 헬스체크가 커밋 해시를 알려주면 그 질문이 사라진다.
   */
  env: {
    APP_VERSION: process.env.APP_VERSION || 'dev',
    APP_BUILT_AT: process.env.APP_BUILT_AT || new Date().toISOString(),
  },
}

module.exports = nextConfig
