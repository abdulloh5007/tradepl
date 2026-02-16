import { useEffect, useRef } from "react"
import type { ReactNode } from "react"
import { triggerTelegramHaptic } from "../../utils/telegramHaptics"

interface TelegramBackButtonProps {
  onBack: () => void
  fallbackClassName?: string
  fallbackAriaLabel?: string
  fallbackChildren?: ReactNode
  showFallback?: boolean
}

export default function TelegramBackButton({
  onBack,
  fallbackClassName,
  fallbackAriaLabel,
  fallbackChildren,
  showFallback = true,
}: TelegramBackButtonProps) {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  const hasTelegramBackButton = typeof window !== "undefined" &&
    Boolean(window.Telegram?.WebApp?.BackButton?.show) &&
    Boolean(window.Telegram?.WebApp?.BackButton?.onClick)

  useEffect(() => {
    if (!hasTelegramBackButton) return
    const backButton = window.Telegram?.WebApp?.BackButton
    if (!backButton) return

    const handler = () => {
      triggerTelegramHaptic("nav")
      onBackRef.current()
    }

    backButton.show?.()
    backButton.onClick?.(handler)
    return () => {
      backButton.offClick?.(handler)
      backButton.hide?.()
    }
  }, [hasTelegramBackButton])

  if (!hasTelegramBackButton && showFallback) {
    return (
      <button
        type="button"
        className={fallbackClassName}
        aria-label={fallbackAriaLabel}
        onClick={() => {
          triggerTelegramHaptic("nav")
          onBack()
        }}
      >
        {fallbackChildren}
      </button>
    )
  }

  return null
}

