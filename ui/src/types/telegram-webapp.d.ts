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
}

interface Window {
    Telegram?: {
        WebApp?: TelegramWebApp
    }
}
