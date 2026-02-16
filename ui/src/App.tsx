import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { toast, Toaster } from "sonner"

// Types
import type { AppNotification, MarketNewsEvent, Quote, View, Theme, Lang, MarketConfig, TradingAccount, Order, Metrics, NotificationSettings, SystemNoticeDetails } from "./types"

// Utils
import { setCookie, storedLang, storedTheme, storedBaseUrl, storedToken, storedAccountId, storedTimeframe } from "./utils/cookies"
import { formatNumber, normalizeBaseUrl, toDisplayCandle } from "./utils/format"
import { t } from "./utils/i18n"
import { calcDisplayedOrderProfit } from "./utils/trading"
import { triggerTelegramHaptic } from "./utils/telegramHaptics"
import { useMarketWebSocket } from "./hooks/useMarketWebSocket"

// API
import { createApiClient, type DepositBonusStatus, type KYCStatus, type ProfitRewardStatus, type ReferralStatus, type SignupBonusStatus, type UserProfile } from "./api"

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
const notificationsStorageKey = "lv_notifications_v1"
const notificationSettingsStorageKey = "lv_notification_settings_v1"
const notificationsLimit = 1000
const MAX_KYC_PROOF_BYTES = 10 * 1024 * 1024

const defaultNotificationSettings: NotificationSettings = {
  enabled: true,
  kinds: {
    system: true,
    bonus: true,
    deposit: true,
    news: true,
  },
  haptics: "normal",
}

type PollKey = "metrics" | "orders"
type PollBackoffState = Record<PollKey, { failures: number; retryAt: number }>

function resolveView(): View {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : ""
  if (hash === "positions" || hash === "history" || hash === "accounts" || hash === "notifications" || hash === "profile" || hash === "api" || hash === "faucet") return hash
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

function isCashFlowHistoryOrder(order: Order): boolean {
  const side = String(order.side || "").toLowerCase()
  const type = String(order.type || "").toLowerCase()
  return side === "deposit" || side === "withdraw" || type === "balance"
}

function historyNotificationFromOrder(order: Order, lang: Lang): { kind: AppNotification["kind"]; title: string; message: string } | null {
  const ticket = String(order.ticket || "").toLowerCase()
  const side = String(order.side || "").toLowerCase()
  const type = String(order.type || "").toLowerCase()
  const amount = Number(order.profit || 0)
  const amountAbs = formatNumber(Math.abs(Number.isFinite(amount) ? amount : 0), 2, 2)

  if (isCashFlowHistoryOrder(order)) {
    if (ticket.includes("bxdepstm")) {
      return {
        kind: "system",
        title: t("notifications.negativeBalanceProtection", lang),
        message: t("notifications.systemCoveredAfterStopOut", lang).replace("{amount}", amountAbs),
      }
    }
    if (ticket.includes("bxkyc")) {
      return {
        kind: "bonus",
        title: t("notifications.kycBonusCredited", lang),
        message: t("notifications.kycBonusMessage", lang).replace("{amount}", amountAbs),
      }
    }
    if (ticket.includes("bxrew")) {
      return {
        kind: "bonus",
        title: t("notifications.welcomeBonusCredited", lang),
        message: t("notifications.welcomeBonusMessage", lang).replace("{amount}", amountAbs),
      }
    }
    if (ticket.includes("bxbon")) {
      return {
        kind: "bonus",
        title: t("notifications.depositVoucherBonusCredited", lang),
        message: t("notifications.depositVoucherBonusMessage", lang).replace("{amount}", amountAbs),
      }
    }
    if (ticket.includes("bxprf")) {
      return {
        kind: "bonus",
        title: t("notifications.profitStageRewardCredited", lang),
        message: t("notifications.profitStageRewardMessage", lang).replace("{amount}", amountAbs),
      }
    }
    if (ticket.includes("bxref")) {
      return {
        kind: "bonus",
        title: t("notifications.referralBalancePayout", lang),
        message: t("notifications.referralBalancePayoutMessage", lang).replace("{amount}", amountAbs),
      }
    }
    if (side === "withdraw") {
      return {
        kind: "deposit",
        title: t("notifications.withdrawalPosted", lang),
        message: t("notifications.withdrawalPostedMessage", lang).replace("{amount}", amountAbs),
      }
    }
    return {
      kind: "deposit",
      title: t("notifications.balanceUpdated", lang),
      message: t("notifications.balanceUpdatedMessage", lang).replace("{amount}", amountAbs),
    }
  }

  if (type === "swap") {
    return {
      kind: "news",
      title: t("notifications.swapUpdate", lang),
      message: amount >= 0
        ? t("notifications.swapCredited", lang).replace("{amount}", amountAbs)
        : t("notifications.swapCharged", lang).replace("{amount}", amountAbs),
    }
  }

  return null
}

function newsNotificationFromEvent(event: MarketNewsEvent, lang: Lang): { kind: AppNotification["kind"]; title: string; message: string; statusKey: "live" | "completed" } | null {
  const status = String(event.status || "").toLowerCase()
  const forecast = Number(event.forecast_value || 0)
  const actual = Number(event.actual_value ?? NaN)
  const formatVal = (value: number) => formatNumber(Number.isFinite(value) ? value : 0, 2, 2)

  if (status === "live") {
    return {
      kind: "news",
      title: t("notifications.newsStartedTitle", lang).replace("{title}", event.title),
      message: t("notifications.newsStartedMessage", lang).replace("{forecast}", formatVal(forecast)),
      statusKey: "live",
    }
  }

  if (status === "completed") {
    const tone = Number.isFinite(actual)
      ? (actual > forecast ? t("notifications.toneAbove", lang) : actual < forecast ? t("notifications.toneBelow", lang) : t("notifications.toneInLine", lang))
      : t("notifications.toneRelative", lang)
    return {
      kind: "news",
      title: t("notifications.newsResultTitle", lang).replace("{title}", event.title),
      message: t("notifications.newsResultMessage", lang)
        .replace("{actual}", formatVal(actual))
        .replace("{tone}", tone)
        .replace("{forecast}", formatVal(forecast)),
      statusKey: "completed",
    }
  }

  return null
}

function readStoredNotifications(): AppNotification[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(notificationsStorageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item: any) => item && typeof item === "object")
      .map((item: any) => ({
        id: String(item.id || ""),
        kind: item.kind === "system" || item.kind === "bonus" || item.kind === "deposit" || item.kind === "news" ? item.kind : "news",
        title: String(item.title || ""),
        message: String(item.message || ""),
        created_at: String(item.created_at || ""),
        read: Boolean(item.read),
        dedupe_key: item.dedupe_key ? String(item.dedupe_key) : undefined,
        account_id: item.account_id ? String(item.account_id) : undefined,
        action: item.action && typeof item.action === "object" && String(item.action.type || "") === "open_profit_stages"
          ? {
            type: "open_profit_stages",
            label: item.action.label ? String(item.action.label) : undefined,
          }
          : undefined,
        details: item.details && typeof item.details === "object"
          ? {
            kind: item.details.kind ? String(item.details.kind) : undefined,
            reason: item.details.reason ? String(item.details.reason) : undefined,
            triggered_at: item.details.triggered_at ? String(item.details.triggered_at) : undefined,
            threshold_percent: item.details.threshold_percent ? String(item.details.threshold_percent) : undefined,
            balance_before: item.details.balance_before ? String(item.details.balance_before) : undefined,
            balance_after: item.details.balance_after ? String(item.details.balance_after) : undefined,
            equity_before: item.details.equity_before ? String(item.details.equity_before) : undefined,
            equity_after: item.details.equity_after ? String(item.details.equity_after) : undefined,
            margin_before: item.details.margin_before ? String(item.details.margin_before) : undefined,
            margin_after: item.details.margin_after ? String(item.details.margin_after) : undefined,
            margin_level_before: item.details.margin_level_before ? String(item.details.margin_level_before) : undefined,
            margin_level_after: item.details.margin_level_after ? String(item.details.margin_level_after) : undefined,
            closed_orders: Number(item.details.closed_orders || 0),
            total_loss: item.details.total_loss ? String(item.details.total_loss) : undefined,
            total_loss_estimated: Boolean(item.details.total_loss_estimated),
          } satisfies SystemNoticeDetails
          : undefined,
      }))
      .filter((item: AppNotification) => item.id && item.title && item.message)
      .slice(0, notificationsLimit)
  } catch {
    return []
  }
}

