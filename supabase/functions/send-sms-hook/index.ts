// Supabase Auth "Send SMS Hook" → SOLAPI 발송
//
// 필요한 Edge Function Secrets (Supabase Dashboard > Edge Functions > send-sms-hook > Secrets):
//   SEND_SMS_HOOK_SECRET  - Dashboard에서 이 훅을 Send SMS Hook으로 등록할 때 발급되는 값 (v1,whsec_... 형태)
//   SOLAPI_API_KEY        - SOLAPI 콘솔에서 발급
//   SOLAPI_API_SECRET     - SOLAPI 콘솔에서 발급
//   SOLAPI_SENDER_NUMBER  - SOLAPI에 사전 등록한 발신번호, 숫자만 (예: 01012345678)
//
// ⚠️ Supabase의 Send SMS Hook payload 형식(user.phone / sms.otp 등 필드명)과
//    실패 응답 형식은 실제 배포 전에 최신 Supabase Auth Hooks 문서로 한 번 더 확인 필요 —
//    기억에 의존해 작성했고, Supabase가 스펙을 바꿨을 수 있음.
//
// verify_jwt=false로 배포함: 이 훅은 Supabase Auth가 일반 유저 JWT가 아니라
// Standard Webhooks 방식(webhook-id/webhook-timestamp/webhook-signature 헤더 + HMAC)으로
// 호출하므로, 검증은 아래 verifyWebhookSignature()가 직접 담당한다.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

async function verifyWebhookSignature(payload: string, headers: Headers, secret: string): Promise<boolean> {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')
  if (!id || !timestamp || !signatureHeader) return false

  // Supabase가 주는 시크릿은 "v1,whsec_XXXX" 형태 — "whsec_" 뒤쪽만 base64 payload임
  const whsecIdx = secret.indexOf('whsec_')
  const secretBytes = whsecIdx >= 0 ? secret.slice(whsecIdx + 'whsec_'.length) : secret
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(secretBytes), c => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signedContent = `${id}.${timestamp}.${payload}`
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const expected = 'v1,' + btoa(String.fromCharCode(...new Uint8Array(sigBuf)))

  return signatureHeader.split(' ').some(s => s === expected)
}

async function solapiAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString()
  const salt = crypto.randomUUID()
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt))
  const signature = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

// +821012345678 / 010-1234-5678 등 다양한 입력을 SOLAPI가 원하는 01012345678 형태로 정규화
function normalizeToDomesticPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('82') && digits.length === 12) return '0' + digits.slice(2)
  return digits
}

Deno.serve(async (req: Request) => {
  const rawBody = await req.text()

  const hookSecret = Deno.env.get('SEND_SMS_HOOK_SECRET') ?? ''
  const isValid = hookSecret ? await verifyWebhookSignature(rawBody, req.headers, hookSecret) : false
  if (!isValid) {
    return new Response(JSON.stringify({ error: { http_code: 401, message: 'invalid webhook signature' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let payload: { user?: { phone?: string }; sms?: { otp?: string } }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response(JSON.stringify({ error: { http_code: 400, message: 'invalid payload' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rawPhone = payload.user?.phone
  const otp = payload.sms?.otp
  if (!rawPhone || !otp) {
    return new Response(JSON.stringify({ error: { http_code: 400, message: 'missing phone or otp' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const apiKey = Deno.env.get('SOLAPI_API_KEY') ?? ''
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET') ?? ''
  const senderNumber = Deno.env.get('SOLAPI_SENDER_NUMBER') ?? ''

  const authHeader = await solapiAuthHeader(apiKey, apiSecret)

  const solapiRes = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify({
      message: {
        to: normalizeToDomesticPhone(rawPhone),
        from: senderNumber,
        text: `[선포스] 인증번호는 ${otp} 입니다.`,
      },
    }),
  })

  if (!solapiRes.ok) {
    const errText = await solapiRes.text()
    console.error('SOLAPI 발송 실패', solapiRes.status, errText)
    return new Response(JSON.stringify({ error: { http_code: 500, message: `SOLAPI 발송 실패: ${errText}` } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.log('SOLAPI 발송 성공', normalizeToDomesticPhone(rawPhone))

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
