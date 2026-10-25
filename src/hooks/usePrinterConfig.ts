import { useCallback, useEffect, useState } from 'react'
import type { PrinterConfig } from '../lib/printer-paper'

// 프린터 설정(포트·용지폭·연결 수단)을 읽고 쓰는 하나뿐인 창구.
//
// 왜 localStorage 가 아니라 IPC 인가: **인쇄는 메인 프로세스가 한다.** 용지폭이
// localStorage 에만 있으면 화면에서는 80mm 로 보이는데 실제 출력은 기본값으로
// 나가는, 전에 여러 번 겪은 '아무 일도 하지 않는 설정'이 또 생긴다.
// electron-store 가 원본이고 화면은 그걸 비춘다.
//
// 세 화면(프린터 연결 · 영수증·증빙 · QR출력 미리보기)이 같은 값을 보게 하려고
// 모듈 수준에 캐시를 두고 변경을 구독한다 — 탭을 옮길 때마다 IPC 왕복을 하면
// 설정 화면이 깜빡인다.

type Listener = (c: PrinterConfig) => void

let cache: PrinterConfig | null = null
let inflight: Promise<PrinterConfig> | null = null
const listeners = new Set<Listener>()

function bridge() {
  return (window as unknown as {
    api?: {
      getSettings?:    () => Promise<unknown>
      updateSettings?: (p: unknown) => Promise<unknown>
    }
  }).api
}

async function load(): Promise<PrinterConfig> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    const s = (await bridge()?.getSettings?.()) as { printer?: PrinterConfig } | undefined
    cache = s?.printer ?? {}
    inflight = null
    return cache
  })()
  return inflight
}

function emit(): void {
  if (!cache) return
  for (const fn of listeners) fn(cache)
}

/**
 * 프린터 설정을 읽고 일부만 바꾼다.
 *
 * patch 는 넘긴 키만 덮어쓴다 — 용지폭을 바꾸면서 포트 이름을 날리면
 * 프린터 연결이 조용히 풀린다.
 */
export function usePrinterConfig(): {
  cfg: PrinterConfig
  patch: (p: Partial<PrinterConfig>) => Promise<void>
  ready: boolean
} {
  const [cfg, setCfg] = useState<PrinterConfig>(cache ?? {})
  const [ready, setReady] = useState(!!cache)

  useEffect(() => {
    let alive = true
    listeners.add(setCfg)
    load().then(c => { if (alive) { setCfg(c); setReady(true) } })
    return () => { alive = false; listeners.delete(setCfg) }
  }, [])

  const patch = useCallback(async (p: Partial<PrinterConfig>) => {
    const next = { ...(cache ?? {}), ...p }
    cache = next
    emit()
    await bridge()?.updateSettings?.({ printer: next })
  }, [])

  return { cfg, patch, ready }
}

/** 화면 밖(인쇄 직전 등)에서 최신 설정이 필요할 때 */
export async function readPrinterConfig(): Promise<PrinterConfig> {
  return load()
}
