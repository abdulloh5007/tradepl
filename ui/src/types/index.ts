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
    ticket?: string
    ticket_no?: number
    user_id?: string
    trading_account_id?: string
    pair_id: string
    symbol?: string
    side: string
    type?: string
    price: string
    qty: string
    remaining_qty?: string
    quote_amount?: string
    remaining_quote?: string
    reserved_amount?: string
    spent_amount?: string
    unrealized_pnl?: string
    profit?: string /* Added profit */
    commission?: string /* Added commission */
    swap?: string /* Added swap */
    close_price?: string /* Added close_price */
    close_time?: string /* Added close_time */
    comment?: string /* Added comment */
    time_in_force?: string
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
    system_notice?: string
    system_notice_details?: SystemNoticeDetails
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

export interface AccountPlan {
    id: string
    name: string
    description: string
    spread_multiplier: number
    commission_rate: number
    commission_per_lot: number
    swap_long_per_lot: number
    swap_short_per_lot: number
    is_swap_free: boolean
    leverage: number
}

export interface TradingAccount {
    id: string
    user_id: string
    plan_id: string
    plan: AccountPlan
    leverage: number
    mode: "demo" | "real"
    name: string
    is_active: boolean
    balance: string
    created_at: string
    updated_at: string
}

export type Theme = "dark" | "light"
export type Lang = "en" | "uz" | "ru"
export type View = "chart" | "positions" | "history" | "accounts" | "notifications" | "profile" | "api" | "faucet" | "admin"

export interface SystemNoticeDetails {
    kind?: "margin_call" | "stop_out" | string
    reason?: string
    triggered_at?: string
    threshold_percent?: string
    balance_before?: string
    balance_after?: string
    equity_before?: string
    equity_after?: string
    margin_before?: string
    margin_after?: string
    margin_level_before?: string
    margin_level_after?: string
    closed_orders?: number
    total_loss?: string
    total_loss_estimated?: boolean
}

export interface AppNotification {
    id: string
    kind: "system" | "bonus" | "deposit" | "news"
    title: string
    message: string
    created_at: string
    read: boolean
    dedupe_key?: string
    account_id?: string
    details?: SystemNoticeDetails
}

export interface NotificationSettings {
    enabled: boolean
    kinds: {
        system: boolean
        bonus: boolean
        deposit: boolean
        news: boolean
    }
}

export interface MarketNewsEvent {
    id: number
    pair: string
    title: string
    impact: "low" | "medium" | "high" | string
    rule_key: string
    source: "manual" | "auto" | string
    forecast_value: number
    actual_value?: number | null
    actual_auto: boolean
    pre_seconds: number
    event_seconds: number
    post_seconds: number
    scheduled_at: string
    live_started_at?: string
    post_started_at?: string
    completed_at?: string
    status: "pending" | "pre" | "live" | "post" | "completed" | "cancelled" | string
    created_by: string
    created_at: string
    updated_at: string
}
