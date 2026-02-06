import type { UTCTimestamp } from "lightweight-charts"

export interface Quote {
    bid: string
    ask: string
    last: string
    spread: string
    ts: number
}

export interface Candle {
    time: UTCTimestamp
    open: number
    high: number
    low: number
    close: number
}

export interface RawCandle {
    time: number
    open: string
    high: string
    low: string
    close: string
}

export interface Order {
    id: string
    pair_id: string
    side: string
    type?: string
    price: string
    qty: string
    status: string
    created_at: string
}

export interface Metrics {
    balance: string
    equity: string
    margin: string
    free_margin: string
    margin_level: string
    pl: string
}

export interface MarketConfig {
    displayBase: number
    displayDecimals: number
    apiDecimals: number
    invertForApi: boolean
    spread: number
}

export interface Balance {
    asset_id: string
    symbol: string
    kind: string
    amount: string
}

export type Theme = "dark" | "light"
export type Lang = "en" | "uz" | "ru"
export type View = "chart" | "positions" | "balance" | "api" | "faucet" | "admin"
