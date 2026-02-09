export type SessionConfig = {
    id: string
    name: string
    update_rate_ms: number
    volatility: number
    trend_bias: string
    is_active: boolean
}

export type VolatilityConfig = {
    id: string
    name: string
    value: number
    schedule_start: string
    schedule_end: string
    is_active: boolean
}

export type PriceEvent = {
    id: number
    target_price: number
    direction: string
    duration_seconds: number
    scheduled_at: string
    status: string
    created_at: string
}

export type PanelAdmin = {
    id: number
    telegram_id: number
    name: string
    rights: string[]
    created_at: string
}

export type FilterType = "1d" | "3d" | "1w" | "1m" | "custom"
