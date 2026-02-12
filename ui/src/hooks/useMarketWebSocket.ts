import { useEffect, useRef } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { Quote, MarketConfig, Metrics, TradingAccount } from "../types"
import type { AccountSnapshot } from "../components/accounts/types"
import { createWsUrl } from "../api"
import { toDisplayCandle } from "../utils/format"

type CandlePoint = { time: number; open: number; high: number; low: number; close: number }

type UseMarketWebSocketParams = {
  token: string
  normalizedBaseUrl: string
  marketPair: string
  marketConfig: Record<string, MarketConfig>
  timeframe: string
  accounts: TradingAccount[]
  activeAccountId: string
  setQuote: Dispatch<SetStateAction<Quote | null>>
  setCandles: Dispatch<SetStateAction<CandlePoint[]>>
  setAccountSnapshots: Dispatch<SetStateAction<Record<string, AccountSnapshot>>>
  errorLoggedRef: MutableRefObject<{ ws: boolean; fetch: boolean }>
  wsConnectionRef: MutableRefObject<WebSocket | null>
}

function applySpreadMultiplier(bid: number, ask: number, multiplier: number): [number, number] {
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    return [bid, ask]
  }
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
  const mid = (bid + ask) / 2
  const spread = Math.max(0, (ask - bid) * safeMultiplier)
  return [mid - spread / 2, mid + spread / 2]
}

function spreadDecimals(ask: number, bid: number, baseDecimals: number): number {
  const s = Math.abs(ask - bid)
  if (!Number.isFinite(s)) return Math.max(2, baseDecimals)
  if (s < 0.01) return Math.max(6, baseDecimals + 4)
  if (s < 1) return Math.max(4, baseDecimals + 2)
  return Math.max(2, baseDecimals)
}

