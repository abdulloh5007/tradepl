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
    isExpanded?: boolean
    isFullscreen?: boolean
    safeAreaInset?: {
        top?: number
        bottom?: number
        left?: number
        right?: number
    }
    contentSafeAreaInset?: {
        top?: number
        bottom?: number
        left?: number
        right?: number
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
    expand?: () => void
    requestFullscreen?: () => void | Promise<void>
    disableVerticalSwipes?: () => void
    enableVerticalSwipes?: () => void
    requestWriteAccess?: (callback?: (allowed: boolean) => void) => void
    close?: () => void
    onEvent?: (event: string, callback: () => void) => void
    offEvent?: (event: string, callback: () => void) => void
    openTelegramLink?: (url: string) => void
}

interface Window {
    Telegram?: {
        WebApp?: TelegramWebApp
    }
}
