import { createContext, useContext } from 'react'

/** Things any screen can ask the app to open, like the settings panel. */
export interface UiValue {
  openSettings: (needNumber?: boolean) => void
  openData: () => void
}
export const UiContext = createContext<UiValue>({ openSettings: () => {}, openData: () => {} })
export const useUi = (): UiValue => useContext(UiContext)