export function useMarketWebSocket({
  token,
  normalizedBaseUrl,
  marketPair,
  marketConfig,
  timeframe,
  accounts,
  activeAccountId,
  setQuote,
  setCandles,
  setAccountSnapshots,
  errorLoggedRef,
  wsConnectionRef,
}: UseMarketWebSocketParams) {
  const candlesRef = useRef<CandlePoint[]>([])
  const pendingCandleRef = useRef<CandlePoint | null>(null)
  const lastUpdateRef = useRef(0)
  const spreadMultiplierRef = useRef(1)
  const timeframeRef = useRef(timeframe)

  useEffect(() => {
    const active = accounts.find(a => a.id === activeAccountId) || accounts.find(a => a.is_active)
    const next = active?.plan?.spread_multiplier
    spreadMultiplierRef.current = Number.isFinite(next) && (next || 0) > 0 ? (next as number) : 1
  }, [accounts, activeAccountId])

  useEffect(() => {
    timeframeRef.current = timeframe
  }, [timeframe])

  useEffect(() => {
    if (!token) return

    const wsUrl = createWsUrl(normalizedBaseUrl, token)
    if (!wsUrl) return

    const ws = new WebSocket(wsUrl)
    wsConnectionRef.current = ws

    const flushCandleUpdate = () => {
      if (pendingCandleRef.current && candlesRef.current.length > 0) {
        const pending = pendingCandleRef.current
        const candles = candlesRef.current
        const last = candles[candles.length - 1]
        const currentTf = timeframeRef.current

        let tfSeconds = 60
        if (currentTf === "5m") tfSeconds = 300
        else if (currentTf === "15m") tfSeconds = 900
        else if (currentTf === "30m") tfSeconds = 1800
        else if (currentTf === "1h") tfSeconds = 3600

        const pendingTime = pending.time
        const bucketTime = pendingTime - (pendingTime % tfSeconds)

        if (last.time === bucketTime) {
          const newHigh = Math.max(last.high, pending.high)
          const newLow = Math.min(last.low, pending.low)

          candles[candles.length - 1] = {
            ...last,
            high: newHigh,
            low: newLow,
            close: pending.close,
          }
        } else if (bucketTime > last.time) {
          candles.push({
            time: bucketTime,
            open: pending.open,
            high: pending.high,
            low: pending.low,
            close: pending.close,
          })
          if (candles.length > 600) {
            candles.shift()
          }
        }

        setCandles([...candles])
        pendingCandleRef.current = null
        lastUpdateRef.current = Date.now()
      }
    }

    const throttleInterval = setInterval(() => {
      if (pendingCandleRef.current && Date.now() - lastUpdateRef.current > 100) {
        flushCandleUpdate()
      }
    }, 150)

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", pairs: [marketPair] }))
      ws.send(JSON.stringify({ type: "account_snapshots_subscribe", enabled: true }))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        const eventType = msg.type
        const data = msg.data || msg

        if (eventType === "quote" || data.type === "quote") {
          const quoteData = data.type === "quote" ? data : msg
          const cfg = marketConfig[marketPair]
          let b = parseFloat(quoteData.bid)
          let a = parseFloat(quoteData.ask)
          let l = parseFloat(quoteData.last)

          ;[b, a] = applySpreadMultiplier(b, a, spreadMultiplierRef.current)

          if (cfg?.invertForApi) {
            const rawBid = b
            const rawAsk = a
            const rawLast = l
            b = rawAsk > 0 ? 1 / rawAsk : 0
            a = rawBid > 0 ? 1 / rawBid : 0
            l = rawLast > 0 ? 1 / rawLast : 0
          }

          setQuote({
            bid: isNaN(b) ? String(quoteData.bid) : b.toFixed(cfg?.displayDecimals || 2),
            ask: isNaN(a) ? String(quoteData.ask) : a.toFixed(cfg?.displayDecimals || 2),
            last: isNaN(l) ? (isNaN(b) ? "—" : b.toFixed(cfg?.displayDecimals || 2)) : l.toFixed(cfg?.displayDecimals || 2),
            spread: (a - b).toFixed(spreadDecimals(a, b, cfg?.displayDecimals || 2)),
            ts: Number(quoteData.ts || Date.now()),
          })
        } else if (eventType === "candle" || data.type === "candle") {
          const candleData = data.type === "candle" ? data : (data.time ? data : msg)
          const displayCandle = toDisplayCandle(marketPair, candleData, marketConfig)

          pendingCandleRef.current = displayCandle

          if (candlesRef.current.length === 0) {
            candlesRef.current = [displayCandle]
            setCandles([displayCandle])
            lastUpdateRef.current = Date.now()
          }
        } else if (eventType === "account_snapshots") {
          const payload = data && typeof data === "object" ? data : {}
          const items = Array.isArray((payload as any).items) ? (payload as any).items : []
          if (items.length === 0) return

          const nextSnapshots: Record<string, AccountSnapshot> = {}
          for (const item of items) {
            const accountID = String((item as any)?.account_id || "").trim()
            if (!accountID) continue

            const rawMetrics = (item as any)?.metrics
            const metricsObj: Metrics | null = rawMetrics && typeof rawMetrics === "object"
              ? {
                balance: String((rawMetrics as any).balance || "0"),
                equity: String((rawMetrics as any).equity || "0"),
                margin: String((rawMetrics as any).margin || "0"),
                free_margin: String((rawMetrics as any).free_margin || "0"),
                margin_level: String((rawMetrics as any).margin_level || "0"),
                pl: String((rawMetrics as any).pl || "0"),
              }
              : null

            const plRaw = Number((item as any)?.pl ?? metricsObj?.pl ?? 0)
            const openCountRaw = Number((item as any)?.open_count ?? 0)

            nextSnapshots[accountID] = {
              pl: Number.isFinite(plRaw) ? plRaw : 0,
              openCount: Number.isFinite(openCountRaw) ? Math.max(0, Math.trunc(openCountRaw)) : 0,
              metrics: metricsObj,
            }
          }

          if (Object.keys(nextSnapshots).length > 0) {
            setAccountSnapshots(prev => ({ ...prev, ...nextSnapshots }))
          }
        }
      } catch {
        // ignore malformed events
      }
    }

    ws.onerror = (err) => {
      if (!errorLoggedRef.current.ws) {
        console.error("[WS] Error:", err)
        errorLoggedRef.current.ws = true
      }
    }

    ws.onclose = () => {
      // no-op
    }

    return () => {
      clearInterval(throttleInterval)
      if (wsConnectionRef.current === ws) {
        wsConnectionRef.current = null
      }
      ws.close()
    }
  }, [token, normalizedBaseUrl, marketPair, marketConfig, setAccountSnapshots, setCandles, setQuote, errorLoggedRef, wsConnectionRef])

  return { candlesRef }
}
