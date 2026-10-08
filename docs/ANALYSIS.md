# SunPOS(선포스) 데스크톱 앱 — 현황 분석

> 기준 커밋: `b375e06` (2026-09-17) · 분석일: 2026-10-08

## 1. 개요

선결제(거래처 잔액 차감) 방식 매장용 POS 데스크톱 앱. QR 주문 웹(`salaria-prepaid`)에서 들어온 주문을 실시간으로 받아 접수/거부/완료 처리하고, 58mm 열전사 프린터로 영수증을 출력한다.

| 항목 | 내용 |
|---|---|
| 런타임 | Electron 36 + electron-vite 2 |
| UI | React 18 + Tailwind 3 (라우터 없음, `App.tsx`의 `phase`/`tab` 상태로 화면 전환) |
| 백엔드 | Supabase (Auth, Postgres + RPC, Realtime, Storage) |
| 프린터 | `serialport` + 직접 생성한 ESC/POS 바이트(CP949, `iconv-lite`) |
| 분석 | Firebase Analytics (`track()`) |
| 배포 | electron-builder → GitHub Releases, `electron-updater` 자동 업데이트 |
| 대상 OS | Windows(NSIS, x64), macOS(DMG, 서명 + 공증) |
| 규모 | 약 1.6만 줄, 커밋 50개 (2026-07-03 ~ 2026-09-17) |

## 2. 구조

```
electron/
  index.ts     메인 프로세스: 창 생성, Realtime 구독(anon), IPC 핸들러, 시리얼 출력, 업데이터, sunpos:// 딥링크
  preload.ts   contextBridge → window.api
  escpos.ts    ESC/POS 영수증 빌더 (주방용/고객용/테스트/거래처 QR) ← 실제 사용 중
  printer.ts   타입 정의 + HTML 영수증 빌더 (HTML 빌더는 사용하지 않음)
src/
  App.tsx      인증/온보딩/메인 단계 전환, 사이드바, 주문 큐, 영업시간 모달, Realtime 구독
  pages/       Auth, Onboarding, Dashboard, Orders, Customers(거래처·입금), Menus, Sales, Settings
  components/  OrderPopup(신규 주문 접수/거부), SegmentedControl
  lib/         supabase 클라이언트 + DB 타입, mappers, ipc(orderToPayload), plans, firebase, mock-data(타입만 사용)
  hooks/       useOperatingHours
supabase/migrations/0042_plan_limits.sql   (마이그레이션은 이것 하나만 이 저장소에 있음)
```

### 주문 처리 흐름

1. QR 웹에서 `orders` INSERT
2. 신규 주문 감지 경로가 **두 개** 있음
   - 메인 프로세스: anon 클라이언트로 `orders` INSERT를 구독 → `accounts.store_id`로 매장 필터링 → IPC `order:new`
   - 렌더러: 로그인된 클라이언트로 `orders` INSERT를 구독(필터 없음, RLS에 의존)
   - 두 경로 모두 `ORDER_SELECT`로 다시 조회하고 큐에서 중복을 제거한다.
3. `OrderPopup` 접수 → `approve_order` RPC → `ORDER_ACCEPTED` 브로드캐스트 → IPC `order:approve`(영수증 출력)
4. 거부 → `cancel_order` RPC → `ORDER_REJECTED` 브로드캐스트 → IPC `order:reject`
5. 완료(Dashboard) → `orders.status='완료'` 업데이트 + `ORDER_COMPLETED`/`DELIVERY_DEPARTED` 브로드캐스트

## 3. 빌드 상태 — 🔴 HEAD가 빌드되지 않음

`pnpm build` 결과:

```
Could not resolve "./components/ProfileModal" from "src/App.tsx"
```

`src/components/ProfileModal.tsx`가 커밋된 적이 없다. 최신 커밋 `b375e06`에서 import가 추가됐지만 파일은 빠졌다. 그래서 `main` push 시 실행되는 Windows 빌드와 태그 릴리스가 모두 실패한다. **작성자 로컬에 있는 파일을 커밋하는 것이 최우선이다.**

