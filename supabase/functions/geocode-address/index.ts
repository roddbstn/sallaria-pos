// 도로명(또는 지번) 주소 → 위경도 변환.
// sallaria-pos(사장님 앱, 매장 위치 설정), salaria-prepaid/sunpos-kakao(고객 배달주소 거리계산)
// 양쪽에서 supabase.functions.invoke('geocode-address', { body: { road_address } }) 로 호출한다.
//
// 네이버 API 키는 여기(서버)에서만 사용 — 클라이언트에 절대 노출하지 않는다.
// 실제 지오코딩 로직은 ../_shared/geocode.ts 에 있다 (calculate-delivery-fee와 공유).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { geocode, corsHeaders } from "../_shared/geocode.ts"

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let payload: { road_address?: string }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const roadAddress = payload?.road_address?.trim()
  if (!roadAddress) {
    return new Response(JSON.stringify({ error: 'missing road_address' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const coords = await geocode(roadAddress)
  if (!coords) {
    return new Response(JSON.stringify({ error: '주소로 좌표를 찾지 못했습니다.' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify(coords), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
