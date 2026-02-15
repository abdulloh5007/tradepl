import { useLayoutEffect, useState } from "react"

export function useAnimatedPresence(open: boolean, durationMs = 220) {
  const [shouldRender, setShouldRender] = useState(open)
  const [isVisible, setIsVisible] = useState(open)

  useLayoutEffect(() => {
    let closeTimer: number | undefined
    let enterTimer: number | undefined

    if (open) {
      // Ensure first paint happens in hidden state, then animate in.
      setIsVisible(false)
      setShouldRender(true)
      enterTimer = window.setTimeout(() => setIsVisible(true), 16)
    } else {
      setIsVisible(false)
      closeTimer = window.setTimeout(() => setShouldRender(false), durationMs)
    }

    return () => {
      if (closeTimer) window.clearTimeout(closeTimer)
      if (enterTimer) window.clearTimeout(enterTimer)
    }
  }, [open, durationMs])

  return { shouldRender, isVisible }
}
