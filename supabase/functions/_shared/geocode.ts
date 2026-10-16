// 네이버클라우드플랫폼 Maps - Geocoding 호출 + CORS 헤더.
// geocode-address, calculate-delivery-fee 양쪽 Edge Function이 이 모듈을 공유한다.
// (Supabase 컨벤션: '_'로 시작하는 폴더는 독립 함수로 배포되지 않고, 다른 함수가 상대경로로 import만 한다)

export const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NaverGeocodeAddress {
  x: string // 경도(lng)
  y: string // 위도(lat)
}

interface NaverGeocodeResponse {
  status: string
  addresses: NaverGeocodeAddress[]
}

export async function geocode(roadAddress: string): Promise<{ lat: number; lng: number } | null> {
  const keyId = Deno.env.get('NAVER_MAP_ACCESS_KEY_ID') ?? ''
  const key = Deno.env.get('NAVER_MAP_SECRET_KEY') ?? ''

  const url = `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(roadAddress)}`
  const res = await fetch(url, {
    headers: {
      'x-ncp-apigw-api-key-id': keyId,
      'x-ncp-apigw-api-key': key,
    },
  })

  if (!res.ok) {
    console.error('네이버 지오코딩 API 오류', res.status, await res.text())
    return null
  }

  const data: NaverGeocodeResponse = await res.json()
  const first = data.addresses?.[0]
  if (!first) return null

  return { lat: Number(first.y), lng: Number(first.x) }
}
