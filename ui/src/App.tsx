import { useEffect, useState, useCallback } from "react"
import { toast, Toaster } from "sonner"

// Types
import type { Quote, View, Theme, Lang, MarketConfig } from "./types"

// Utils
import { setCookie, storedLang, storedTheme, storedBaseUrl, storedToken } from "./utils/cookies"
import { normalizeBaseUrl, apiPriceFromDisplay, toDisplayCandle } from "./utils/format"
import { t } from "./utils/i18n"

// API
import { createApiClient, createWsUrl } from "./api"

// Components
import { TradingChart, MarketPanel, PositionsTable, AccountMetrics, Header, Sidebar } from "./components"

// Config
const marketPairs = ["UZS-USD"]
const marketConfig: Record<string, MarketConfig> = {
  "UZS-USD": { displayBase: 12300, displayDecimals: 2, apiDecimals: 8, invertForApi: true, spread: 5.0 }
}
const timeframes = ["1m", "5m", "10m", "15m", "30m", "1h"]
const candleLimit = 500

function resolveView(): View {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : ""
  if (hash === "api" || hash === "faucet") return hash
  return "chart"
}

export default function App() {
  // Core state
  const [lang, setLang] = useState<Lang>(storedLang)
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const [view, setView] = useState<View>(resolveView)
  const [baseUrl, setBaseUrl] = useState(storedBaseUrl() || "")
  const [token, setToken] = useState(storedToken())

  // Market state
  const [marketPair] = useState(marketPairs[0])
  const [timeframe, setTimeframe] = useState("1m")
  const [candles, setCandles] = useState<Array<{ time: number; open: number; high: number; low: number; close: number }>>([])
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quickQty, setQuickQty] = useState("1")

  // Trading state
  const [openOrders, setOpenOrders] = useState<Array<{ id: string; pair_id: string; side: string; price: string; qty: string; status: string; created_at: string }>>([])
  const [metrics, setMetrics] = useState({
    balance: "0",
    equity: "0",
    margin: "0",
    free_margin: "0",
    margin_level: "0",
    pl: "0"
  })

  // Auth form state
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [authMode, setAuthMode] = useState<"login" | "register">("login")
  const [authLoading, setAuthLoading] = useState(false)

  // Derived
  const api = createApiClient({ baseUrl: normalizeBaseUrl(baseUrl), token })
  const marketPrice = quote?.bid ? parseFloat(quote.bid) : marketConfig[marketPair].displayBase

  // Persist preferences
  useEffect(() => {
    document.documentElement.lang = lang
    setCookie("lv_lang", lang)
  }, [lang])

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    setCookie("lv_theme", theme)
  }, [theme])

  useEffect(() => {
    window.location.hash = view
  }, [view])

  // WebSocket
  useEffect(() => {
    const wsUrl = createWsUrl(normalizeBaseUrl(baseUrl))
    if (!wsUrl) return

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", pairs: [marketPair] }))
    }

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === "quote") {
          const cfg = marketConfig[marketPair]
          let b = parseFloat(data.bid)
          let a = parseFloat(data.ask)

          if (cfg?.invertForApi) {
            const rawBid = b
            const rawAsk = a
            b = rawAsk > 0 ? 1 / rawAsk : 0
            a = rawBid > 0 ? 1 / rawBid : 0
          }

          setQuote({
            bid: isNaN(b) ? String(data.bid) : b.toFixed(cfg?.displayDecimals || 2),
            ask: isNaN(a) ? String(data.ask) : a.toFixed(cfg?.displayDecimals || 2),
            spread: (a - b).toFixed(2),
            ts: Number(data.ts)
          })
        } else if (data.type === "candle") {
          const displayCandle = toDisplayCandle(marketPair, data, marketConfig)
          setCandles(prev => {
            if (prev.length === 0) return [displayCandle]
            const last = prev[prev.length - 1]
            if (last.time === displayCandle.time) {
              return [...prev.slice(0, -1), displayCandle]
            } else if (displayCandle.time > last.time) {
              return [...prev, displayCandle]
            }
            return prev
          })
        }
      } catch { /* ignore */ }
    }

    return () => ws.close()
  }, [baseUrl, marketPair])

  // Fetch candles
  const fetchCandles = useCallback(async (tf?: string) => {
    const tfToUse = tf || timeframe
    try {
      const raw = await api.candles(marketPair, tfToUse, candleLimit, true)
      const display = raw.map(c => toDisplayCandle(marketPair, c, marketConfig))
      setCandles(display)
    } catch { /* ignore */ }
  }, [api, marketPair, timeframe])

  useEffect(() => {
    fetchCandles()
  }, [fetchCandles])

  // Polling metrics and orders
  useEffect(() => {
    if (!token) return
    let active = true

    const poll = () => {
      if (!active) return
      api.metrics().then(m => active && setMetrics(m)).catch(() => { })
      api.orders().then(o => active && setOpenOrders(o || [])).catch(() => { })
    }

    poll()
    const interval = setInterval(poll, 2000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [api, token])

  // Handlers
  const logout = () => {
    setToken("")
    setCookie("lv_token", "")
  }

  const handleQuickOrder = async (side: "buy" | "sell") => {
    if (!quickQty || Number(quickQty) <= 0) {
      toast.message(t("qty", lang))
      return
    }
    try {
      await api.placeOrder({
        pair: marketPair,
        side,
        type: "market",
        qty: quickQty,
        time_in_force: "ioc"
      })
      toast.success(t("statusOrderPlaced", lang))
      api.orders().then(o => setOpenOrders(o || []))
      api.metrics().then(m => setMetrics(m))
    } catch (err: any) {
      toast.error(err?.message || "Error")
    }
  }

  const handleClosePosition = async (orderId: string) => {
    try {
      await api.cancelOrder(orderId)
      toast.success("Position closed")
      api.orders().then(o => setOpenOrders(o || []))
      api.metrics().then(m => setMetrics(m))
    } catch (err: any) {
      toast.error(err?.message || "Error")
    }
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      toast.error("Please enter email and password")
      return
    }
    setAuthLoading(true)
    try {
      const res = authMode === "login"
        ? await api.login(email, password)
        : await api.register(email, password)
      setToken(res.access_token)
      setCookie("lv_token", res.access_token)
      toast.success(authMode === "login" ? "Logged in!" : "Registered!")
    } catch (err: any) {
      toast.error(err?.message || "Auth error")
    } finally {
      setAuthLoading(false)
    }
  }

  // Show login form if not authenticated
  if (!token) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-base)", alignItems: "center", justifyContent: "center" }}>
        <Toaster position="top-right" />
        <div style={{ background: "var(--card-bg)", padding: 32, borderRadius: 12, width: 360 }}>
          <h2 style={{ marginBottom: 24, textAlign: "center" }}>LV Trade</h2>

          {/* Base URL */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>API Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              onBlur={() => setCookie("lv_baseurl", normalizeBaseUrl(baseUrl))}
              placeholder="http://localhost:8080"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                background: "var(--input-bg)",
                color: "var(--text-base)",
                fontSize: 14
              }}
            />
          </div>

          <form onSubmit={handleAuth}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="user@example.com"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  background: "var(--input-bg)",
                  color: "var(--text-base)",
                  fontSize: 14
                }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  background: "var(--input-bg)",
                  color: "var(--text-base)",
                  fontSize: 14
                }}
              />
            </div>
            <button
              type="submit"
              disabled={authLoading}
              style={{
                width: "100%",
                padding: "12px 0",
                background: "linear-gradient(180deg, #16a34a 0%, #15803d 100%)",
                color: "white",
                border: "none",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 15,
                cursor: authLoading ? "wait" : "pointer",
                marginBottom: 12
              }}
            >
              {authLoading ? "..." : authMode === "login" ? t("login", lang) : t("register", lang)}
            </button>
          </form>

          <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
            {authMode === "login" ? (
              <>No account? <button onClick={() => setAuthMode("register")} style={{ background: "none", border: "none", color: "var(--accent-text)", cursor: "pointer" }}>{t("register", lang)}</button></>
            ) : (
              <>Have account? <button onClick={() => setAuthMode("login")} style={{ background: "none", border: "none", color: "var(--accent-text)", cursor: "pointer" }}>{t("login", lang)}</button></>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-base)" }}>
      <Toaster position="top-right" />

      <Header
        theme={theme}
        setTheme={setTheme}
        lang={lang}
        setLang={setLang}
        token={token}
        onLogout={logout}
      />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar view={view} setView={setView} lang={lang} />

        <main style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {view === "chart" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, height: "100%" }}>
              {/* Left: Chart + Positions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Timeframe Selector */}
                <div style={{ display: "flex", gap: 8 }}>
                  {timeframes.map(tf => (
                    <button
                      key={tf}
                      onClick={() => { setTimeframe(tf); fetchCandles(tf) }}
                      style={{
                        padding: "6px 12px",
                        border: timeframe === tf ? "1px solid var(--accent-border)" : "1px solid var(--border-subtle)",
                        borderRadius: 4,
                        background: timeframe === tf ? "var(--accent-bg)" : "transparent",
                        color: timeframe === tf ? "var(--accent-text)" : "var(--text-base)",
                        fontSize: 12,
                        cursor: "pointer"
                      }}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                {/* Chart */}
                <div style={{ flex: 1, minHeight: 400 }}>
                  <TradingChart
                    candles={candles as any}
                    quote={quote}
                    openOrders={openOrders}
                    marketPair={marketPair}
                    marketConfig={marketConfig}
                    theme={theme}
                  />
                </div>

                {/* Positions */}
                <PositionsTable
                  orders={openOrders}
                  quote={quote}
                  marketPair={marketPair}
                  marketConfig={marketConfig}
                  marketPrice={marketPrice}
                  onClose={handleClosePosition}
                  lang={lang}
                />
              </div>

              {/* Right: Market Panel + Metrics */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <MarketPanel
                  quote={quote}
                  quickQty={quickQty}
                  setQuickQty={setQuickQty}
                  onBuy={() => handleQuickOrder("buy")}
                  onSell={() => handleQuickOrder("sell")}
                  lang={lang}
                />
                <AccountMetrics metrics={metrics} lang={lang} />
              </div>
            </div>
          )}

          {view === "api" && (
            <div style={{ padding: 24, background: "var(--card-bg)", borderRadius: 8 }}>
              <h2 style={{ marginBottom: 16 }}>API Documentation</h2>
              <p style={{ color: "var(--text-muted)" }}>
                API documentation coming soon. Use the Chart view to trade.
              </p>
            </div>
          )}
          {view === "faucet" && (
            <div style={{ padding: 24, background: "var(--card-bg)", borderRadius: 8 }}>
              <h2 style={{ marginBottom: 16 }}>Faucet</h2>
              <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
                Get test funds to start trading.
              </p>
              <button
                onClick={async () => {
                  try {
                    await api.faucet({ asset: "USD", amount: "10000", reference: "dev" })
                    toast.success("Received 10,000 USD!")
                    api.metrics().then(m => setMetrics(m))
                  } catch (err: any) {
                    toast.error(err?.message || "Error")
                  }
                }}
                style={{
                  padding: "12px 24px",
                  background: "linear-gradient(180deg, #16a34a 0%, #15803d 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Get 10,000 USD
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
