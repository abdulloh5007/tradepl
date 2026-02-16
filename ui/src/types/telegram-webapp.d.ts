interface TelegramWebAppInitDataUser {
    id: number
    first_name?: string
    last_name?: string
    username?: string
    photo_url?: string
}

interface TelegramWebApp {
    initData?: string
    initDataUnsafe?: {
        user?: TelegramWebAppInitDataUser
    }
    HapticFeedback?: {
        impactOccurred?: (style?: "light" | "medium" | "heavy" | "rigid" | "soft") => void
        notificationOccurred?: (type?: "error" | "success" | "warning") => void
        selectionChanged?: () => void
    }
    BackButton?: {
        isVisible?: boolean
        show?: () => void
        hide?: () => void
        onClick?: (callback: () => void) => void
        offClick?: (callback: () => void) => void
    }
    ready?: () => void
    requestWriteAccess?: (callback?: (allowed: boolean) => void) => void
    close?: () => void
    openTelegramLink?: (url: string) => void
}

interface Window {
    Telegram?: {
        WebApp?: TelegramWebApp
    }
}