`tsc --noEmit -p tsconfig.web.json`은 오류 51개를 낸다. 대부분 미사용 변수와 타입 불일치(특히 `Menus.tsx`)이고, 아래 항목은 실제 런타임 버그다.

## 4. 버그 (우선순위순)

| # | 위치 | 문제 | 영향 |
|---|---|---|---|
| 1 | `src/App.tsx:21` | `ProfileModal` 파일 누락 | 빌드 실패, 배포 불가 |
| 2 | `src/components/OrderPopup.tsx:121` + `electron/index.ts` `order:reject` | 거부할 때 렌더러가 `cancel_order`를 호출하고, 메인 프로세스가 **다시** `cancel_order`를 호출한다. 메인 쪽은 anon 클라이언트라 RLS로 실패하거나, 성공하면 **잔액이 두 번 환원**될 수 있다. `ORDER_REJECTED` 브로드캐스트도 두 번 나간다. | 잔액 정합성. `cancel_order`가 멱등인지 확인 필요 |
| 3 | `OrderPopup.tsx:84` | `approve_order` RPC의 error를 확인하지 않는다. 실패해도 영수증을 출력하고 "접수됨"을 브로드캐스트한다. 메인 `order:approve`도 `ORDER_ACCEPTED`를 한 번 더 보낸다. | 접수 실패 주문이 주방에 출력됨 |
| 4 | `src/pages/Onboarding.tsx:408` | `updateSettings({ printer: { path, baudRate, cutMode } })`로 저장하지만 메인은 `portName`만 읽는다. 온보딩에서 "연결"을 누르면 항상 "COM 포트를 먼저 선택해 주세요"가 뜬다. | 온보딩 프린터 연결 불가 |
| 5 | `src/App.tsx:540` | 정의되지 않은 `manualOverrideRef`를 참조한다. `stores` UPDATE를 받을 때마다 ReferenceError가 난다(`setIsOpen`은 그 전에 실행됨). | 콘솔 에러, 이후 로직 중단 |
| 6 | `src/pages/Sales.tsx:486` | `UpgradeModal`의 닫기(✕) 버튼이 정의되지 않은 `setOpen`을 호출한다. `onClose`여야 한다. | 닫기 버튼 클릭 시 ReferenceError |
| 7 | `App.tsx` ↔ `electron/index.ts` | 메인은 `type: 'downloaded'`를 보내는데 렌더러는 `'ready'`를 검사한다. 업데이트 완료 배너가 표시되지 않는다(종료 시 자동 설치는 동작). | 업데이트 안내 누락 |
| 8 | `electron/index.ts` `order:complete`/`order:cancel` | anon 클라이언트로 쓰기를 하고 결과를 확인하지 않은 채 `{ok:true}`를 반환한다. 현재 렌더러는 호출하지 않는 죽은 코드다. | 정리 대상 |
| 9 | `src/lib/plans.ts` ↔ `0042_plan_limits.sql` | basic 거래처 수가 앱 5, DB 10이다. free 메뉴 이미지가 앱 true, DB false다. | 요금제 제한 불일치 |
| 10 | `src/lib/ipc.ts:51` | 배달비가 3500원으로 하드코딩돼 있고 `menu_subtotal = total - 3500`으로 역산한다. 실제 `orders.delivery_fee`와 다르면 영수증 금액이 틀린다. | 영수증 금액 오류 가능 |
| 11 | `electron/printer.ts`, `escpos.ts` | 매장명이 없으면 기본값 `'샐러리아 침산점'`을 쓴다. 멀티 테넌트 SaaS에서 다른 매장 영수증에 이 이름이 찍힐 수 있다. | 브랜딩 오류 |
| 12 | `electron/index.ts` | `setAppUserModelId('kr.sallaria.pos')`가 `appId: kr.sunpos.app`과 다르다. | Windows 알림·작업표시줄 그룹핑 이상 |
| 13 | `electron/index.ts` 딥링크 | Windows `argv`만 처리하고 macOS `open-url` 이벤트 핸들러가 없다. | macOS에서 비밀번호 재설정 링크가 동작하지 않음 |
| 14 | `App.tsx:339` | `'TOKEN_REFRESH_FAILED'`는 supabase-js의 auth 이벤트가 아니라 이 분기가 실행되지 않는다. | 토큰 만료 처리 누락 |

