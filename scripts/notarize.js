const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return
  if (!process.env.APPLE_ID) return // CI 아닐 때 스킵

  const appName = context.packager.appInfo.productFilename
  console.log(`공증 시작: ${appName}.app`)

  await notarize({
    tool: 'notarytool',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })

  console.log('공증 완료')
}
