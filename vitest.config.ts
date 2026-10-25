import { defineConfig } from 'vitest/config'

// 단위 테스트 설정.
//
// 범위를 src/ 로 **좁혀 둔다.** supabase/functions 안의 테스트는 Deno 용이고
// (`jsr:@std/assert` 를 import 한다) vitest 로는 해석되지 않는다. 그건 `deno test` 로 돌린다:
//   deno test supabase/functions/calculate-delivery-fee/calc.test.ts
//
// jsdom 은 일부러 안 깐다. 여기서 테스트하는 건 순수 로직(금액·시간·문자열 파싱)뿐이고,
// CLAUDE.md 방침도 "UI는 직접 클릭"이다. DOM 이 필요한 테스트를 쓰고 싶어지면
// 그때 jsdom 을 추가하면 된다.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
})
