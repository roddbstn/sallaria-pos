// Renderer에서 window.api 타입 안전하게 사용하는 헬퍼

type API = typeof import('../../../electron/preload').PosAPI extends infer T ? T : never

export const api: API = (window as unknown as { api: API }).api

export const won = (n: number) =>
  n.toLocaleString('ko-KR') + '원'

export const formatDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
