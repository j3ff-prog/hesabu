import { createContext, useContext } from 'react'

export interface ToastData {
  id: number
  text: string
  sub?: string
  undo?: () => void
}

export const ToastContext = createContext<{ show: (t: Omit<ToastData, 'id'>) => void }>({
  show: () => {}
})

export const useToast = () => useContext(ToastContext)
