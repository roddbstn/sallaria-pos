export interface SignupData {
  phone:          string
  otp:            string
  storeName:      string
  sources:        string[]   // 유입경로 중복선택
  sourceOther:    string
  ownerName:      string
  address:        string          // 도로명 주소 (다음 우편번호 검색 결과)
  addressDetail:  string          // 상세주소 (선택)
  lat:            number | null   // geocode-address로 변환된 위도
  lng:            number | null   // geocode-address로 변환된 경도
  businessType:   string
  customerTypes:  string[]   // 관공서/기업/개인 중복선택
  plan:           'free' | 'basic' | 'pro' | 'max'
}

export const INITIAL_SIGNUP_DATA: SignupData = {
  phone:         '',
  otp:           '',
  storeName:     '',
  sources:       [],
  sourceOther:   '',
  ownerName:     '',
  address:       '',
  addressDetail: '',
  lat:           null,
  lng:           null,
  businessType:  '',
  customerTypes: [],
  plan:          'free',
}

export interface StepProps {
  data:     SignupData
  onChange: (patch: Partial<SignupData>) => void
  onNext:   () => void
  onBack:   () => void
}
