const { notarize } = require('@electron/notarize')
const { spawnSync } = require('node:child_process')

/**
 * macOS 공증(notarization).
 *
 * ⚠️ **Developer ID Application 인증서로 서명된 앱만 공증된다.**
 *
 * 2026-10-26 릴리즈 실패가 정확히 이것이었다. CI 키체인에 들어 있던 건
 * "Apple Development: ..." 인증서였고, electron-builder 는 그걸로 서명한 뒤
 * 공증을 넣었다가 모든 바이너리가 거부당했다:
 *
 *     "The binary is not signed with a valid Developer ID certificate."
 *
 * Apple Development 는 **내 기기에서 돌려보는 용도**다. 앱스토어 밖으로
 * 배포하려면 Developer ID Application 이 따로 필요하다(같은 계정에서 발급).
 *
 * 그래서 여기서 **서명 종류를 직접 확인하고**, Developer ID 가 아니면 조용히
 * 건너뛴다. 빌드를 통째로 실패시키는 대신 서명 없는 dmg 라도 나오게 하는 쪽이
 * 낫다 — 설치는 되고(우클릭 → 열기), 그동안 매장은 기다리지 않아도 된다.
 * 인증서를 제대로 넣으면 이 함수가 알아서 다시 켜진다.
 */
function signedWithDeveloperId(appPath) {
  // ⚠️ codesign 은 결과를 **stderr** 로 뱉는다. execFileSync 는 성공했을 때
  //    stdout 만 돌려주므로 늘 빈 문자열이 되어 "서명 안 됨" 으로 오판한다
  //    (v1.3.2 에서 실제로 그랬다 — 서명은 멀쩡했는데 공증을 건너뛰었다).
  //    spawnSync 로 둘 다 받는다.
  const r = spawnSync('codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return out.includes('Developer ID Application')
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return
  if (!process.env.APPLE_ID) return // 로컬 빌드 — 공증 자격증명이 없다

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`

  if (!signedWithDeveloperId(appPath)) {
    console.log(
      '[notarize] 건너뜀 — Developer ID Application 인증서로 서명되지 않았습니다.\n' +
      '           (Apple Development 인증서로는 공증할 수 없습니다)\n' +
      '           서명 없는 빌드로 계속 진행합니다.',
    )
    return
  }

  console.log(`공증 시작: ${appName}.app`)
  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })
  console.log('공증 완료')
}
