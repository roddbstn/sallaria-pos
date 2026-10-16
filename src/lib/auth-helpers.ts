import { supabase } from './supabase'

/** 전 화면 공통 — 회원가입/로그인 비밀번호 최소 길이 */
export const PASSWORD_MIN_LEN = 6

export type PhoneLoginState = 'no_account' | 'no_password' | 'has_password'

/**
 * 전화번호로 계정 존재 여부 + 비밀번호 설정 여부를 확인.
 * LoginScreen(로그인 시도)과 SignupFlow(온보딩 재진입 시 password 스텝 스킵 판단)가 공유.
 * 실패 시 null — 호출부에서 각자 맥락에 맞는 에러 메시지를 보여준다.
 */
export async function checkPhoneLoginState(phone: string): Promise<PhoneLoginState | null> {
  const { data, error } = await supabase.rpc('check_phone_login_state', { p_phone: phone })
  if (error) return null
  return data as PhoneLoginState
}
