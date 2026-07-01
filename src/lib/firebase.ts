import { initializeApp, getApps } from 'firebase/app'
import { getAnalytics, logEvent, type Analytics } from 'firebase/analytics'

const firebaseConfig = {
  apiKey:            'AIzaSyClvk8-NJRk3-AJE2Ns_69vPic-bHMu0rI',
  authDomain:        'sallaria.firebaseapp.com',
  projectId:         'sallaria',
  storageBucket:     'sallaria.firebasestorage.app',
  messagingSenderId: '486697301968',
  appId:             '1:486697301968:web:110d6d7d1fb4f75ae1abd5',
  measurementId:     'G-YD3Q9P3DEX',
}

let analytics: Analytics | null = null

function getFirebaseAnalytics(): Analytics | null {
  if (typeof window === 'undefined') return null
  try {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
    if (!analytics) analytics = getAnalytics(app)
    return analytics
  } catch {
    return null
  }
}

export function track(eventName: string, params?: Record<string, unknown>) {
  const a = getFirebaseAnalytics()
  if (!a) return
  logEvent(a, eventName, params)
}
