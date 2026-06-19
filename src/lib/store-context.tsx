import { createContext, useContext } from 'react'

export interface StoreSession {
  userId:    string
  clientId:  string
  storeId:   string
  storeName: string
}

export const StoreContext = createContext<StoreSession>({
  userId:    '',
  clientId:  '',
  storeId:   '',
  storeName: '',
})

export const useStore = () => useContext(StoreContext)