## 5. 보안·운영 관점

- **메인 프로세스 Realtime이 anon으로 전 매장 `orders` INSERT를 구독한다.** `currentStoreId`가 설정되기 전(로그인 전)에는 필터 없이 렌더러로 전달한다. anon에게 `orders` SELECT/Realtime이 열려 있으면 다른 매장의 주문자 이름과 전화번호가 노출된다. Supabase RLS와 Realtime publication 설정을 확인해야 한다. 렌더러가 이미 로그인된 상태로 구독하고 있으므로 메인 쪽 구독을 제거하는 방향을 권장한다.
- 프린터 "연결됨" 상태는 실제 연결이 아니라 포트 이름이 저장돼 있는지만 본다(`connected: !!getPortName()`).
- 시리얼 baud rate가 9600으로 고정이다. 온보딩에서 고른 baudRate는 무시된다.
- `sandbox: false`. `contextIsolation`은 켜져 있다.
- Supabase anon key와 Firebase config가 워크플로와 소스에 하드코딩돼 있다. 둘 다 공개 전제의 키라 치명적이지는 않지만, Secrets로 옮기면 관리가 쉬워진다.
- 출력 실패는 메인에서 로그만 남기고 사용자에게 알리지 않는다(`order:approve`). 주방 영수증이 누락돼도 매장이 알 수 없다.

## 6. 코드 품질

- 테스트, 린트, 타입체크가 CI에 없다. `tsc`를 CI에 넣었으면 1, 5, 6번은 사전에 잡혔다.
- 페이지 파일이 거대하다: Menus 3,218줄, Customers 2,441줄, Sales 1,544줄, App 1,310줄.
- `window.api` 타입이 깨져 있다. `src/lib/ipc.ts`의 `import('../../../electron/preload')` 경로가 틀렸다. 그래서 각 파일이 `window as unknown as {...}`로 타입을 따로 선언하고, 결과적으로 4번 같은 필드명 불일치가 생겼다.
- `parseNote`가 `ipc.ts`와 `mappers.ts`에 중복돼 있다. `printer.ts`의 HTML 빌더와 `autoPrintOrder`는 사용하지 않는 코드다.
- `package.json` version이 `1.0.0`이다(커밋 `1043f0f`에서 0.1.5 → 1.0.0). 의도한 값인지 확인이 필요하다. 이미 1.0.0 태그로 배포됐다면 이후 릴리스는 이 값보다 커야 자동 업데이트가 동작한다.
- DB 마이그레이션은 이 저장소에 `0042`만 있다. 스키마의 기준 저장소가 어디인지 문서화가 필요하다.

## 7. 권장 작업 순서

1. `ProfileModal.tsx` 커밋 → 빌드 복구 (+ CI에 `tsc --noEmit` 추가)
2. 거부/접수 중복 호출 제거(#2, #3). 메인 프로세스의 Supabase 쓰기와 Realtime 구독 정리
3. 즉시 수정할 수 있는 런타임 버그: #4, #5, #6, #7, #13
4. `window.api` 타입을 preload에서 단일 선언(`declare global`)
5. 요금제 상수를 DB `plan_limits` 기준으로 통일하거나 앱에서 조회
6. 영수증 금액을 실제 `delivery_fee`/`menu_subtotal`로 출력, 매장명 기본값 제거
