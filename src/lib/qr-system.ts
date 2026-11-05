// 새 거래처가 어느 QR 웹을 쓸지 정한다.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────
// accounts.qr_system 의 DB 기본값은 'kakao' 다. 그래서 침산점에 거래처를 새로
// 추가하면 QR 주소가 sunpos-kakao 로 나왔다. 침산점은 거래처 24곳이 전부
// PIN 방식(sallaria.web.app)이고 사무실에 붙은 QR 종이도 그쪽이라,
// **새로 넣은 거래처만 다른 웹으로** 가면 점주가 두 흐름을 같이 떠안는다.
//
// ── 규칙 ───────────────────────────────────────────────────────────────────
// "이 매장이 지금 쓰고 있는 방식을 따른다." 매장마다 답이 다르고
// (침산점=legacy · 행포케=kakao), 매장에 설정을 따로 두지 않아도 답이 이미
// 거래처들 안에 있다. 나중에 침산점이 전부 카카오로 옮겨 가면 그 시점부터
// 새 거래처도 저절로 카카오가 된다 — 설정을 고치러 갈 일이 없다.
//
// 거래처가 하나도 없는 새 매장은 'kakao'. 앞으로 만드는 매장은 카카오가 기준이고
// 'legacy' 는 이미 PIN 으로 돌고 있는 매장만 쓰는 값이다.

export type QrSystem = 'legacy' | 'kakao'

/**
 * @param accounts 그 매장의 **활성** 거래처들. 비활성까지 넣으면 예전에 쓰다 끈
 *                 방식이 현재 방식을 이긴다.
 */
export function defaultQrSystemFor(accounts: { qr_system: QrSystem }[]): QrSystem {
  if (accounts.length === 0) return 'kakao'
  const legacy = accounts.filter(a => a.qr_system === 'legacy').length
  // 과반일 때만 legacy. 반반이면 새 쪽(kakao)으로 간다 —
  // 옮겨 가는 중인 매장이라면 가는 방향에 붙이는 게 맞다.
  return legacy * 2 > accounts.length ? 'legacy' : 'kakao'
}
