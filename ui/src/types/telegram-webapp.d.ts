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
    ready?: () => void
    requestWriteAccess?: (callback?: (allowed: boolean) => void) => void
    openTelegramLink?: (url: string) => void
}

interface Window {
    Telegram?: {
        WebApp?: TelegramWebApp
    }
}
