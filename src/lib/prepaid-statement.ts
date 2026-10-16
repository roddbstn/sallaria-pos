// 선결제 이용내역서 CSV.
//
// 점주가 지금 손으로 만들어 거래처에 보내는 그 문서다(프로젝트 루트의
// `선결제이용내역서_*.xls/csv` 가 원본). 열 구성과 순서를 그 파일에 맞췄다 —
// 거래처 담당자가 이미 그 모양에 익숙하고, 바꾸면 "전에 받던 거랑 다르다"가 된다.
//
// 구조: 한 행은 충전이거나 주문이다. 충전은 왼쪽 3칸(일자·금액·기타),
// 주문은 오른쪽 5칸(일자·금액·내역·비고·서명)을 채우고, 맨 끝 열은 그 시점의 잔액이다.
//
// ⚠️ 이 파일은 세금계산서가 아니다. 선결제 받을 때 POS 에서 카드 결제가 일어나므로
//    카드 매출전표가 1차 증빙이고, 이건 거래처 내부 정산용 이용내역 확인서다.
//
// ⚠️ 이름을 마스킹하지 않는다. 거래처가 "우리 과 누가 썼나"를 확인하는 문서라서
//    가리면 쓸 수 없다. 화면의 보기/가리기 토글과는 목적이 다르다.

export interface StatementAccount {
  accountName:    string
  manager:        string | null
  phone:          string | null
  businessNumber: string | null
}

export interface StatementDeposit {
  createdAt:    string
  amount:       number
  note:         string | null
  balanceAfter: number | null
}

export interface StatementOrder {
  orderedAt:    string
  amount:       number
  menus:        string          // "에그인헬1, 샐러드2"
  method:       string
  orderer:      string
  balanceAfter: number | null
  cancelled:    boolean
}

/** 'YYYY-MM-DD HH:MM' (KST) */
function kstStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
       + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

function money(n: number | null): string {
  return n == null ? '' : `₩${n.toLocaleString('ko-KR')}`
}

/** 엑셀이 CSV 셀을 수식·숫자로 바꾸지 않게 감싼다 */
function cell(v: string | number): string {
  return `"${String(v).replace(/"/g, '""')}"`
}

export interface StatementInput {
  account:  StatementAccount
  deposits: StatementDeposit[]
  orders:   StatementOrder[]
  /** 'all' 이면 전체, 아니면 'YYYY-MM' */
  period:   string
}

/**
 * 이용내역서 CSV 문자열. BOM 은 호출부에서 Blob 에 붙인다.
 *
 * 취소 주문도 넣는다 — 빼면 거래처 쪽 합계와 맞지 않는 날이 온다. 대신 비고에 '취소'를
 * 적고 금액에 괄호를 씌워서, 합계에 들어가지 않는다는 걸 눈으로 알 수 있게 한다.
 */
export function buildStatementCsv({ account, deposits, orders, period }: StatementInput): string {
  const inPeriod = (iso: string) =>
    period === 'all' || kstStamp(iso).slice(0, 7) === period

  type Row = { at: string; cells: string[] }
  const rows: Row[] = []

  for (const d of deposits) {
    if (!inPeriod(d.createdAt)) continue
    rows.push({
      at: d.createdAt,
      cells: [
        kstStamp(d.createdAt), money(d.amount), d.note ?? '',
        '', '', '', '', '',
        money(d.balanceAfter),
      ],
    })
  }

  for (const o of orders) {
    if (!inPeriod(o.orderedAt)) continue
    rows.push({
      at: o.orderedAt,
      cells: [
        '', '', '',
        kstStamp(o.orderedAt),
        o.cancelled ? `(${money(o.amount)})` : money(o.amount),
        o.menus,
        o.cancelled ? `${o.method} / 취소` : o.method,
        o.orderer,
        money(o.balanceAfter),
      ],
    })
  }

  rows.sort((a, b) => a.at.localeCompare(b.at))

  const validOrders = orders.filter(o => inPeriod(o.orderedAt) && !o.cancelled)
  const periodDeposits = deposits.filter(d => inPeriod(d.createdAt))
  const depTotal = periodDeposits.reduce((s, d) => s + d.amount, 0)
  const ordTotal = validOrders.reduce((s, o) => s + o.amount, 0)

  const lines: string[][] = [
    ['선결제 이용내역서', '', '', '', '', '', '', '', ''],
    ['회사명', account.accountName, '', '담당자', account.manager ?? '', '', '', '', ''],
    ['사업자등록번호', account.businessNumber ?? '', '', '전화번호', account.phone ?? '', '', '', '', ''],
    ['기간', period === 'all' ? '전체' : period, '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['선결제내역', '', '', '사용내역', '', '', '', '', '잔액'],
    ['일자', '금액', '기타', '일자', '금액', '내역', '비고', '서명', '잔액'],
    ...rows.map(r => r.cells),
    ['', '', '', '', '', '', '', '', ''],
    ['합계', money(depTotal), `${periodDeposits.length}회 충전`,
     '', money(ordTotal), `${validOrders.length}건 주문 (취소 제외)`, '', '', ''],
  ]

  return lines.map(l => l.map(cell).join(',')).join('\r\n')
}

/** `선결제이용내역서_북구청 공원녹지과_2026-07.csv` */
export function statementFileName(accountName: string, period: string): string {
  return `선결제이용내역서_${accountName}_${period === 'all' ? '전체' : period}.csv`
}

export function downloadStatementCsv(input: StatementInput): void {
  const csv = buildStatementCsv(input)
  // BOM 이 없으면 엑셀이 한글을 깨뜨린다
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = statementFileName(input.account.accountName, input.period)
  a.click()
  URL.revokeObjectURL(url)
}
