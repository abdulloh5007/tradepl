export type HapticMode = "frequent" | "normal" | "off"
export type HapticIntent = "nav" | "toggle" | "tap" | "success" | "error"

const notificationSettingsStorageKey = "lv_notification_settings_v1"
const defaultHapticMode: HapticMode = "normal"

function storedMode(): HapticMode {
  if (typeof window === "undefined") return defaultHapticMode
  try {
    const raw = window.localStorage.getItem(notificationSettingsStorageKey)
    if (!raw) return defaultHapticMode
    const parsed = JSON.parse(raw)
    const mode = String(parsed?.haptics || "").trim().toLowerCase()
    if (mode === "frequent" || mode === "normal" || mode === "off") return mode
    return defaultHapticMode
  } catch {
    return defaultHapticMode
  }
}

export function getTelegramHapticMode(): HapticMode {
  return storedMode()
}

export function triggerTelegramHaptic(intent: HapticIntent, explicitMode?: HapticMode) {
  if (typeof window === "undefined") return
  const mode = explicitMode || storedMode()
  if (mode === "off") return
  const haptic = window.Telegram?.WebApp?.HapticFeedback
  if (!haptic) return

  if (intent === "success") {
    haptic.notificationOccurred?.("success")
    return
  }
  if (intent === "error") {
    haptic.notificationOccurred?.("error")
    return
  }

  if (mode === "frequent") {
    if (intent === "toggle") {
      haptic.selectionChanged?.()
      return
    }
    haptic.impactOccurred?.("light")
    return
  }

  // normal mode: only key interactions
  if (intent === "nav" || intent === "toggle") {
    haptic.selectionChanged?.()
  }
}

