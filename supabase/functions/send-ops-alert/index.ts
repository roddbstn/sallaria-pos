// 운영 알림 — 프린터 끊김, 미수금 발생 등 "점주(=개발자)"에게 보내는 Slack/Discord webhook 알림.
// 거래처 고객에게 보내는 send-notification(SOLAPI SMS)과는 완전히 별개 — 이건 운영자 전용.
//
// electron/index.ts(프린터 상태 변화)와 alert_overdue_accounts() pg_cron(미수금)이 호출한다.
// verify_jwt=false로 배포 — 메인 프로세스/DB 함수가 로그인 세션 없이 호출하므로.
//
// 필요한 Secrets (Supabase Dashboard > Edge Functions > send-ops-alert > Secrets):
//   OPS_ALERT_WEBHOOK_URL - Discord 채널 설정 > 연동 > 웹후크 또는 Slack Incoming Webhook URL
//   OPS_ALERT_PLATFORM    - 'discord'(기본값) 또는 'slack' — 페이로드 포맷만 다름
//   SUPABASE_SERVICE_ROLE_KEY - storeId로 매장명 조회할 때만 사용 (이미 Edge Function 기본 제공 env)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AlertPayload {
  event:      string            // 'printer_disconnected' | 'printer_reconnected' | 'overdue_balance' | ...
  storeId?:   string
  storeName?: string            // 이미 알고 있으면 DB 조회 생략
  message:    string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const payload = await req.json() as AlertPayload
    let storeName = payload.storeName ?? ''

    if (!storeName && payload.storeId) {
      const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? ''
      const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      const supabase     = createClient(supabaseUrl, serviceKey)
      const { data } = await supabase.from('stores').select('name').eq('id', payload.storeId).maybeSingle()
      storeName = data?.name ?? '알 수 없는 매장'
    }

    const webhookUrl = Deno.env.get('OPS_ALERT_WEBHOOK_URL')
    if (!webhookUrl) {
      console.warn('[OpsAlert] OPS_ALERT_WEBHOOK_URL 미설정 — 전송 건너뜀:', payload.event)
      return new Response(JSON.stringify({ ok: false, error: 'webhook not configured' }), { status: 200, headers: corsHeaders })
    }

    const platform = (Deno.env.get('OPS_ALERT_PLATFORM') ?? 'discord').toLowerCase()
    // 볼드 문법이 플랫폼마다 다름 — Slack(mrkdwn)은 별표 1개, Discord는 2개
    const bold = platform === 'slack' ? `*[${storeName || '매장 미상'}]*` : `**[${storeName || '매장 미상'}]**`
    const text = `${bold} ${payload.message}\n(${payload.event})`
    const body = platform === 'slack' ? { text } : { content: text }

    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })

    if (!res.ok) console.error('[OpsAlert] webhook 전송 실패:', res.status, await res.text())
    return new Response(JSON.stringify({ ok: res.ok }), { status: 200, headers: corsHeaders })
  } catch (e) {
    console.error('[OpsAlert] 오류:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200, headers: corsHeaders })
  }
})
