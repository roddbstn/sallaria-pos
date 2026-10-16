import { useEffect, useState } from 'react'
import PrimaryButton from '../../../../components/auth/PrimaryButton'
import FakeOrderPopup from '../../../../components/auth/FakeOrderPopup'
import { api } from '../../../../lib/ipc'
import { getSavedVolume, saveVolume, playOrderSound } from '../../../../lib/sound'
import type { Order } from '../../../../lib/mock-data'
import type { StepProps } from '../types'

interface ComPort { path: string; manufacturer: string; friendlyName: string }

// 업종유형 선택값 기준 체험 주문 메뉴 — 실제 메뉴는 아직 등록 전(온보딩 중)이라 업종에 맞는 예시로 대체
const DEMO_ITEM_BY_BUSINESS_TYPE: Record<string, { name: string; price: number }> = {
  '한식·분식':        { name: '순두부찌개', price: 9000 },
  '샐러드·포케':       { name: '닭가슴살 포케', price: 10900 },
  '샌드위치·베이커리': { name: '치킨텐더 샌드위치', price: 8900 },
  '카페·디저트':       { name: '아메리카노', price: 4500 },
  '치킨·버거':         { name: '치즈버거 세트', price: 9500 },
}
const DEFAULT_DEMO_ITEM = { name: '대표 메뉴', price: 9000 }

function buildDemoOrder(businessType: string): Order {
  const item = DEMO_ITEM_BY_BUSINESS_TYPE[businessType] ?? DEFAULT_DEMO_ITEM
  return {
    code:        `DEMO-${Date.now()}`,
    orderNumber: '1',
    accountName: '체험 주문',
    accountType: '개인',
    orderer:     '테스트 고객',
    method:      '포장',
    status:      '주문완료',
    items:       [{ name: item.name, qty: 1, price: item.price, options: [] }],
    total:       item.price,
    prepMins:    15,
    createdAt:   new Date().toISOString(),
    remarks:     '',
  }
}

type Stage = 'connect' | 'ready'

/**
 * 고객유형 다음 스텝 — 프린터 연결 + 알림음 확인 + 가상 주문 체험.
 * 온보딩 중 핵심 가치(주문 알림 → 접수 → 영수증 출력)를 실제로 겪게 하는 "아하 모먼트" 화면.
 */
export default function PrinterSetupStep({ data, onNext }: StepProps) {
  const [stage,      setStage]      = useState<Stage>('connect')
  const [comPorts,   setComPorts]   = useState<ComPort[]>([])
  const [portName,   setPortName]   = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectErr, setConnectErr] = useState('')
  const [scanning,   setScanning]   = useState(false)
  const [volume,     setVolume]     = useState(getSavedVolume)
  const [showDemoOrder, setShowDemoOrder] = useState(false)

  useEffect(() => {
    api.onPrinterStatus?.(s => { if (s.connected) setStage('ready') })
    return () => { api.offPrinterStatus?.() }
  }, [])

  async function handleScan() {
    setScanning(true)
    setConnectErr('')
    const list = await api.listPorts()
    setComPorts(list)
    if (!portName && list.length === 1) setPortName(list[0].path)
    setScanning(false)
  }

  async function handleConnect() {
    if (!portName) { setConnectErr('포트를 먼저 선택해 주세요.'); return }
    setConnecting(true)
    setConnectErr('')
    await api.updateSettings({ printer: { portName } })
    const res = await api.connectPrinter()
    if (res && !res.ok) {
      setConnectErr(res.error ?? '포트를 열 수 없습니다.')
    } else {
      setStage('ready')
    }
    setConnecting(false)
  }

  function handleVolumeChange(v: number) {
    setVolume(v)
    saveVolume(v)
  }

  function handleStartDemo() {
    playOrderSound(volume)
    setShowDemoOrder(true)
  }

  return (
    <div className="step-in flex flex-col" style={{ height: 396 }}>
      {stage === 'connect' && (
        <div className="flex-1 flex flex-col">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="w-full border border-dashed rounded-xl px-4 py-3.5 text-[14px] text-left mb-3 transition-colors disabled:opacity-60"
            style={{ borderColor: 'var(--gray-border)', color: 'var(--gray-text)' }}
          >
            {scanning ? '포트 찾는 중...' : '프린터 연결하기'}
          </button>

          {comPorts.length > 0 && (
            <div className="flex flex-col gap-2 mb-4 max-h-[140px] overflow-y-auto">
              {comPorts.map(p => (
                <button
                  key={p.path}
                  onClick={() => { setPortName(p.path); setConnectErr('') }}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] transition-colors"
                  style={{
                    background: portName === p.path ? '#6A635E' : '#F2F2F2',
                    color:      portName === p.path ? '#FCFCFC' : '#787878',
                  }}
                >
                  {p.friendlyName || p.path}
                </button>
              ))}
            </div>
          )}

          {connectErr && (
            <p className="text-[12px] mb-3" style={{ color: 'var(--danger)' }}>{connectErr}</p>
          )}

          <PrimaryButton onClick={handleConnect} disabled={connecting} hidden={!portName} className="w-full">
            {connecting ? '연결 중...' : '연결하기'}
          </PrimaryButton>

          <button
            onClick={onNext}
            className="w-full text-center text-[12px] mt-4"
            style={{ color: 'var(--gray-text)' }}
          >
            나중에 설정할게요
          </button>
        </div>
      )}

      {stage === 'ready' && (
        <div className="flex-1 flex flex-col">
          <div className="flex items-center gap-2 mb-5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#2C261F' }} />
            <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>프린터 연결됨</span>
          </div>

          <p className="text-[13px] mb-3" style={{ color: 'var(--gray-text)' }}>
            주문이 오면 소리로 알려드려요. 알림음 크기를 확인해주세요.
          </p>
          <div className="flex items-center gap-3 mb-8">
            <input
              type="range" min={0} max={100} value={volume}
              onChange={e => handleVolumeChange(Number(e.target.value))}
              className="flex-1 h-2 cursor-pointer volume-slider"
              style={{ background: `linear-gradient(to right, #6A635E 0%, #6A635E ${volume}%, #E5E7EB ${volume}%, #E5E7EB 100%)` }}
            />
            <span className="text-[13px] font-bold w-8 text-right" style={{ color: 'var(--ink)' }}>{volume}</span>
            <button
              onClick={() => playOrderSound(volume)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold flex-shrink-0"
              style={{ background: '#F2F2F2', color: '#787878' }}
            >
              소리 확인
            </button>
          </div>

          <PrimaryButton onClick={handleStartDemo} className="w-full mt-auto">
            주문 받아보기
          </PrimaryButton>
        </div>
      )}

      {showDemoOrder && (
        <FakeOrderPopup
          order={buildDemoOrder(data.businessType)}
          storeName={data.storeName}
          onDone={() => { setShowDemoOrder(false); onNext() }}
        />
      )}
    </div>
  )
}
