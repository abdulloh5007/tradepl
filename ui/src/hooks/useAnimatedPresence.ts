import { useEffect, useState } from "react"

export function useAnimatedPresence(open: boolean, durationMs = 220) {
  const [shouldRender, setShouldRender] = useState(open)
  const [isVisible, setIsVisible] = useState(open)

  useEffect(() => {
    let timer: number | undefined
    let raf: number | undefined

    if (open) {
      setShouldRender(true)
      raf = window.requestAnimationFrame(() => setIsVisible(true))
    } else {
      setIsVisible(false)
      timer = window.setTimeout(() => setShouldRender(false), durationMs)
    }

    return () => {
      if (timer) window.clearTimeout(timer)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [open, durationMs])

  return { shouldRender, isVisible }
}

