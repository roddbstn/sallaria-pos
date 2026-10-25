// support_tickets 에 새 티켓이 들어오면 Slack으로 알린다.
//
// ⚠️ 이 파일은 2026-10-22 에 **배포본에서 되가져온 것**이다. 원래 레포에 소스가 없었고
//    대시보드/CLI 로 직접 배포돼 있었다 — 코드 리뷰도 롤백도 안 되는 상태였다.
//    앞으로는 여기를 고쳐서 배포한다.
//
// 설계 원칙 (운영문서 §5.2):
//  - 진실은 DB(support_tickets). Slack은 "알림 채널"일 뿐 저장소가 아니다.
//    Slack만 받으면 "이번 달 프린터 문의 몇 건"을 셀 수 없다.
//  - 1단계 에이전트는 진단하지 않고 "분류 + 증거 정리"만 한다. taxonomy 표가
//    얇은 상태에서 원인을 추측하면 틀린 답을 자신 있게 낸다.
//  - 메시지에는 점주에게 그대로 복사해 보낼 문구 초안을 같이 넣는다 (원리 ③ 담당자 언어로 번역).
//
// 웹훅 시크릿: send-ops-alert 가 이미 쓰고 있는 OPS_ALERT_WEBHOOK_URL 을 재사용한다.
// Supabase 의 Edge Function 시크릿은 함수별이 아니라 프로젝트 전체 공용이라 그냥 읽힌다 —
// 운영 알림과 문의가 같은 채널(#선포스-알림)로 모이는 게 1인 운영에는 오히려 낫다.
// SLACK_WEBHOOK_URL 은 따로 채널을 분리하고 싶을 때를 위한 우선 오버라이드로 남겨둔다.

interface Ticket {
  id: string
  store_id: string
  source: string
  summary: string | null
  payload: Record<string, unknown>
  created_at: string
}

/** 증거만 보고 고를 수 있는 것만 고른다. 애매하면 분류하지 않고 사람에게 넘긴다. */
function classify(t: Ticket): { code: string; severity: string; reason: string; reply: string } | null {
  const p = t.payload as {
    connected?: boolean
    selected?: string
    ports?: { path: string }[]
    recentPrintFailures?: number
  }
  const portCount = p.ports?.length ?? 0

  if (t.source !== 'printer_diag') return null

  if (portCount === 0) {
    return {
      code: 'E-PRINT-003',
      severity: 'C',
      reason: '포스가 프린터를 하나도 인식하지 못함 — 전원 또는 케이블',
      reply: '사장님, 지금 포스가 프린터를 아예 못 찾고 있어요.\n프린터 전원 버튼이 켜져 있는지, 포스와 연결된 선이 양쪽 다 꽂혀 있는지 확인 부탁드려요.\n선을 다시 꽂으신 뒤 설정 화면에서 [다시 찾기]를 눌러주세요.',
    }
  }
  if (portCount > 0 && !p.selected) {
    return {
      code: 'E-PRINT-001',
      severity: 'C',
      reason: '프린터는 잡혔는데 고르지 않음 — 설정 미완료',
      reply: '사장님, 프린터는 잘 연결돼 있는데 어떤 걸 쓸지 아직 안 고르신 상태예요.\n설정 > 프린터 연결에서 목록에 뜬 프린터를 한 번 눌러주시면 바로 됩니다.',
    }
  }
  if (portCount > 0 && p.selected && p.connected === false) {
    return {
      code: 'E-PRINT-002',
      severity: 'C',
      reason: '포트는 있는데 열리지 않음 — 다른 프로그램이 점유 중일 가능성',
      reply: '사장님, 프린터는 컴퓨터에 잡혀 있는데 선포스가 열지 못하는 상태예요.\n기존에 쓰시던 포스 프로그램이 켜져 있으면 완전히 종료해주시고,\n프린터 전원을 껐다 켠 뒤 [다시 찾기]를 눌러주세요.',
    }
  }
  return null
}

Deno.serve(async (req: Request) => {
  // SLACK_WEBHOOK_URL 이 있으면 그걸(채널 분리용), 없으면 운영 알림과 같은 채널
  const webhook = Deno.env.get('SLACK_WEBHOOK_URL') ?? Deno.env.get('OPS_ALERT_WEBHOOK_URL')
  if (!webhook) {
    return new Response(
      JSON.stringify({ error: 'OPS_ALERT_WEBHOOK_URL / SLACK_WEBHOOK_URL 둘 다 미설정' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let body: { record?: Ticket; storeName?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 })
  }

  const t = body.record
  if (!t) return new Response(JSON.stringify({ error: 'no record' }), { status: 400 })

  const storeName = body.storeName ?? (t.payload?.storeName as string) ?? t.store_id.slice(0, 8)
  const verdict = classify(t)

  const lines: string[] = [
    `*\u{1F4E8} [${storeName}] ${t.summary ?? '도움 요청'}*`,
    `출처 \`${t.source}\` · 티켓 \`${t.id.slice(0, 8)}\``,
  ]

  // 점주가 직접 쓴 본문은 분류 결과보다 위에 — 제일 먼저 읽어야 하는 정보다
  const message = (t.payload?.message as string | undefined)?.trim()
  if (message) lines.push('', '*보내신 내용*', '>>> ' + message.replace(/\n/g, '\n'))

  if (verdict) {
    lines.push(
      '',
      `*분류* \`${verdict.code}\` · 판정 *${verdict.severity}*`,
      `${verdict.reason}`,
      '',
      '*점주에게 보낼 문구* (그대로 복사)',
      '```',
      verdict.reply,
      '```',
    )
  } else if (t.source === 'printer_diag') {
    // 분류표에 없는 패턴 — 추측하지 않고 사람에게 넘긴다
    lines.push(
      '',
      '*분류 불가* — 아래 증거를 보고 판단이 필요해요.',
      '판단하신 결과를 taxonomy 표에 한 줄 추가해 주세요. 다음부터 자동 분류됩니다.',
    )
  }

  lines.push('', '*증거*', '```', JSON.stringify(t.payload, null, 2).slice(0, 2500), '```')

  // ── Slack 전송 ──
  //
  // ⚠️ 여기서 실패하면 **반드시 2xx 가 아닌 상태로 돌려준다.**
  //
  // 전엔 Slack 이 거절해도(웹훅 폐기·채널 삭제·rate limit) 무조건 200 에
  // {"ok":false} 만 담아 보냈다. 트리거(notify_support_ticket)는 응답 본문을 보지
  // 않으므로, 점주 화면엔 "보냈어요"가 뜨는데 문의는 아무도 못 보는 상태가 된다.
  // 상태 코드로 올려주면 적어도 net._http_response 에 실패가 남아 추적이 된다.
  //
  // fetch 자체가 터지는 경우(DNS·타임아웃)도 같이 잡는다 — 전엔 unhandled 였다.
  let slackOk = false
  let slackDetail = ''
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
    })
    slackOk = res.ok
    if (!res.ok) slackDetail = `${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`
  } catch (e) {
    slackDetail = `fetch 실패: ${(e as Error).message}`
  }

  if (!slackOk) {
    console.error('Slack 전송 실패', { ticket: t.id, detail: slackDetail })
    return new Response(
      JSON.stringify({ ok: false, ticket: t.id, slack: slackDetail }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(
    JSON.stringify({ ok: true, classified: verdict?.code ?? null }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
