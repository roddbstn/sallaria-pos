import { describe, it, expect } from 'vitest'
import {
  decideOnLostSession, nextRetryDelay,
  AUTH_RETRY_START_MS, AUTH_RETRY_MAX_MS,
} from './auth-retry'

describe('decideOnLostSession — 끊을지 버틸지', () => {
  it('사장님이 직접 로그아웃하면 끊는다', () => {
    expect(decideOnLostSession({ intentional: true, atAuthScreen: false })).toBe('sign-out')
    // 네트워크가 죽어 있어도 본인이 눌렀으면 끊는다
    expect(decideOnLostSession({ intentional: true, atAuthScreen: false, status: undefined })).toBe('sign-out')
  })

  it('서버가 리프레시 토큰을 거절하면 끊는다', () => {
    for (const status of [400, 401, 403]) {
      expect(decideOnLostSession({ intentional: false, atAuthScreen: false, status })).toBe('sign-out')
    }
  })

  it('**서버에 못 닿았으면 버틴다** — 침산점 장애의 그 경우', () => {
    expect(decideOnLostSession({ intentional: false, atAuthScreen: false })).toBe('retry')
    expect(decideOnLostSession({ intentional: false, atAuthScreen: false, status: undefined })).toBe('retry')
    expect(decideOnLostSession({ intentional: false, atAuthScreen: false, status: 0 })).toBe('retry')
  })

  it('서버 장애(5xx)도 버틴다 — 세션이 죽었다는 뜻이 아니다', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(decideOnLostSession({ intentional: false, atAuthScreen: false, status })).toBe('retry')
    }
  })

  it('429(과요청)도 버틴다 — 잠시 뒤 다시 하면 된다', () => {
    expect(decideOnLostSession({ intentional: false, atAuthScreen: false, status: 429 })).toBe('retry')
  })

  it('이미 로그인 화면이면 버틸 화면이 없으니 그대로 끊는다', () => {
    expect(decideOnLostSession({ intentional: false, atAuthScreen: true })).toBe('sign-out')
  })
})

describe('nextRetryDelay', () => {
  it('5초에서 2배씩 늘고 1분에서 멈춘다', () => {
    let d = AUTH_RETRY_START_MS
    const seen = [d]
    for (let i = 0; i < 6; i++) { d = nextRetryDelay(d); seen.push(d) }
    expect(seen).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000])
  })

  it('최대값을 절대 넘지 않는다 — 한 시간 뒤에도 1분마다 다시 본다', () => {
    let d = AUTH_RETRY_START_MS
    for (let i = 0; i < 100; i++) d = nextRetryDelay(d)
    expect(d).toBe(AUTH_RETRY_MAX_MS)
  })
})
