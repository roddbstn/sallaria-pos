// 관리자 등록 안내 등 SOLAPI 문자 발송 공용 Edge Function.
// sallaria-pos(사장님 앱), sunpos-kakao(고객 QR앱) 양쪽에서
// supabase.functions.invoke('send-notification', { body: {...} }) 로 호출한다.
//
// verify_jwt=true(기본값)로 배포 — 로그인한 사용자만 호출 가능.
// SOLAPI 서명 로직은 send-sms-hook과 동일 (이미 발신번호 등록·시크릿 설정 완료된 것 재사용).
//
// purpose: admin_registration / balance_alert 구현됨 (이용자 등록은 초대링크 one-way라 알림 불필요).
// 추가로 필요한 종류는 그 흐름을 만들 때 이 switch에 케이스를 추가하면 된다.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// sallaria-pos(Electron, localhost)처럼 다른 origin에서도 호출하므로 CORS 허용 필요.
// verify_jwt=true라 Authorization 헤더가 preflight에 포함됨 — Allow-Headers에 반드시 넣어야 함.
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function normalizeToDomesticPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('82') && digits.length === 12) return '0' + digits.slice(2)
  return digits
}

async function sendSolapiSms(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('SOLAPI_API_KEY') ?? ''
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET') ?? ''
  const senderNumber = Deno.env.get('SOLAPI_SENDER_NUMBER') ?? ''
  const authHeader = await solapiAuthHeader(apiKey, apiSecret)

  const res = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify({
      message: { to: normalizeToDomesticPhone(to), from: senderNumber, text },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('SOLAPI 발송 실패', res.status, errText)
    return { ok: false, error: errText }
  }
  return { ok: true }
}

type NotifyPayload =
  | { purpose: 'admin_registration'; phone: string; params: { storeName: string; accountName: string; link: string } }
  | { purpose: 'balance_alert'; phone: string; params: { storeName: string; accountName: string; balance: number } }

function buildMessage(payload: NotifyPayload): string {
  // SOLAPI 경유 발송 시 \n만 쓰면 통신사 쪽에서 줄바꿈이 사라져 텍스트가 한 줄로 붙어버리고,
  // 그 결과 링크 앞뒤 구분이 없어져 자동 하이퍼링크 인식이 깨짐 — \r\n(CRLF)으로 줄바꿈해야 함.
  switch (payload.purpose) {
    case 'admin_registration': {
      const { storeName, accountName, link } = payload.params
      return `[${storeName}] 관리자등록\r\n${accountName}\r\n${link}`
    }
    case 'balance_alert': {
      const { storeName, accountName, balance } = payload.params
      return `[${storeName}] 잔액부족\r\n${accountName} ${balance.toLocaleString()}원`
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  let payload: NotifyPayload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!payload?.phone || !payload?.purpose) {
    return new Response(JSON.stringify({ error: 'missing phone or purpose' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const text = buildMessage(payload)
  const result = await sendSolapiSms(payload.phone, text)

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error ?? '발송 실패' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
