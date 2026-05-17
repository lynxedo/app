'use client'

import { createContext, useContext } from 'react'

export const HubTextSizeContext = createContext<string>('default')

export function useHubTextSize() {
  return useContext(HubTextSizeContext)
}
