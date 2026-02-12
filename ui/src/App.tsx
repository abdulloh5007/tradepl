import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { toast, Toaster } from "sonner"

// Types
import type { Quote, View, Theme, Lang, MarketConfig, TradingAccount, Order, Metrics } from "./types"

// Utils
import { setCookie, storedLang, storedTheme, storedBaseUrl, storedToken, storedAccountId, storedTimeframe } from "./utils/cookies"
import { normalizeBaseUrl, toDisplayCandle } from "./utils/format"
import { t } from "./utils/i18n"
import { calcDisplayedOrderProfit } from "./utils/trading"
import { useMarketWebSocket } from "./hooks/useMarketWebSocket"

// API
import { createApiClient, type UserProfile } from "./api"

// Components
import BottomNav from "./components/BottomNav"
import ConnectionBanner from "./components/ConnectionBanner"
import AppAuthGate from "./components/auth/AppAuthGate"
import AppViewRouter from "./components/AppViewRouter"
import type { AccountSnapshot } from "./components/accounts/types"

// Config
const marketPairs = ["UZS-USD"]
const marketConfig: Record<string, MarketConfig> = {
  "UZS-USD": { displayBase: 12850, displayDecimals: 2, apiDecimals: 8, invertForApi: true, spread: 5.0 }
}
const timeframes = ["1m", "5m", "10m", "15m", "30m", "1h"]
const candleLimit = 1000   // Initial load
const lazyLoadLimit = 500  // Load more when scrolling
const historyPageLimit = 50

type PollKey = "metrics" | "orders"
type PollBackoffState = Record<PollKey, { failures: number; retryAt: number }>

function resolveView(): View {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : ""
  if (hash === "positions" || hash === "history" || hash === "accounts" || hash === "profile" || hash === "api" || hash === "faucet") return hash
  if (hash === "balance") return "positions"
  return "chart"
}

function telegramInitData(): string {
  if (typeof window === "undefined") return ""
  return (window.Telegram?.WebApp?.initData || "").trim()
}

function isTelegramMiniApp(): boolean {
  return telegramInitData().length > 0
}

