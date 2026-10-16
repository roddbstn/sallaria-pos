// 회원탈퇴 마지막 단계 — auth.users 행 삭제 전용.
//
// DELETE FROM auth.users를 RPC(SECURITY DEFINER)로 직접 실행하면 Supabase가
// 이 시스템 테이블을 보호하고 있어서 조용히 0건 삭제되고 넘어간다(에러도 없음).
// 공식적으로 지원되는 방법은 Admin API(auth.admin.deleteUser)뿐이고, 이건
// 서비스 롤 키가 필요해서 클라이언트에서 직접 호출하면 안 되고 여기서 처리한다.
//
// 호출자 본인 계정만 삭제 가능 — Authorization 헤더의 JWT로 본인 확인 후
// 그 user.id만 삭제한다(클라이언트가 다른 id를 넘겨도 무시).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization') ?? ''

  // 호출자 본인 확인용 — anon key + 호출자의 JWT로 getUser()
  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 실제 삭제는 서비스 롤로만 가능
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user.id)
  if (deleteErr) {
    console.error('auth.admin.deleteUser 실패', deleteErr)
    return new Response(JSON.stringify({ error: deleteErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
