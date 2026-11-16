import type { MockariumApi } from './contracts'

declare global {
  interface Window {
    mockarium: MockariumApi
  }
}

export {}
