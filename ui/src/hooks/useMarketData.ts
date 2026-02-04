import { useState, useCallback } from "react"
import type { Candle, RawCandle, MarketConfig } from "../types"
import type { createApiClient } from "../api"
import { toDisplayCandle } from "../utils/format"

type ApiClient = ReturnType<typeof createApiClient>

interface UseMarketDataOptions {
    api: ApiClient
    marketPair: string
    marketConfig: Record<string, MarketConfig>
}

export function useMarketData({ api, marketPair, marketConfig }: UseMarketDataOptions) {
    const [candles, setCandles] = useState<Candle[]>([])
    const [timeframe, setTimeframe] = useState("1m")
    const [loading, setLoading] = useState(false)

    const fetchCandles = useCallback(async (tf?: string, limit = 500, fresh = false) => {
        const tfToUse = tf || timeframe
        setLoading(true)
        try {
            const raw = await api.candles(marketPair, tfToUse, limit, fresh)
            const display = raw.map((c: RawCandle) => toDisplayCandle(marketPair, c, marketConfig))
            setCandles(display)
            return display
        } catch {
            setCandles([])
            return []
        } finally {
            setLoading(false)
        }
    }, [api, marketPair, timeframe, marketConfig])

    const updateLastCandle = useCallback((rawCandle: RawCandle) => {
        const displayCandle = toDisplayCandle(marketPair, rawCandle, marketConfig)
        setCandles(prev => {
            if (prev.length === 0) return [displayCandle]
            const last = prev[prev.length - 1]
            if (last.time === displayCandle.time) {
                // Update existing
                return [...prev.slice(0, -1), displayCandle]
            } else if (displayCandle.time > last.time) {
                // New candle
                return [...prev, displayCandle]
            }
            return prev
        })
    }, [marketPair, marketConfig])

    return {
        candles,
        timeframe,
        loading,
        setTimeframe,
        fetchCandles,
        updateLastCandle
    }
}
