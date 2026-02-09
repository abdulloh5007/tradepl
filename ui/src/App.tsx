import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { toast, Toaster } from "sonner"

// Types
import type { Quote, View, Theme, Lang, MarketConfig, TradingAccount } from "./types"

// Utils
import { setCookie, storedLang, storedTheme, storedBaseUrl, storedToken, storedAccountId } from "./utils/cookies"
import { normalizeBaseUrl, apiPriceFromDisplay, toDisplayCandle } from "./utils/format"
import { t } from "./utils/i18n"

// API
import { createApiClient, createWsUrl } from "./api"

// Components
import { Header, Sidebar } from "./components"
import ConnectionBanner from "./components/ConnectionBanner"

// Pages
import { TradingPage, PositionsPage, BalancePage, AccountsPage, ApiPage, FaucetPage } from "./pages"

// Config
const marketPairs = ["UZS-USD"]
const marketConfig: Record<string, MarketConfig> = {
  "UZS-USD": { displayBase: 12850, displayDecimals: 2, apiDecimals: 8, invertForApi: true, spread: 5.0 }
}
const timeframes = ["1m", "5m", "10m", "15m", "30m", "1h"]
const candleLimit = 1000   // Initial load
const lazyLoadLimit = 500  // Load more when scrolling

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

function resolveView(): View {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : ""
  if (hash === "positions" || hash === "balance" || hash === "accounts" || hash === "api" || hash === "faucet") return hash
  return "chart"
}

