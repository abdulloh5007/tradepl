import { useEffect, useRef, useState, useCallback } from "react"
import type { Quote, MarketConfig } from "../types"

interface UseWebSocketOptions {
    baseUrl: string
    marketPair: string
    marketConfig: Record<string, MarketConfig>
    onQuote?: (quote: Quote) => void
    onCandle?: (candle: { time: number; open: string; high: string; low: string; close: string }) => void
}

export function useWebSocket({ baseUrl, marketPair, marketConfig, onQuote, onCandle }: UseWebSocketOptions) {
    const wsRef = useRef<WebSocket | null>(null)
    const [connected, setConnected] = useState(false)

    const createWsUrl = useCallback((base: string) => {
        if (!base) return ""
        return base.replace(/^http/, "ws") + "/v1/ws"
    }, [])

    const connect = useCallback(() => {
        const wsUrl = createWsUrl(baseUrl)
        if (!wsUrl) return

        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
            setConnected(true)
            // Subscribe to pair
            ws.send(JSON.stringify({ type: "subscribe", pairs: [marketPair] }))
        }

        ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data)
                if (data.type === "quote") {
                    const cfg = marketConfig[marketPair] || { displayDecimals: 2, invertForApi: false }

                    let b = parseFloat(data.bid)
                    let a = parseFloat(data.ask)

                    if (cfg.invertForApi) {
                        const rawBid = b
                        const rawAsk = a
                        b = rawAsk > 0 ? 1 / rawAsk : 0
                        a = rawBid > 0 ? 1 / rawBid : 0
                    }

                    const s = a - b

                    onQuote?.({
                        bid: isNaN(b) ? String(data.bid) : b.toFixed(cfg.displayDecimals),
                        ask: isNaN(a) ? String(data.ask) : a.toFixed(cfg.displayDecimals),
                        spread: isNaN(s) ? String(data.spread) : s.toFixed(2),
                        ts: Number(data.ts)
                    })
                } else if (data.type === "candle") {
                    onCandle?.(data)
                }
            } catch {
                // ignore
            }
        }

        ws.onclose = () => {
            setConnected(false)
        }

        ws.onerror = () => {
            ws.close()
        }
    }, [baseUrl, marketPair, marketConfig, onQuote, onCandle, createWsUrl])

    const disconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close()
            wsRef.current = null
        }
        setConnected(false)
    }, [])

    useEffect(() => {
        return () => {
            disconnect()
        }
    }, [disconnect])

    return { connected, connect, disconnect }
}