export default function App() {
  // Core state
  const [lang, setLang] = useState<Lang>(storedLang)
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const [view, setView] = useState<View>(resolveView)
  const [baseUrl] = useState(storedBaseUrl())
  const [token, setToken] = useState(storedToken())
  const [activeAccountId, setActiveAccountId] = useState(storedAccountId())
  const [accounts, setAccounts] = useState<TradingAccount[]>([])

  // Market state
  const [marketPair] = useState(marketPairs[0])
  const [timeframe, setTimeframe] = useState(storedTimeframe)
  const [candles, setCandles] = useState<Array<{ time: number; open: number; high: number; low: number; close: number }>>([])
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quickQty, setQuickQty] = useState("0.01")

  // Trading state
  const [openOrders, setOpenOrders] = useState<Order[]>([])
  const [orderHistory, setOrderHistory] = useState<Order[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyHasMore, setHistoryHasMore] = useState(true)
  const [historyAccountId, setHistoryAccountId] = useState("")
  const [metricsAccountId, setMetricsAccountId] = useState("")
  const [ordersAccountId, setOrdersAccountId] = useState("")
  const [metrics, setMetrics] = useState<Metrics>({
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
  const [bulkClosing, setBulkClosing] = useState(false)
  const [accountSnapshots, setAccountSnapshots] = useState<Record<string, AccountSnapshot>>({})
  const [pollBackoff, setPollBackoff] = useState<PollBackoffState>({
    metrics: { failures: 0, retryAt: 0 },
    orders: { failures: 0, retryAt: 0 }
  })

  // Error logging flags - prevent repeated console spam
  const errorLogged = useRef({ ws: false, fetch: false })
  const historyLoadingRef = useRef(false)
  const historyFailureRef = useRef(0)
  const historyRetryAtRef = useRef(0)
  const orderHistoryRef = useRef<Order[]>([])
  const wsConnectionRef = useRef<WebSocket | null>(null)
  const historyAccountIdRef = useRef("")
  const activeAccountIdRef = useRef("")
  const systemNoticeByAccountRef = useRef<Record<string, string>>({})

  // Auth form state
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [authMode, setAuthMode] = useState<"login" | "register">("login")
  const [authLoading, setAuthLoading] = useState(false)
  const [autoAuthChecked, setAutoAuthChecked] = useState(false)
  const [authFlowMode, setAuthFlowMode] = useState<"development" | "production" | null>(null)
  const [telegramAuthError, setTelegramAuthError] = useState("")
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const telegramRedirectedRef = useRef(false)

  const logout = useCallback(() => {
    setToken("")
    setProfile(null)
    setTelegramAuthError("")
    telegramRedirectedRef.current = false
    setActiveAccountId("")
    setAccounts([])
    setOpenOrders([])
    setOrderHistory([])
    setHistoryAccountId("")
    setMetricsAccountId("")
    setOrdersAccountId("")
    setAccountSnapshots({})
    setHistoryHasMore(true)
    setPollBackoff({
      metrics: { failures: 0, retryAt: 0 },
      orders: { failures: 0, retryAt: 0 }
    })
    setCookie("lv_token", "")
    setCookie("lv_account_id", "")
    systemNoticeByAccountRef.current = {}
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
  const authApi = useMemo(() => createApiClient({ baseUrl: normalizedBaseUrl, token }, logout), [normalizedBaseUrl, token, logout])
  const publicApi = useMemo(() => createApiClient({ baseUrl: normalizedBaseUrl, token: "" }), [normalizedBaseUrl])
  const lastDisplay = quote?.last ? parseFloat(quote.last) : NaN
  const rawBidDisplay = quote?.bid ? parseFloat(quote.bid) : NaN
  const rawAskDisplay = quote?.ask ? parseFloat(quote.ask) : NaN
  const marketPrice = Number.isFinite(lastDisplay) && lastDisplay > 0
    ? lastDisplay
    : (Number.isFinite(rawBidDisplay) && rawBidDisplay > 0 ? rawBidDisplay : marketConfig[marketPair].displayBase)
  const bidDisplay = Number.isFinite(rawBidDisplay) && rawBidDisplay > 0 ? rawBidDisplay : marketPrice
  const askDisplay = Number.isFinite(rawAskDisplay) && rawAskDisplay > 0 ? rawAskDisplay : marketPrice
  const activeTradingAccount = useMemo(() => {
    return accounts.find(a => a.id === activeAccountId) || accounts.find(a => a.is_active) || null
  }, [accounts, activeAccountId])

  const liveMetrics = useMemo<Metrics>(() => {
    const toSafe = (v?: string) => {
      const n = parseFloat(v || "0")
      return Number.isFinite(n) ? n : 0
    }

    const hasFreshMetrics = metricsAccountId !== "" && metricsAccountId === activeAccountId
    const hasFreshOrders = ordersAccountId !== "" && ordersAccountId === activeAccountId
    const fallbackBalance = Number(activeTradingAccount?.balance || 0)
    const metricsSource = hasFreshMetrics
      ? metrics
      : {
        balance: String(Number.isFinite(fallbackBalance) ? fallbackBalance : 0),
        equity: String(Number.isFinite(fallbackBalance) ? fallbackBalance : 0),
        margin: "0",
        free_margin: String(Number.isFinite(fallbackBalance) ? fallbackBalance : 0),
        margin_level: "0",
        pl: "0"
      }
    const ordersSource = hasFreshOrders ? openOrders : []

    const baseBalance = toSafe(metricsSource.balance)
    const baseMargin = Math.max(0, toSafe(metricsSource.margin))

    let livePl = 0
    for (const order of ordersSource) {
      livePl += calcDisplayedOrderProfit(order, bidDisplay, askDisplay, marketPair, marketConfig, marketPrice)
    }
    if (!Number.isFinite(livePl)) livePl = toSafe(metricsSource.pl)
    if (Math.abs(livePl) < 0.000000000001) livePl = 0

    const equity = baseBalance + livePl
    const freeMargin = equity - baseMargin
    let marginLevel = 0
    if (baseMargin > 0) {
      marginLevel = (equity / baseMargin) * 100
    }

    return {
      balance: String(baseBalance),
      equity: String(equity),
      margin: String(baseMargin),
      free_margin: String(freeMargin),
      margin_level: String(marginLevel),
      pl: String(livePl)
    }
  }, [
    metrics,
    metricsAccountId,
    ordersAccountId,
    activeAccountId,
    activeTradingAccount?.balance,
    openOrders,
    bidDisplay,
    askDisplay,
    marketPrice,
    marketPair,
    marketConfig
  ])

  const isLiveTradingView = view === "chart" || view === "positions" || view === "accounts"

  const setPollBackoffState = useCallback((key: PollKey, failures: number, retryAt: number) => {
    setPollBackoff(prev => {
      const current = prev[key]
      if (current.failures === failures && current.retryAt === retryAt) return prev
      return { ...prev, [key]: { failures, retryAt } }
    })
  }, [])

  const apiBackoff = useMemo(() => {
    const entries: Array<{ source: PollKey; failures: number; retryAt: number }> = []
    if (pollBackoff.metrics.failures > 0 && pollBackoff.metrics.retryAt > 0) {
      entries.push({ source: "metrics", failures: pollBackoff.metrics.failures, retryAt: pollBackoff.metrics.retryAt })
    }
    if (pollBackoff.orders.failures > 0 && pollBackoff.orders.retryAt > 0) {
      entries.push({ source: "orders", failures: pollBackoff.orders.failures, retryAt: pollBackoff.orders.retryAt })
    }
    if (entries.length === 0) return null
    entries.sort((a, b) => b.retryAt - a.retryAt)
    return entries[0]
  }, [pollBackoff])

  useEffect(() => {
    orderHistoryRef.current = orderHistory
  }, [orderHistory])

  useEffect(() => {
    historyAccountIdRef.current = historyAccountId
  }, [historyAccountId])

  useEffect(() => {
    activeAccountIdRef.current = activeAccountId
  }, [activeAccountId])

  const fetchOrderHistory = useCallback(async (reset = true) => {
    if (!token) return
    const requestAccountId = activeAccountId
    if (historyLoadingRef.current) return
    if (Date.now() < historyRetryAtRef.current) return

    historyLoadingRef.current = true
    setHistoryLoading(true)
    try {
      const accountChanged = historyAccountIdRef.current !== requestAccountId
      const shouldReset = reset || accountChanged
      const lastOrder = shouldReset ? undefined : orderHistoryRef.current[orderHistoryRef.current.length - 1]
      const before = lastOrder ? (lastOrder.close_time || lastOrder.created_at) : undefined
      const page = (await api.orderHistory({ limit: historyPageLimit, before })) || []

      if (activeAccountIdRef.current !== requestAccountId) {
        return
      }

      if (shouldReset) {
        setOrderHistory(page)
        setHistoryAccountId(requestAccountId)
      } else if (page.length > 0) {
        setOrderHistory(prev => {
          const seen = new Set(prev.map(o => o.id))
          const merged = [...prev]
          for (const order of page) {
            if (!seen.has(order.id)) merged.push(order)
          }
          return merged
        })
      }

      setHistoryHasMore(page.length === historyPageLimit)
      historyFailureRef.current = 0
      historyRetryAtRef.current = 0
    } catch (err) {
      historyFailureRef.current += 1
      const failures = historyFailureRef.current
      const delay = failures === 1 ? 3000 : failures === 2 ? 8000 : 15000
      historyRetryAtRef.current = Date.now() + delay
      throw err
    } finally {
      historyLoadingRef.current = false
      setHistoryLoading(false)
    }
  }, [api, token, activeAccountId])

  const refreshOrders = useCallback(async () => {
    const requestAccountId = activeAccountId
    const orders = (await api.orders()) || []
    if (activeAccountIdRef.current !== requestAccountId) return
    setOpenOrders(orders)
    setOrdersAccountId(requestAccountId)
  }, [api, activeAccountId])

  const refreshMetrics = useCallback(async () => {
    const requestAccountId = activeAccountId
    const m = await api.metrics()
    if (activeAccountIdRef.current !== requestAccountId) return
    setMetrics(m)
    setMetricsAccountId(requestAccountId)
    const notice = String(m?.system_notice || "").trim()
    if (notice) {
      const prevNotice = systemNoticeByAccountRef.current[requestAccountId] || ""
      if (prevNotice !== notice) {
        toast.message(notice)
        systemNoticeByAccountRef.current[requestAccountId] = notice
        if (notice.includes("changed leverage to 1:2000")) {
          setAccounts(prev => prev.map(acc => (
            acc.id === requestAccountId ? { ...acc, leverage: 2000 } : acc
          )))
        }
      }
    }
  }, [api, activeAccountId])

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

  const refreshAccountSnapshots = useCallback(async (sourceAccounts?: TradingAccount[]) => {
    if (!token) return
    const list = sourceAccounts || accounts
    if (list.length === 0) {
      setAccountSnapshots({})
      return
    }

    const entries = await Promise.all(list.map(async (account) => {
      const scopedApi = createApiClient(
        { baseUrl: normalizedBaseUrl, token, activeAccountId: account.id },
        logout
      )
      try {
        const [scopedMetrics, scopedOrders] = await Promise.all([
          scopedApi.metrics().catch(() => null),
          scopedApi.orders().catch(() => null)
        ])
        const openCount = (scopedOrders || []).filter(o => o.status === "filled").length
        const pl = Number(scopedMetrics?.pl || 0)
        return [
          account.id,
          {
            pl: Number.isFinite(pl) ? pl : 0,
            openCount,
            metrics: scopedMetrics
          } satisfies AccountSnapshot
        ] as const
      } catch {
        return [
          account.id,
          {
            pl: 0,
            openCount: 0,
            metrics: null
          } satisfies AccountSnapshot
        ] as const
      }
    }))

    setAccountSnapshots(Object.fromEntries(entries))
  }, [token, accounts, normalizedBaseUrl, logout])

  useEffect(() => {
    if (!token) {
      setAccounts([])
      setActiveAccountId("")
      setOpenOrders([])
      setOrderHistory([])
      setHistoryAccountId("")
      setMetricsAccountId("")
      setOrdersAccountId("")
      setAccountSnapshots({})
      setHistoryHasMore(true)
      setHistoryLoading(false)
      historyLoadingRef.current = false
      historyFailureRef.current = 0
      historyRetryAtRef.current = 0
      setPollBackoff({
        metrics: { failures: 0, retryAt: 0 },
        orders: { failures: 0, retryAt: 0 }
      })
      return
    }
    refreshAccounts().catch(() => { })
  }, [token, refreshAccounts])

  useEffect(() => {
    let cancelled = false
    publicApi.authMode()
      .then((res) => {
        if (cancelled) return
        const mode = res?.mode === "production" ? "production" : "development"
        setAuthFlowMode(mode)
      })
      .catch(() => {
        if (cancelled) return
        setAuthFlowMode("development")
      })
    return () => {
      cancelled = true
    }
  }, [publicApi])

  useEffect(() => {
    if (!authFlowMode) return
    if (token) {
      setAutoAuthChecked(true)
      return
    }

    if (authFlowMode !== "production") {
      setAutoAuthChecked(true)
      return
    }

    const initData = telegramInitData()
    if (!initData) {
      setAutoAuthChecked(true)
      return
    }

    let cancelled = false
    setAuthLoading(true)
    window.Telegram?.WebApp?.ready?.()
    ; (async () => {
      try {
        setTelegramAuthError("")
        const res = await publicApi.telegramAuth(initData)
        if (cancelled) return
        setToken(res.access_token)
        setProfile(res.user || null)
        setCookie("lv_token", res.access_token)
        setCookie("lv_account_id", "")
        setActiveAccountId("")
        setView("accounts")
      } catch (err: any) {
        if (cancelled) return
        setTelegramAuthError(err?.message || "Telegram authentication failed")
        setCookie("lv_token", "")
      } finally {
        if (!cancelled) {
          setAuthLoading(false)
          setAutoAuthChecked(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token, publicApi, authFlowMode])

  useEffect(() => {
    if (!token) {
      setProfile(null)
      return
    }
    authApi.me()
      .then(user => setProfile(user))
      .catch(() => { })
  }, [token, authApi])

  useEffect(() => {
    if (telegramRedirectedRef.current) return
    if (authFlowMode !== "production") return
    if (!token || !isTelegramMiniApp()) return
    setView("accounts")
    telegramRedirectedRef.current = true
  }, [token, authFlowMode])

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
    setCookie("lv_timeframe", timeframe)
  }, [timeframe])

  useEffect(() => {
    window.location.hash = view
  }, [view])

  const { candlesRef } = useMarketWebSocket({
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
    errorLoggedRef: errorLogged,
    wsConnectionRef,
  })

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

  useEffect(() => {
    if (!token || view !== "history") return
    if (historyAccountIdRef.current === activeAccountId && orderHistoryRef.current.length > 0) return
    fetchOrderHistory(true).catch(() => { })
  }, [token, view, fetchOrderHistory, activeAccountId])

  useEffect(() => {
    if (!token) return
    setOpenOrders([])
    setOrdersAccountId("")
    setMetricsAccountId("")
  }, [activeAccountId, token])

  useEffect(() => {
    if (!token) return
    setOrderHistory([])
    setHistoryAccountId(activeAccountId)
    setHistoryHasMore(true)
    setHistoryLoading(false)
    historyLoadingRef.current = false
    historyFailureRef.current = 0
    historyRetryAtRef.current = 0
  }, [activeAccountId, token])

  // Fast polling for account metrics on live trading views.
  useEffect(() => {
    if (!token || !isLiveTradingView) {
      setPollBackoffState("metrics", 0, 0)
      return
    }

    let cancelled = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const nextDelay = (base: number) => {
      if (failures >= 2) return 20000
      if (failures === 1) return 5000
      return base
    }

    const poll = async () => {
      if (cancelled) return
      try {
        await refreshMetrics()
        failures = 0
        setPollBackoffState("metrics", 0, 0)
      } catch {
        failures += 1
        const delay = nextDelay(750)
        setPollBackoffState("metrics", failures, Date.now() + delay)
        if (!cancelled) timer = setTimeout(poll, delay)
        return
      }
      if (!cancelled) timer = setTimeout(poll, 750)
    }

    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [token, isLiveTradingView, refreshMetrics, setPollBackoffState])

  // Orders polling only on live views with backoff and cooldown.
  useEffect(() => {
    if (!token || !isLiveTradingView) {
      setPollBackoffState("orders", 0, 0)
      return
    }

    let cancelled = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const nextDelay = (base: number) => {
      if (failures >= 2) return 20000
      if (failures === 1) return 5000
      return base
    }

    const poll = async () => {
      if (cancelled) return
      try {
        await refreshOrders()
        failures = 0
        setPollBackoffState("orders", 0, 0)
      } catch {
        failures += 1
        const delay = nextDelay(2000)
        setPollBackoffState("orders", failures, Date.now() + delay)
        if (!cancelled) timer = setTimeout(poll, delay)
        return
      }
      if (!cancelled) timer = setTimeout(poll, 2000)
    }

    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [token, isLiveTradingView, refreshOrders, setPollBackoffState])



  const handleQuickOrder = async (side: "buy" | "sell") => {
    const qtyRaw = (quickQty || "").trim()
    const qtyOk = /^\d{1,3}(\.\d{1,2})?$/.test(qtyRaw)
    const qtyNum = Number(qtyRaw)
    if (!qtyOk || !Number.isFinite(qtyNum) || qtyNum < 0.01 || qtyNum > 999.99) {
      toast.message(t("qty", lang))
      return
    }
    if (!activeTradingAccount) {
      toast.error("Select active account first")
      return
    }
    if (side === "buy") {
      const usdBalance = Number(activeTradingAccount.balance || 0)
      if (!Number.isFinite(usdBalance) || usdBalance <= 0) {
        toast.error(activeTradingAccount.mode === "demo"
          ? "Demo account balance is 0. Use Top Up in Accounts."
          : "Real account balance is 0. Deposit funds first.")
        return
      }
    }
    try {
      await api.placeOrder({
        pair: marketPair,
        side,
        type: "market",
        qty: qtyNum.toFixed(2),
        time_in_force: "ioc"
      })
      toast.success(t("statusOrderPlaced", lang))
      await Promise.all([
        refreshOrders().catch(() => { }),
        fetchOrderHistory(true).catch(() => { }),
        refreshMetrics().catch(() => { })
      ])
      refreshAccountSnapshots().catch(() => { })
    } catch (err: any) {
      toast.error(err?.message || "Error")
    }
  }

  const handleClosePosition = async (orderId: string) => {
    try {
      await api.cancelOrder(orderId)
      toast.success("Position closed")
      await Promise.all([
        refreshOrders().catch(() => { }),
        fetchOrderHistory(true).catch(() => { }),
        refreshMetrics().catch(() => { })
      ])
      refreshAccountSnapshots().catch(() => { })
    } catch (err: any) {
      toast.error(err?.message || "Error")
    }
  }

  const closeByScope = async (scope: "all" | "profit" | "loss", emptyMessage: string) => {
    if (bulkClosing) return
    if (!openOrders.some(o => o.status === "filled")) {
      toast.message(emptyMessage)
      return
    }

    setBulkClosing(true)
    let closed = 0
    let failed = 0
    let total = 0
    try {
      const res = await api.closeOrders(scope)
      closed = Number(res?.closed || 0)
      failed = Number(res?.failed || 0)
      total = Number(res?.total || 0)
    } catch (err: any) {
      setBulkClosing(false)
      toast.error(err?.message || "Bulk close failed")
      return
    }

    await Promise.all([
      refreshOrders().catch(() => { }),
      fetchOrderHistory(true).catch(() => { }),
      refreshMetrics().catch(() => { })
    ])
    refreshAccountSnapshots().catch(() => { })

    setBulkClosing(false)
    if (total === 0) {
      toast.message(emptyMessage)
      return
    }
    if (failed > 0) {
      toast.message(`Closed ${closed}, failed ${failed}`)
    } else {
      toast.success(`Closed ${closed} positions`)
    }
  }

  const handleCloseAllPositions = async () => {
    await closeByScope("all", "No open positions to close")
  }

  const handleCloseProfitPositions = async () => {
    await closeByScope("profit", "No profitable positions")
  }

  const handleCloseLossPositions = async () => {
    await closeByScope("loss", "No losing positions")
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
      setProfile(null)
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
    await Promise.all([
      refreshMetrics().catch(() => { }),
      refreshOrders().catch(() => { })
    ])
    refreshAccountSnapshots().catch(() => { })
  }

  const handleUpdateAccountLeverage = async (accountID: string, leverage: number) => {
    await api.updateAccountLeverage({ account_id: accountID, leverage })
    await refreshAccounts(accountID)
    await Promise.all([
      refreshMetrics().catch(() => { }),
      refreshOrders().catch(() => { }),
      fetchOrderHistory(true).catch(() => { })
    ])
    refreshAccountSnapshots().catch(() => { })
  }

  const handleRenameAccount = async (accountID: string, name: string) => {
    await api.updateAccountName({ account_id: accountID, name })
    await refreshAccounts(accountID)
    refreshAccountSnapshots().catch(() => { })
  }

  const handleCreateAccount = async (payload: { plan_id: string; mode: "demo" | "real"; name?: string; is_active?: boolean }) => {
    const created = await api.createAccount(payload)
    const nextID = created?.id || activeAccountId
    if (nextID) {
      setActiveAccountId(nextID)
      setCookie("lv_account_id", nextID)
    }
    await refreshAccounts(nextID)
    await Promise.all([
      refreshMetrics().catch(() => { }),
      refreshOrders().catch(() => { })
    ])
    refreshAccountSnapshots().catch(() => { })
  }

  const handleTopUpDemo = async (amount: string) => {
    await api.faucet({ asset: "USD", amount, reference: "accounts_topup" })
    await refreshAccounts(activeAccountId)
    await refreshMetrics().catch(() => { })
    refreshAccountSnapshots().catch(() => { })
  }

  const handleWithdrawDemo = async (amount: string) => {
    await api.withdraw({ asset: "USD", amount, reference: "accounts_withdraw" })
    await refreshAccounts(activeAccountId)
    await Promise.all([
      refreshMetrics().catch(() => { }),
      refreshOrders().catch(() => { }),
      fetchOrderHistory(true).catch(() => { })
    ])
    refreshAccountSnapshots().catch(() => { })
  }

  if (!token) {
    return (
      <AppAuthGate
        authFlowMode={authFlowMode}
        autoAuthChecked={autoAuthChecked}
        authLoading={authLoading}
        authMode={authMode}
        email={email}
        password={password}
        lang={lang}
        telegramAuthError={telegramAuthError}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onAuthModeChange={setAuthMode}
        onSubmit={handleAuth}
        onRetryTelegram={() => window.location.reload()}
      />
    )
  }



  const isChartView = view === "chart"

  return (
    <div className="app-shell">
      <ConnectionBanner apiBackoff={apiBackoff} />
      <Toaster position="top-right" />

      <main className={`app-main ${isChartView ? "app-main-chart" : "app-main-default"}`}>
        <AppViewRouter
          view={view}
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
          metrics={liveMetrics}
          marketPrice={marketPrice}
          onClose={handleClosePosition}
          onCloseAll={handleCloseAllPositions}
          onCloseProfit={handleCloseProfitPositions}
          onCloseLoss={handleCloseLossPositions}
          bulkClosing={bulkClosing}
          orderHistory={orderHistory}
          historyLoading={historyLoading}
          historyHasMore={historyHasMore}
          onRefreshHistory={() => fetchOrderHistory(true)}
          onLoadMoreHistory={() => fetchOrderHistory(false)}
          accounts={accounts}
          activeAccountId={activeAccountId}
          activeOpenOrdersCount={openOrders.filter(o => o.status === "filled").length}
          liveDataReady={metricsAccountId === activeAccountId && ordersAccountId === activeAccountId}
          snapshots={accountSnapshots}
          onSwitchAccount={handleSwitchAccount}
          onCreateAccount={handleCreateAccount}
          onUpdateAccountLeverage={handleUpdateAccountLeverage}
          onRenameAccount={handleRenameAccount}
          onTopUpDemo={handleTopUpDemo}
          onWithdrawDemo={handleWithdrawDemo}
          onGoTrade={() => setView("chart")}
          profile={profile}
          setLang={setLang}
          setTheme={setTheme}
          onLogout={logout}
          api={api}
          onMetricsUpdate={setMetrics}
          token={token}
          onLoginRequired={() => setView("api")}
          isUnlimitedLeverage={activeTradingAccount?.leverage === 0}
        />
      </main>

      <BottomNav view={view} setView={setView} lang={lang} />
    </div>
  )
}