function readStoredNotificationSettings(): NotificationSettings {
  if (typeof window === "undefined") return defaultNotificationSettings
  try {
    const raw = window.localStorage.getItem(notificationSettingsStorageKey)
    if (!raw) return defaultNotificationSettings
    const parsed = JSON.parse(raw)
    const enabled = parsed?.enabled
    const kinds = parsed?.kinds || {}
    return {
      enabled: typeof enabled === "boolean" ? enabled : defaultNotificationSettings.enabled,
      kinds: {
        system: typeof kinds.system === "boolean" ? kinds.system : defaultNotificationSettings.kinds.system,
        bonus: typeof kinds.bonus === "boolean" ? kinds.bonus : defaultNotificationSettings.kinds.bonus,
        deposit: typeof kinds.deposit === "boolean" ? kinds.deposit : defaultNotificationSettings.kinds.deposit,
        news: typeof kinds.news === "boolean" ? kinds.news : defaultNotificationSettings.kinds.news,
      },
      haptics: parsed?.haptics === "frequent" || parsed?.haptics === "normal" || parsed?.haptics === "off"
        ? parsed.haptics
        : defaultNotificationSettings.haptics,
    }
  } catch {
    return defaultNotificationSettings
  }
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
  const [telegramBotNotificationsBusy, setTelegramBotNotificationsBusy] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [signupBonus, setSignupBonus] = useState<SignupBonusStatus | null>(null)
  const [depositBonus, setDepositBonus] = useState<DepositBonusStatus | null>(null)
  const [kycStatus, setKycStatus] = useState<KYCStatus | null>(null)
  const [referralStatus, setReferralStatus] = useState<ReferralStatus | null>(null)
  const [profitRewardStatus, setProfitRewardStatus] = useState<ProfitRewardStatus | null>(null)
  const [newsUpcoming, setNewsUpcoming] = useState<MarketNewsEvent[]>([])
  const [newsRecent, setNewsRecent] = useState<MarketNewsEvent[]>([])
  const [notifications, setNotifications] = useState<AppNotification[]>(readStoredNotifications)
  const [openProfitStagesSignal, setOpenProfitStagesSignal] = useState(0)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(readStoredNotificationSettings)
  const telegramRedirectedRef = useRef(false)
  const telegramWriteAccessRequestedRef = useRef(false)
  const telegramMandatoryCheckDoneRef = useRef(false)
  const signupBonusStateRef = useRef<{ canClaim: boolean; claimed: boolean }>({ canClaim: false, claimed: false })
  const depositPendingByAccountRef = useRef<Record<string, { initialized: boolean; pending: number }>>({})

  const logout = useCallback(() => {
    setToken("")
    setProfile(null)
    setTelegramAuthError("")
    setTelegramBotNotificationsBusy(false)
    telegramRedirectedRef.current = false
    telegramWriteAccessRequestedRef.current = false
    telegramMandatoryCheckDoneRef.current = false
    setActiveAccountId("")
    setAccounts([])
    setOpenOrders([])
    setOrderHistory([])
    setSignupBonus(null)
    setDepositBonus(null)
    setKycStatus(null)
    setReferralStatus(null)
    setProfitRewardStatus(null)
    setNewsUpcoming([])
    setNewsRecent([])
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
    signupBonusStateRef.current = { canClaim: false, claimed: false }
    depositPendingByAccountRef.current = {}
    setNotifications([])
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(notificationsStorageKey)
    }
  }, [])

  const addNotification = useCallback((payload: {
    kind: AppNotification["kind"]
    title: string
    message: string
    accountID?: string
    dedupeKey?: string
    action?: AppNotification["action"]
    details?: SystemNoticeDetails
  }) => {
    const title = String(payload.title || "").trim()
    const message = String(payload.message || "").trim()
    if (!title || !message) return
    if (!notificationSettings.enabled) return
    if (!notificationSettings.kinds[payload.kind]) return

    setNotifications(prev => {
      if (payload.dedupeKey && prev.some(item => item.dedupe_key === payload.dedupeKey)) {
        return prev
      }
      const nextItem: AppNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        kind: payload.kind,
        title,
        message,
        created_at: new Date().toISOString(),
        read: false,
        dedupe_key: payload.dedupeKey,
        account_id: payload.accountID,
        action: payload.action,
        details: payload.details,
      }
      return [nextItem, ...prev].slice(0, notificationsLimit)
    })
  }, [notificationSettings])

  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => prev.map(item => (item.read ? item : { ...item, read: true })))
  }, [])

  const markNotificationRead = useCallback((notificationID: string) => {
    const id = String(notificationID || "").trim()
    if (!id) return
    setNotifications(prev => {
      let changed = false
      const next = prev.map(item => {
        if (item.id !== id || item.read) return item
        changed = true
        return { ...item, read: true }
      })
      return changed ? next : prev
    })
  }, [])

  const handleNotificationAction = useCallback((notificationID: string, action: NonNullable<AppNotification["action"]>) => {
    if (!action) return
    markNotificationRead(notificationID)
    if (action.type === "open_profit_stages") {
      setView("profile")
      setOpenProfitStagesSignal(prev => prev + 1)
    }
  }, [markNotificationRead])

  const hasUnreadNotifications = useMemo(() => notifications.some(item => !item.read), [notifications])

  // Migrate legacy notifications where raw i18n keys were persisted as plain text.
  useEffect(() => {
    setNotifications(prev => {
      let changed = false
      const next = prev.map(item => {
        let title = item.title
        let message = item.message

        if (title.startsWith("notifications.")) {
          const translated = t(title, lang)
          if (translated !== title) {
            title = translated
            changed = true
          }
        }

        if (message.startsWith("notifications.")) {
          let translated = t(message, lang)
          if (message === "notifications.profitStageReadyMessage") {
            const stageMatch = String(item.dedupe_key || "").match(/profit_stage_ready:[^:]+:(\d+)/)
            const stageNo = stageMatch ? Number(stageMatch[1]) : NaN
            const stage = Number.isFinite(stageNo)
              ? (profitRewardStatus?.stages || []).find(s => Number(s.stage_no) === stageNo)
              : undefined
            const reward = Number(stage?.reward_usd || 0)
            translated = translated
              .replace("{stage}", Number.isFinite(stageNo) ? String(stageNo) : "—")
              .replace("{amount}", formatNumber(reward, 2, 2))
          } else {
            translated = translated.replace(/\{[^}]+\}/g, "")
          }

          if (translated !== message) {
            message = translated
            changed = true
          }
        }

        if (title !== item.title || message !== item.message) {
          return { ...item, title, message }
        }
        return item
      })
      return changed ? next : prev
    })
  }, [lang, profitRewardStatus])

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

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(notificationsStorageKey, JSON.stringify(notifications.slice(0, notificationsLimit)))
    } catch {
      // ignore localStorage write errors
    }
  }, [notifications])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(notificationSettingsStorageKey, JSON.stringify(notificationSettings))
    } catch {
      // ignore localStorage write errors
    }
  }, [notificationSettings])

  useEffect(() => {
    if (notificationSettings.haptics !== "frequent") return
    const onPointerUp = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      const interactive = target.closest("button, a, [role='button'], .bottom-nav-btn")
      if (!interactive) return
      triggerTelegramHaptic("tap", "frequent")
    }
    document.addEventListener("pointerup", onPointerUp, true)
    return () => {
      document.removeEventListener("pointerup", onPointerUp, true)
    }
  }, [notificationSettings.haptics])

  // Memoized API client (prevents recreation on every render = fixes lag)
  const normalizedBaseUrl = useMemo(() => normalizeBaseUrl(baseUrl), [baseUrl])
  const api = useMemo(() => createApiClient({ baseUrl: normalizedBaseUrl, token, activeAccountId }, logout), [normalizedBaseUrl, token, activeAccountId, logout])
  const authApi = useMemo(() => createApiClient({ baseUrl: normalizedBaseUrl, token }, logout), [normalizedBaseUrl, token, logout])
  const publicApi = useMemo(() => createApiClient({ baseUrl: normalizedBaseUrl, token: "" }), [normalizedBaseUrl])
  const telegramMiniApp = isTelegramMiniApp()
  const telegramModeActive = authFlowMode === "production" && telegramMiniApp
  const telegramBotSettingsVisible = authFlowMode === "production"
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
      const details = m?.system_notice_details && typeof m.system_notice_details === "object"
        ? m.system_notice_details
        : undefined
      const detailKey = details
        ? [
          details.kind || "",
          details.triggered_at || "",
          details.closed_orders || "",
          details.total_loss || "",
        ].join(":")
        : ""
      const currentKey = detailKey ? `${notice}:${detailKey}` : notice
      const prevNotice = systemNoticeByAccountRef.current[requestAccountId] || ""
      if (prevNotice !== currentKey) {
        toast.message(notice)
        addNotification({
          kind: "system",
          title: details?.kind === "stop_out"
            ? t("notifications.marginCallStopOut", lang)
            : details?.kind === "margin_call"
              ? t("notifications.marginCallWarning", lang)
              : t("notifications.systemNotice", lang),
          message: notice,
          accountID: requestAccountId,
          dedupeKey: detailKey ? `system:${requestAccountId}:${detailKey}` : `system:${requestAccountId}:${notice}`,
          details,
        })
        systemNoticeByAccountRef.current[requestAccountId] = currentKey
        if (notice.includes("changed leverage to 1:2000")) {
          setAccounts(prev => prev.map(acc => (
            acc.id === requestAccountId ? { ...acc, leverage: 2000 } : acc
          )))
        }
      }
    }
  }, [api, activeAccountId, addNotification])

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

  const refreshSignupBonus = useCallback(async () => {
    if (!token) {
      setSignupBonus(null)
      return
    }
    const requestAccountId = activeAccountId
    try {
      const status = await api.signupBonusStatus()
      if (activeAccountIdRef.current !== requestAccountId) return
      setSignupBonus(status || null)

      const canClaim = Boolean(status?.can_claim && !status?.claimed)
      const claimed = Boolean(status?.claimed)
      const prev = signupBonusStateRef.current

      if (canClaim && !prev.canClaim) {
        const amount = Number(status?.amount || 0)
        addNotification({
          kind: "bonus",
          title: t("notifications.welcomeBonusAvailable", lang),
          message: t("notifications.welcomeBonusAvailableMessage", lang).replace("{amount}", formatNumber(amount, 2, 2)),
          accountID: requestAccountId,
          dedupeKey: `signup:available:${requestAccountId}:${amount}`,
        })
      }
      signupBonusStateRef.current = { canClaim, claimed }
    } catch {
      setSignupBonus(null)
    }
  }, [api, token, activeAccountId, addNotification])

  const refreshDepositBonus = useCallback(async () => {
    if (!token) {
      setDepositBonus(null)
      return
    }
    const requestAccountId = activeAccountId
    try {
      const status = await api.depositBonusStatus()
      if (activeAccountIdRef.current !== requestAccountId) return
      setDepositBonus(status || null)

      const pending = Number(status?.pending_count || 0)
      const accountKey = requestAccountId || "__global__"
      const prevState = depositPendingByAccountRef.current[accountKey] || { initialized: false, pending: 0 }
      if (!prevState.initialized) {
        depositPendingByAccountRef.current[accountKey] = { initialized: true, pending }
        return
      }

      if (pending > prevState.pending) {
        addNotification({
          kind: "deposit",
          title: t("notifications.depositRequestPending", lang),
          message: t("notifications.depositRequestPendingMessage", lang).replace("{count}", String(pending)),
          accountID: requestAccountId,
        })
      } else if (pending < prevState.pending) {
        addNotification({
          kind: "deposit",
          title: t("notifications.depositRequestReviewed", lang),
          message: t("notifications.depositRequestReviewedMessage", lang),
          accountID: requestAccountId,
        })
      }

      depositPendingByAccountRef.current[accountKey] = { initialized: true, pending }
    } catch {
      setDepositBonus(null)
    }
  }, [api, token, activeAccountId, addNotification])

  const refreshKYCStatus = useCallback(async () => {
    if (!token) {
      setKycStatus(null)
      return
    }
    try {
      const status = await api.kycStatus()
      setKycStatus(status || null)
    } catch {
      setKycStatus(null)
    }
  }, [api, token])

  const refreshReferralStatus = useCallback(async () => {
    if (!token) {
      setReferralStatus(null)
      return
    }
    try {
      const status = await api.referralStatus()
      setReferralStatus(status || null)
    } catch {
      setReferralStatus(null)
    }
  }, [api, token])

  const refreshProfitRewardStatus = useCallback(async () => {
    if (!token) {
      setProfitRewardStatus(null)
      return
    }
    try {
      const status = await api.profitRewardStatus()
      setProfitRewardStatus(status || null)
      const stages = Array.isArray(status?.stages) ? status.stages : []
      const trackKey = String(status?.track || "profit_track")
      for (const stage of stages) {
        if (!stage?.can_claim || stage?.claimed) continue
        const stageNo = Number(stage.stage_no || 0)
        if (!Number.isFinite(stageNo) || stageNo <= 0) continue
        const reward = Number(stage.reward_usd || 0)
        addNotification({
          kind: "bonus",
          title: t("notifications.profitStageReadyToClaim", lang),
          message: t("notifications.profitStageReadyMessage", lang)
            .replace("{stage}", String(stageNo))
            .replace("{amount}", formatNumber(reward, 2, 2)),
          accountID: activeAccountId,
          dedupeKey: `profit_stage_ready:${trackKey}:${stageNo}`,
          action: {
            type: "open_profit_stages",
            label: t("notifications.openRewards", lang),
          },
        })
      }
    } catch {
      setProfitRewardStatus(null)
    }
  }, [api, token, activeAccountId, addNotification, lang])

  const refreshNewsUpcoming = useCallback(async () => {
    if (!token) {
      setNewsUpcoming([])
      return
    }
    try {
      const items = await api.newsUpcoming({ pair: marketPair, limit: 3 })
      setNewsUpcoming(Array.isArray(items) ? items : [])
    } catch {
      setNewsUpcoming([])
    }
  }, [api, token, marketPair])

  const refreshNewsRecent = useCallback(async () => {
    if (!token) {
      setNewsRecent([])
      return
    }
    try {
      const items = await api.newsRecent({ pair: marketPair, limit: 20 })
      setNewsRecent(Array.isArray(items) ? items : [])
    } catch {
      setNewsRecent([])
    }
  }, [api, token, marketPair])

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
      setSignupBonus(null)
      setDepositBonus(null)
      setKycStatus(null)
      setReferralStatus(null)
      setProfitRewardStatus(null)
      setNewsUpcoming([])
      setNewsRecent([])
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
    if (!token) {
      setSignupBonus(null)
      setDepositBonus(null)
      setKycStatus(null)
      setReferralStatus(null)
      setProfitRewardStatus(null)
      setNewsUpcoming([])
      setNewsRecent([])
      return
    }
    Promise.all([
      refreshSignupBonus().catch(() => { }),
      refreshDepositBonus().catch(() => { }),
      refreshKYCStatus().catch(() => { }),
      refreshReferralStatus().catch(() => { }),
      refreshProfitRewardStatus().catch(() => { })
    ]).catch(() => { })
  }, [token, activeAccountId, refreshSignupBonus, refreshDepositBonus, refreshKYCStatus, refreshReferralStatus, refreshProfitRewardStatus])

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
        setTelegramAuthError(err?.message || t("auth.telegramFailed", lang))
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

  const refreshProfile = useCallback(async () => {
    if (!token) {
      setProfile(null)
      return
    }
    try {
      const user = await authApi.me()
      setProfile(user || null)
    } catch {
      // ignore profile refresh errors
    }
  }, [token, authApi])

  const requestTelegramWriteAccess = useCallback(async (): Promise<boolean> => {
    if (!telegramModeActive || !token) return false
    const requestWriteAccess = window.Telegram?.WebApp?.requestWriteAccess
    if (typeof requestWriteAccess !== "function") {
      setTelegramAuthError(t("settings.notifications.telegramBotUnsupported", lang))
      return false
    }
    return await new Promise<boolean>((resolve) => {
      try {
        requestWriteAccess((allowed) => resolve(Boolean(allowed)))
      } catch {
        resolve(false)
      }
    })
  }, [telegramModeActive, token, lang])

  useEffect(() => {
    refreshProfile().catch(() => { })
  }, [refreshProfile])

  useEffect(() => {
    if (!token || view !== "profile") return
    refreshProfile().catch(() => { })
  }, [token, view, refreshProfile])

  useEffect(() => {
    if (telegramRedirectedRef.current) return
    if (authFlowMode !== "production") return
    if (!token || !isTelegramMiniApp()) return
    setView("accounts")
    telegramRedirectedRef.current = true
  }, [token, authFlowMode])

  useEffect(() => {
    if (!telegramModeActive) return
    if (!token || !profile) return
    if (telegramMandatoryCheckDoneRef.current) return
    telegramMandatoryCheckDoneRef.current = true
    if (profile.telegram_write_access) return
    if (telegramWriteAccessRequestedRef.current) return

    telegramWriteAccessRequestedRef.current = true
    let cancelled = false

    ; (async () => {
      const allowed = await requestTelegramWriteAccess()
      if (cancelled) return
      await authApi.setTelegramWriteAccess(allowed).catch(() => { })
      if (cancelled) return
      setProfile(prev => prev ? { ...prev, telegram_write_access: allowed } : prev)
      if (!allowed) {
        setTelegramAuthError(t("auth.telegramWriteDeniedClosing", lang))
        window.setTimeout(() => {
          if (!cancelled) window.Telegram?.WebApp?.close?.()
        }, 320)
      } else {
        setTelegramAuthError("")
      }
    })()

    return () => {
      cancelled = true
    }
  }, [telegramModeActive, token, profile, requestTelegramWriteAccess, authApi, lang])

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

  useEffect(() => {
    if (!token || !activeAccountId) return
    if (orderHistory.length === 0) return

    const accountKey = activeAccountId
    const inChronologicalOrder = [...orderHistory].sort((a, b) => {
      const la = Date.parse(String(a.close_time || a.created_at || "")) || 0
      const lb = Date.parse(String(b.close_time || b.created_at || "")) || 0
      return la - lb
    })

    setNotifications(prev => {
      const dedupe = new Set<string>()
      for (const item of prev) {
        if (item.dedupe_key) dedupe.add(item.dedupe_key)
      }

      const merged = [...prev]
      for (const order of inChronologicalOrder) {
        const next = historyNotificationFromOrder(order, lang)
        if (!next) continue
        if (!notificationSettings.enabled || !notificationSettings.kinds[next.kind]) continue
        const dedupeKey = `history:${accountKey}:${order.id}`
        if (dedupe.has(dedupeKey)) continue
        dedupe.add(dedupeKey)
        const createdAt = String(order.close_time || order.created_at || new Date().toISOString())
        merged.unshift({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${order.id}`,
          kind: next.kind,
          title: next.title,
          message: next.message,
          created_at: createdAt,
          read: false,
          dedupe_key: dedupeKey,
          account_id: accountKey,
        })
      }

      if (merged.length > notificationsLimit) {
        return merged.slice(0, notificationsLimit)
      }
      return merged
    })
  }, [token, activeAccountId, orderHistory, lang, notificationSettings])

  // Prime history once per active account so notification sync also works outside History page.
  useEffect(() => {
    if (!token || !activeAccountId) return
    if (historyAccountId === activeAccountId && orderHistory.length > 0) return
    fetchOrderHistory(true).catch(() => { })
  }, [token, activeAccountId, historyAccountId, orderHistory.length, fetchOrderHistory])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (cancelled) return
      await Promise.all([
        refreshNewsUpcoming().catch(() => { }),
        refreshNewsRecent().catch(() => { }),
      ])
      if (!cancelled) {
        timer = setTimeout(poll, 15000)
      }
    }

    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [token, refreshNewsUpcoming, refreshNewsRecent])

  useEffect(() => {
    if (!token || newsRecent.length === 0) return
    const ordered = [...newsRecent].sort((a, b) => {
      const ta = Date.parse(String(a.updated_at || a.scheduled_at || "")) || 0
      const tb = Date.parse(String(b.updated_at || b.scheduled_at || "")) || 0
      return ta - tb
    })
    for (const item of ordered) {
      const next = newsNotificationFromEvent(item, lang)
      if (!next) continue
      addNotification({
        kind: next.kind,
        title: next.title,
        message: next.message,
        dedupeKey: `news:${item.id}:${next.statusKey}`,
      })
    }
  }, [token, newsRecent, addNotification, lang])

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
      toast.error(t("orders.selectActiveAccountFirst", lang))
      return
    }
    if (side === "buy") {
      const usdBalance = Number(activeTradingAccount.balance || 0)
      if (!Number.isFinite(usdBalance) || usdBalance <= 0) {
        toast.error(activeTradingAccount.mode === "demo"
          ? t("orders.demoBalanceZero", lang)
          : t("orders.realBalanceZero", lang))
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
      toast.error(err?.message || t("common.error", lang))
    }
  }

  const handleClosePosition = async (orderId: string) => {
    try {
      await api.cancelOrder(orderId)
      toast.success(t("orders.positionClosed", lang))
      await Promise.all([
        refreshOrders().catch(() => { }),
        fetchOrderHistory(true).catch(() => { }),
        refreshMetrics().catch(() => { }),
        refreshProfitRewardStatus().catch(() => { })
      ])
      refreshAccountSnapshots().catch(() => { })
    } catch (err: any) {
      toast.error(err?.message || t("common.error", lang))
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
      toast.error(err?.message || t("orders.bulkCloseFailed", lang))
      return
    }

    await Promise.all([
      refreshOrders().catch(() => { }),
      fetchOrderHistory(true).catch(() => { }),
      refreshMetrics().catch(() => { }),
      refreshProfitRewardStatus().catch(() => { })
    ])
    refreshAccountSnapshots().catch(() => { })

    setBulkClosing(false)
    if (total === 0) {
      toast.message(emptyMessage)
      return
    }
    if (failed > 0) {
      toast.message(t("orders.closedFailed", lang).replace("{closed}", String(closed)).replace("{failed}", String(failed)))
    } else {
      toast.success(t("orders.closedPositions", lang).replace("{count}", String(closed)))
    }
  }

  const handleCloseAllPositions = async () => {
    await closeByScope("all", t("orders.noOpenToClose", lang))
  }

  const handleCloseProfitPositions = async () => {
    await closeByScope("profit", t("orders.noProfitable", lang))
  }

  const handleCloseLossPositions = async () => {
    await closeByScope("loss", t("orders.noLosing", lang))
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      toast.error(t("auth.enterEmailPassword", lang))
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
      toast.success(authMode === "login" ? t("auth.loggedIn", lang) : t("auth.registered", lang))
    } catch (err: any) {
      toast.error(err?.message || t("auth.error", lang))
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
    refreshSignupBonus().catch(() => { })
    refreshDepositBonus().catch(() => { })
    refreshKYCStatus().catch(() => { })
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
    refreshSignupBonus().catch(() => { })
    refreshDepositBonus().catch(() => { })
    refreshKYCStatus().catch(() => { })
  }

  const handleClaimSignupBonus = async () => {
    const claimed = await api.claimSignupBonus({ accept_terms: true })
    setSignupBonus(claimed || null)
    if (claimed) {
      addNotification({
        kind: "bonus",
        title: t("notifications.welcomeBonusCredited", lang),
        message: t("notifications.welcomeBonusCreditedMessage", lang).replace("{amount}", formatNumber(Number(claimed.amount || 0), 2, 2)),
        accountID: activeAccountId,
        dedupeKey: `signup:claimed:${claimed.claimed_at || claimed.trading_account_id || activeAccountId}`,
      })
    }
    await refreshAccounts(activeAccountId || claimed?.trading_account_id || "")
    await Promise.all([
      refreshMetrics().catch(() => { }),
      refreshOrders().catch(() => { }),
      fetchOrderHistory(true).catch(() => { })
    ])
    refreshAccountSnapshots().catch(() => { })
    refreshSignupBonus().catch(() => { })
    refreshDepositBonus().catch(() => { })
    refreshKYCStatus().catch(() => { })
  }

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const out = String(reader.result || "")
      const comma = out.indexOf(",")
      if (comma >= 0) resolve(out.slice(comma + 1))
      else resolve(out)
    }
    reader.onerror = () => reject(new Error(t("kyc.error.readProofFailed", lang)))
    reader.readAsDataURL(file)
  })

  const loadImageFromFile = (file: File): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(t("kyc.error.decodeImageFailed", lang).replace("{file}", file.name)))
    }
    image.src = url
  })

  const canvasToJpegBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
    new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error(t("kyc.error.buildImageFailed", lang)))
          return
        }
        resolve(blob)
      }, "image/jpeg", quality)
    })

  const buildKYCCombinedProof = async (frontFile: File, backFile: File): Promise<File> => {
    const [frontImage, backImage] = await Promise.all([
      loadImageFromFile(frontFile),
      loadImageFromFile(backFile),
    ])

    const sourceWidth = Math.max(frontImage.naturalWidth || frontImage.width, backImage.naturalWidth || backImage.width, 900)
    const targetWidth = Math.min(1600, sourceWidth)
    const pad = Math.round(targetWidth * 0.04)
    const gap = Math.round(targetWidth * 0.03)

    const frontScale = targetWidth / Math.max(1, frontImage.naturalWidth || frontImage.width)
    const backScale = targetWidth / Math.max(1, backImage.naturalWidth || backImage.width)
    const frontHeight = Math.max(1, Math.round((frontImage.naturalHeight || frontImage.height) * frontScale))
    const backHeight = Math.max(1, Math.round((backImage.naturalHeight || backImage.height) * backScale))

    const canvas = document.createElement("canvas")
    canvas.width = targetWidth + pad * 2
    canvas.height = frontHeight + backHeight + gap + pad * 2

    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error(t("kyc.error.prepareCanvasFailed", lang))

    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(frontImage, pad, pad, targetWidth, frontHeight)
    ctx.drawImage(backImage, pad, pad + frontHeight + gap, targetWidth, backHeight)

    for (const quality of [0.9, 0.82, 0.74, 0.66]) {
      const blob = await canvasToJpegBlob(canvas, quality)
      if (blob.size <= MAX_KYC_PROOF_BYTES) {
        return new File([blob], `kyc-${Date.now()}-front-back.jpg`, { type: "image/jpeg" })
      }
    }
    throw new Error(t("kyc.error.imagesTooLarge", lang))
  }

  const handleRequestRealDeposit = async (payload: {
    amountUSD: string
    voucherKind: "none" | "gold" | "diamond"
    methodID: string
    proofFile: File
  }) => {
    const proofBase64 = await fileToBase64(payload.proofFile)
    await api.requestRealDeposit({
      amount_usd: payload.amountUSD,
      voucher_kind: payload.voucherKind,
      method_id: payload.methodID,
      proof_file_name: payload.proofFile.name,
      proof_mime_type: payload.proofFile.type || "application/octet-stream",
      proof_base64: proofBase64,
    })
    addNotification({
      kind: "deposit",
      title: t("notifications.depositRequestSubmitted", lang),
      message: t("notifications.depositRequestSubmittedMessage", lang).replace("{amount}", formatNumber(Number(payload.amountUSD || 0), 2, 2)),
      accountID: activeAccountId,
    })
    await Promise.all([
      refreshDepositBonus().catch(() => { }),
      fetchOrderHistory(true).catch(() => { }),
    ])
  }

  const handleRequestKYC = async (payload: {
    documentType: "passport" | "id_card" | "driver_license" | "other"
    fullName: string
    documentNumber: string
    residenceAddress: string
    frontProofFile: File
    backProofFile: File
  }) => {
    const mergedProof = await buildKYCCombinedProof(payload.frontProofFile, payload.backProofFile)
    const proofBase64 = await fileToBase64(mergedProof)
    await api.requestKYC({
      document_type: payload.documentType,
      full_name: payload.fullName,
      document_number: payload.documentNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
      residence_address: payload.residenceAddress,
      proof_file_name: mergedProof.name,
      proof_mime_type: mergedProof.type || "application/octet-stream",
      proof_base64: proofBase64,
    })
    addNotification({
      kind: "news",
      title: t("notifications.kycSubmitted", lang),
      message: t("notifications.kycSubmittedMessage", lang),
      accountID: activeAccountId,
    })
    await Promise.all([
      refreshKYCStatus().catch(() => { }),
      fetchOrderHistory(true).catch(() => { }),
    ])
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

  const handleReferralWithdraw = async (amountUSD?: string) => {
    const payload = amountUSD && amountUSD.trim()
      ? { amount_usd: amountUSD.trim() }
      : undefined
    const res = await api.referralWithdraw(payload)
    addNotification({
      kind: "bonus",
      title: t("notifications.referralWithdrawalCompleted", lang),
      message: t("notifications.referralWithdrawalCompletedMessage", lang).replace("{amount}", formatNumber(Number(res?.amount_usd || 0), 2, 2)),
      accountID: activeAccountId,
      dedupeKey: `ref:withdraw:${Date.now()}`,
    })
    await Promise.all([
      refreshAccounts(activeAccountId).catch(() => { }),
      refreshMetrics().catch(() => { }),
      refreshOrders().catch(() => { }),
      fetchOrderHistory(true).catch(() => { }),
      refreshReferralStatus().catch(() => { }),
    ])
    refreshAccountSnapshots().catch(() => { })
  }

  const handleClaimProfitReward = async (stageNo: number, tradingAccountID: string) => {
    const res = await api.claimProfitReward({ stage_no: stageNo, trading_account_id: tradingAccountID })
    const reward = Number(res?.reward_usd || 0)
    addNotification({
      kind: "bonus",
      title: t("notifications.profitStageRewardCredited", lang),
      message: t("notifications.profitStageRewardCreditedMessage", lang).replace("{amount}", formatNumber(reward, 2, 2)),
      accountID: tradingAccountID || activeAccountId,
      dedupeKey: `profit_reward:${res?.stage_no || stageNo}:${res?.claimed_at || Date.now()}`,
    })
    await Promise.all([
      refreshProfitRewardStatus().catch(() => { }),
      refreshAccounts(tradingAccountID || activeAccountId).catch(() => { }),
      refreshMetrics().catch(() => { }),
      refreshOrders().catch(() => { }),
      fetchOrderHistory(true).catch(() => { }),
    ])
    refreshAccountSnapshots().catch(() => { })
  }

  const handleToggleTelegramBotNotifications = useCallback(async (enabled: boolean) => {
    if (!token) return
    if (!telegramModeActive) {
      toast.error(t("auth.openFromTelegram", lang))
      return
    }
    if (telegramBotNotificationsBusy) return

    setTelegramBotNotificationsBusy(true)
    try {
      if (enabled && !profile?.telegram_write_access) {
        telegramWriteAccessRequestedRef.current = false
        const allowed = await requestTelegramWriteAccess()
        await authApi.setTelegramWriteAccess(Boolean(allowed)).catch(() => { })
        if (!allowed) {
          setProfile(prev => prev ? { ...prev, telegram_write_access: false } : prev)
          toast.error(t("settings.notifications.telegramBotBlocked", lang))
          return
        }
        setProfile(prev => prev ? { ...prev, telegram_write_access: true } : prev)
      }

      await authApi.setTelegramNotificationsEnabled(enabled)
      setProfile(prev => prev ? { ...prev, telegram_notifications_enabled: enabled } : prev)
      toast.success(enabled ? t("settings.notifications.state.on", lang) : t("settings.notifications.state.off", lang))
      refreshProfile().catch(() => { })
    } catch (err: any) {
      toast.error(err?.message || t("common.error", lang))
    } finally {
      setTelegramBotNotificationsBusy(false)
    }
  }, [
    telegramModeActive,
    token,
    telegramBotNotificationsBusy,
    profile?.telegram_write_access,
    requestTelegramWriteAccess,
    authApi,
    lang,
    refreshProfile,
  ])

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
          signupBonus={signupBonus}
          depositBonus={depositBonus}
          onClaimSignupBonus={handleClaimSignupBonus}
          onRequestRealDeposit={handleRequestRealDeposit}
          newsUpcoming={newsUpcoming}
          activeAccount={activeTradingAccount}
          kycStatus={kycStatus}
          onRequestKYC={handleRequestKYC}
          referralStatus={referralStatus}
          onReferralWithdraw={handleReferralWithdraw}
          onRefreshReferral={refreshReferralStatus}
          profitRewardStatus={profitRewardStatus}
          onRefreshProfitReward={refreshProfitRewardStatus}
          onClaimProfitReward={handleClaimProfitReward}
          onGoTrade={() => setView("chart")}
          hasUnreadNotifications={hasUnreadNotifications}
          onOpenNotifications={() => setView("notifications")}
          notifications={notifications}
          onBackFromHistory={() => setView("accounts")}
          onBackFromNotifications={() => setView("accounts")}
          onMarkAllNotificationsRead={markAllNotificationsRead}
          onNotificationClick={markNotificationRead}
          onNotificationAction={handleNotificationAction}
          profile={profile}
          setLang={setLang}
          setTheme={setTheme}
          notificationSettings={notificationSettings}
          setNotificationSettings={setNotificationSettings}
          telegramBotSwitchVisible={telegramBotSettingsVisible}
          telegramBotNotificationsEnabled={Boolean(profile?.telegram_notifications_enabled)}
          telegramBotNotificationsBusy={telegramBotNotificationsBusy}
          telegramWriteAccess={Boolean(profile?.telegram_write_access)}
          onToggleTelegramBotNotifications={handleToggleTelegramBotNotifications}
          openProfitStagesSignal={openProfitStagesSignal}
          onLogout={logout}
          api={api}
          onMetricsUpdate={setMetrics}
          token={token}
          onLoginRequired={() => setView("api")}
          isUnlimitedLeverage={activeTradingAccount?.leverage === 0}
        />
      </main>

      <BottomNav view={view} setView={setView} lang={lang} hapticMode={notificationSettings.haptics} />
    </div>
  )
}
