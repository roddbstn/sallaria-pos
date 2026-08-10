import { createContext, useContext, type ReactNode } from 'react'

interface HeaderSlotCtx {
  setHeaderRight: (node: ReactNode) => void
}

export const HeaderSlotContext = createContext<HeaderSlotCtx>({ setHeaderRight: () => {} })
export const useHeaderSlot = () => useContext(HeaderSlotContext)
