import type { MarketConfig, RawCandle, Candle } from "../types"

export function formatAmount(value: number): string {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPrice(pair: string, value: number, config: Record<string, MarketConfig>): string {
    const cfg = config[pair]
    if (!cfg) return value.toFixed(2)
    return value.toFixed(cfg.displayDecimals)
}

export function apiPriceFromDisplay(pair: string, value: number, config: Record<string, MarketConfig>): string {
    const cfg = config[pair]
    if (!cfg) return value.toFixed(8)
    if (cfg.invertForApi) {
        return (1 / value).toFixed(cfg.apiDecimals)
    }
    return value.toFixed(cfg.apiDecimals)
}

export function toDisplayCandle(pair: string, c: RawCandle, config: Record<string, MarketConfig>): Candle {
    const cfg = config[pair]
    const inv = cfg?.invertForApi ?? false
    const decimals = cfg?.displayDecimals ?? 2

    const round = (v: number) => Number(v.toFixed(decimals))

    if (inv) {
        return {
            time: c.time as Candle["time"],
            open: round(1 / parseFloat(c.open)),
            high: round(1 / parseFloat(c.low)),
            low: round(1 / parseFloat(c.high)),
            close: round(1 / parseFloat(c.close))
        }
    }
    return {
        time: c.time as Candle["time"],
        open: round(parseFloat(c.open)),
        high: round(parseFloat(c.high)),
        low: round(parseFloat(c.low)),
        close: round(parseFloat(c.close))
    }
}

export function sanitizeBaseUrl(v: string): string {
    return v.replace(/[^a-zA-Z0-9.:/-]/g, "").replace(/\/+$/, "")
}

export function normalizeBaseUrl(v: string): string {
    let url = sanitizeBaseUrl(v)
    if (!url) {
        if (typeof window !== "undefined") {
            url = window.location.origin
        }
    }
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
        url = "http://" + url
    }
    return url.replace(/\/+$/, "")
}