export default function App() {
  // Core state
  const [lang, setLang] = useState<Lang>(storedLang)
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const [view, setView] = useState<View>(resolveView)
  const [baseUrl, setBaseUrl] = useState(storedBaseUrl())
  const [token, setToken] = useState(storedToken())
  const [activeAccountId, setActiveAccountId] = useState(storedAccountId())
  const [accounts, setAccounts] = useState<TradingAccount[]>([])

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

  // Lazy loading state
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMoreData, setHasMoreData] = useState(true)

  // Error logging flags - prevent repeated console spam
  const errorLogged = useRef({ ws: false, fetch: false })

  // Auth form state
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [authMode, setAuthMode] = useState<"login" | "register">("login")
  const [authLoading, setAuthLoading] = useState(false)

  const logout = useCallback(() => {
    setToken("")
    setActiveAccountId("")
    setAccounts([])
    setCookie("lv_token", "")
    setCookie("lv_account_id", "")
  }, [])

  // Verify session on page load - check if user exists in DB
  useEffect(() => {
    if (!token || !baseUrl) return

    const verifySession = async () => {
      try {
        const normalizedUrl = normalizeBaseUrl(baseUrl)
        const res = await fetch(`${normalizedUrl}/v1/auth/verify`, {
          headers: { Authorization: `Bearer ${token}` }
        })

        if (res.status === 401) {
          // User not found in DB - clear token and force re-login
          console.log("[Auth] Session invalid - user not found, logging out")
          logout()
        } else if (res.status === 429) {
          // Rate limited - just warn, don't logout
          console.warn("[Auth] Verify rate limited, skipping")
        }
      } catch (e) {
        // Network error - don't logout, might be temporary
        console.warn("[Auth] Verify failed (network):", e)
      }
    }

    verifySession()
  }, [baseUrl, token, logout])

  // Memoized API client (prevents recreation on every render = fixes lag)
  const normalizedBaseUrl = useMemo(() => normalizeBaseUrl(baseUrl), [baseUrl])
  const api = useMemo(() => createApiClient({ baseUrl: normalizedBaseUrl, token, activeAccountId }, logout), [normalizedBaseUrl, token, activeAccountId, logout])
  const marketPrice = quote?.bid ? parseFloat(quote.bid) : marketConfig[marketPair].displayBase

  const refreshAccounts = useCallback(async (preferredID?: string) => {
    if (!token) return
    const list = (await api.accounts()) || []
    setAccounts(list)

    if (list.length === 0) {
      if (activeAccountId) {
        setActiveAccountId("")
        setCookie("lv_account_id", "")
      }
      return
    }

    const preferred = preferredID || activeAccountId
    const fallbackActive = list.find(a => a.is_active)?.id || list[0].id
    const next = preferred && list.some(a => a.id === preferred) ? preferred : fallbackActive

    if (next !== activeAccountId) {
      setActiveAccountId(next)
      setCookie("lv_account_id", next)
    }
  }, [api, token, activeAccountId])

  useEffect(() => {
    if (!token) {
      setAccounts([])
      setActiveAccountId("")
      return
    }
    refreshAccounts().catch(() => { })
  }, [token, refreshAccounts])

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

  // Throttled candle updates to prevent excessive re-renders
  const candlesRef = useRef<Array<{ time: number; open: number; high: number; low: number; close: number }>>([])
  const pendingCandleRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null)
  const lastUpdateRef = useRef(0)
  const spreadMultiplierRef = useRef(1)

  useEffect(() => {
    const active = accounts.find(a => a.id === activeAccountId) || accounts.find(a => a.is_active)
    const next = active?.plan?.spread_multiplier
    spreadMultiplierRef.current = Number.isFinite(next) && (next || 0) > 0 ? (next as number) : 1
  }, [accounts, activeAccountId])

  // Track timeframe in ref to avoid WS reconnection on change
  const timeframeRef = useRef(timeframe)
  useEffect(() => {
    timeframeRef.current = timeframe
  }, [timeframe])

  // WebSocket - only connect if authenticated (token required by backend)
  useEffect(() => {
    // Skip WS connection if no token - backend will reject anyway
    if (!token) return

    const wsUrl = createWsUrl(normalizedBaseUrl, token)
    if (!wsUrl) return

    const ws = new WebSocket(wsUrl)

    // Throttled state update function
    const flushCandleUpdate = () => {
      if (pendingCandleRef.current && candlesRef.current.length > 0) {
        const pending = pendingCandleRef.current
        const candles = candlesRef.current
        const last = candles[candles.length - 1]
        const currentTf = timeframeRef.current

        // Parse timeframe to seconds
        let tfSeconds = 60
        if (currentTf === "5m") tfSeconds = 300
        else if (currentTf === "15m") tfSeconds = 900
        else if (currentTf === "30m") tfSeconds = 1800
        else if (currentTf === "1h") tfSeconds = 3600

        // Align pending candle time to current timeframe bucket
        // pending.time is unix seconds (from backend)
        const pendingTime = pending.time
        const bucketTime = pendingTime - (pendingTime % tfSeconds)

        if (last.time === bucketTime) {
          // Update last candle in place (Accessing High/Low properly)
          const newHigh = Math.max(last.high, pending.high)
          const newLow = Math.min(last.low, pending.low)

          candles[candles.length - 1] = {
            ...last,
            high: newHigh,
            low: newLow,
            close: pending.close // Close is always latest price
          }
        } else if (bucketTime > last.time) {
          // New candle for this timeframe
          // Initialize with current 1m data
          candles.push({
            time: bucketTime,
            open: pending.open,
            high: pending.high,
            low: pending.low,
            close: pending.close
          })

          // Keep only last 600 candles
          if (candles.length > 600) {
            candles.shift()
          }
        }
        // If bucketTime < last.time, it's old data, ignore it

        // Trigger state update
        setCandles([...candles])
        pendingCandleRef.current = null
        lastUpdateRef.current = Date.now()
      }
    }

    // Throttle interval: update UI frequently for smooth animation
    const throttleInterval = setInterval(() => {
      if (pendingCandleRef.current && Date.now() - lastUpdateRef.current > 100) {
        flushCandleUpdate()
      }
    }, 150)

    ws.onopen = () => {
      console.log("[WS] Connected, subscribing to:", marketPair)
      ws.send(JSON.stringify({ type: "subscribe", pairs: [marketPair] }))
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
          let l = parseFloat(quoteData.last) // New field

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
            ts: Number(quoteData.ts || Date.now())
          })
        } else if (eventType === "candle" || data.type === "candle") {
          const candleData = data.type === "candle" ? data : (data.time ? data : msg)
          const displayCandle = toDisplayCandle(marketPair, candleData, marketConfig)

          // Store pending candle (will be flushed by throttle)
          pendingCandleRef.current = displayCandle

          // If no candles yet, update immediately
          if (candlesRef.current.length === 0) {
            candlesRef.current = [displayCandle]
            setCandles([displayCandle])
            lastUpdateRef.current = Date.now()
          }
        }
      } catch { /* ignore */ }
    }

    ws.onerror = (err) => {
      if (!errorLogged.current.ws) {
        console.error("[WS] Error:", err)
        errorLogged.current.ws = true
      }
    }
    ws.onclose = () => console.log("[WS] Closed")

    return () => {
      clearInterval(throttleInterval)
      ws.close()
    }
  }, [normalizedBaseUrl, marketPair])

  // Fetch candles
  const fetchCandles = useCallback(async (tf?: string) => {
    const tfToUse = tf || timeframe
    try {
      const raw = await api.candles(marketPair, tfToUse, candleLimit, true)
      const display = raw.map(c => toDisplayCandle(marketPair, c, marketConfig))
      candlesRef.current = display // Sync ref for WebSocket updates
      setCandles(display)
      // Reset lazy loading state when fetching new data
      // Don't check candleLimit here - lazy loading will detect end of data
      setHasMoreData(true)
      setIsLoadingMore(false)
    } catch { /* ignore */ }
  }, [api, marketPair, timeframe])

  // Load more candles when scrolling back (lazy loading)
  const loadMoreCandles = useCallback(async (beforeTime: number) => {
    if (isLoadingMore || !hasMoreData) return
    setIsLoadingMore(true)

    try {
      const raw = await api.candles(marketPair, timeframe, lazyLoadLimit, false, beforeTime)
      if (raw.length === 0) {
        setHasMoreData(false)
        setIsLoadingMore(false)
        return
      }

      const display = raw.map(c => toDisplayCandle(marketPair, c, marketConfig))

      // Merge with existing candles, deduplicate by time
      const existingTimes = new Set(candles.map(c => c.time))
      const newCandles = display.filter(c => !existingTimes.has(c.time))

      if (newCandles.length === 0) {
        setHasMoreData(false)
        setIsLoadingMore(false)
        return
      }

      const merged = [...newCandles, ...candles].sort((a, b) => a.time - b.time)
      candlesRef.current = merged
      setCandles(merged)

      // If we got less than requested, no more data available
      if (raw.length < lazyLoadLimit) {
        setHasMoreData(false)
      }
    } catch { /* ignore */ }

    setIsLoadingMore(false)
  }, [api, marketPair, timeframe, candles, isLoadingMore, hasMoreData])

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
      setCookie("lv_account_id", "")
      setActiveAccountId("")
      toast.success(authMode === "login" ? "Logged in!" : "Registered!")
    } catch (err: any) {
      toast.error(err?.message || "Auth error")
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSwitchAccount = async (accountID: string) => {
    await api.switchAccount(accountID)
    setActiveAccountId(accountID)
    setCookie("lv_account_id", accountID)
    await refreshAccounts(accountID)
    api.metrics().then(m => setMetrics(m)).catch(() => { })
    api.orders().then(o => setOpenOrders(o || [])).catch(() => { })
  }

  const handleCreateAccount = async (payload: { plan_id: string; mode: "demo" | "real"; name?: string; is_active?: boolean }) => {
    const created = await api.createAccount(payload)
    const nextID = created?.id || activeAccountId
    if (nextID) {
      setActiveAccountId(nextID)
      setCookie("lv_account_id", nextID)
    }
    await refreshAccounts(nextID)
    api.metrics().then(m => setMetrics(m)).catch(() => { })
    api.orders().then(o => setOpenOrders(o || [])).catch(() => { })
  }

  const handleTopUpDemo = async (amount: string) => {
    await api.faucet({ asset: "USD", amount, reference: "accounts_topup" })
    await refreshAccounts(activeAccountId)
    api.metrics().then(m => setMetrics(m)).catch(() => { })
  }

  // Show login form if not authenticated
  if (!token) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-base)", alignItems: "center", justifyContent: "center" }}>
        <Toaster position="top-right" />
        <div style={{ background: "var(--card-bg)", padding: 32, borderRadius: 12, width: 360 }}>
          <h2 style={{ marginBottom: 24, textAlign: "center" }}>LV Trade</h2>

          {/* Base URL */}


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
      <ConnectionBanner />
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
            <TradingPage
              candles={candles}
              quote={quote}
              openOrders={openOrders}
              marketPair={marketPair}
              marketConfig={marketConfig}
              theme={theme}
              timeframes={timeframes}
              timeframe={timeframe}
              setTimeframe={setTimeframe}
              fetchCandles={fetchCandles}
              quickQty={quickQty}
              setQuickQty={setQuickQty}
              onBuy={() => handleQuickOrder("buy")}
              onSell={() => handleQuickOrder("sell")}
              lang={lang}
              onLoadMore={loadMoreCandles}
              isLoadingMore={isLoadingMore}
              hasMoreData={hasMoreData}
            />
          )}

          {view === "positions" && (
            <PositionsPage
              orders={openOrders}
              quote={quote}
              marketPair={marketPair}
              marketConfig={marketConfig}
              marketPrice={marketPrice}
              onClose={handleClosePosition}
              lang={lang}
            />
          )}

          {view === "balance" && (
            <BalancePage metrics={metrics} lang={lang} />
          )}

          {view === "accounts" && (
            <AccountsPage
              accounts={accounts}
              activeAccountId={activeAccountId}
              onSwitch={handleSwitchAccount}
              onCreate={handleCreateAccount}
              onTopUpDemo={handleTopUpDemo}
            />
          )}

          {view === "api" && <ApiPage />}

          {view === "faucet" && (
            <FaucetPage
              api={api}
              onMetricsUpdate={setMetrics}
              lang={lang}
              token={token}
              onLoginRequired={() => setView("api")}
            />
          )}


        </main>
      </div>
    </div>
  )
}
