import { createContext, useContext } from 'react'
import type { PlanTier } from './plans'

export interface StoreSession {
  userId:    string
  clientId:  string
  storeId:   string
  storeName: string
  plan:      PlanTier
}

export const StoreContext = createContext<StoreSession>({
  userId:    '',
  clientId:  '',
  storeId:   '',
  storeName: '',
  plan:      'free',
})

export const useStore = () => useContext(StoreContext)
