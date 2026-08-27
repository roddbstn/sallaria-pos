// =============================================================================
// SunPOS 구독 플랜 정의 (salaria-prepaid/lib/plans.ts 와 동기화 유지)
// DB: clients.plan (plan_tier ENUM: free | basic | pro | max)
// =============================================================================

export type PlanTier = 'free' | 'basic' | 'pro' | 'max';

export interface PlanLimits {
  /** 등록 가능한 거래처(account) 수 */
  accounts: number;
  /** 운영 가능한 매장(store) 수 */
  stores: number;
  /** SMS 알림 기능 */
  sms: boolean;
  /** 매출 분석 / 리포트 */
  analytics: boolean;
  /** 메뉴 이미지 업로드 */
  menuImages: boolean;
  /** QR 주문 웹 */
  qrOrder: boolean;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    accounts:   1,
    stores:     1,
    sms:        false,
    analytics:  false,
    menuImages: true,
    qrOrder:    true,
  },
  basic: {
    accounts:   10,
    stores:     1,
    sms:        false,
    analytics:  true,
    menuImages: true,
    qrOrder:    true,
  },
  pro: {
    accounts:   20,
    stores:     1,
    sms:        true,
    analytics:  true,
    menuImages: true,
    qrOrder:    true,
  },
  max: {
    accounts:   Infinity,
    stores:     Infinity,
    sms:        true,
    analytics:  true,
    menuImages: true,
    qrOrder:    true,
  },
};

export const PLAN_NAMES: Record<PlanTier, string> = {
  free:  '무료',
  basic: '베이직',
  pro:   '프로',
  max:   '맥스',
};

/** 현재 플랜에서 특정 기능이 잠겨있는지 확인 */
export function isLocked(plan: PlanTier, feature: keyof PlanLimits): boolean {
  const limit = PLAN_LIMITS[plan][feature];
  return limit === false || limit === 0;
}

/** 거래처 추가 가능 여부 확인 */
export function canAddAccount(plan: PlanTier, currentCount: number): boolean {
  return currentCount < PLAN_LIMITS[plan].accounts;
}

/** 매장 추가 가능 여부 확인 */
export function canAddStore(plan: PlanTier, currentCount: number): boolean {
  return currentCount < PLAN_LIMITS[plan].stores;
}
