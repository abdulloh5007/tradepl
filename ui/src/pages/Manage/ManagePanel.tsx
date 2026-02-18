import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { LogOut, Sun, Moon, Settings, AlertCircle, X, Target, ShieldAlert, Shield, Activity, CreditCard, Database, LifeBuoy } from "lucide-react"
import Skeleton from "../../components/Skeleton"

// Components
import SessionsCard from "../../components/admin/SessionsCard"
import VolatilityCard from "../../components/admin/VolatilityCard"
import TrendCard from "../../components/admin/TrendCard"
import PriceEventsCard from "../../components/admin/PriceEventsCard"
import EconomicNewsCard from "../../components/admin/EconomicNewsCard"
import PanelAdmins from "../../components/admin/PanelAdmins"
import TradingRiskCard from "../../components/admin/TradingRiskCard"
import TradingPairsCard from "../../components/admin/TradingPairsCard"
import SystemHealthCard from "../../components/admin/SystemHealthCard"
import DepositMethodsCard from "../../components/admin/DepositMethodsCard"
import SupportReviewsCard from "../../components/admin/SupportReviewsCard"

// Types
import {
    SessionConfig,
    VolatilityConfig,
    PriceEvent,
    EconomicNewsEvent,
    FilterType,
    TradingRiskConfig,
    TradingPairSpec
} from "../../components/admin/types"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"
import { storedLang } from "../../utils/cookies"
import "./ManagePanel.css"

interface ManagePanelProps {
    baseUrl: string
    theme: "dark" | "light"
    onThemeToggle: () => void
}

type ManageTabId = "market" | "events" | "trading" | "support" | "payments" | "admins" | "updates" | "database"

const MANAGE_TAB_STORAGE_KEY = "manage.panel.active-tab"
const MANAGE_TAB_IDS: ManageTabId[] = ["market", "events", "trading", "support", "payments", "admins", "updates", "database"]

const isManageTabId = (value: string | null): value is ManageTabId => {
    if (!value) return false
    return MANAGE_TAB_IDS.includes(value as ManageTabId)
}

const tabFromHash = (): ManageTabId | null => {
    if (typeof window === "undefined") return null
    const hash = window.location.hash.replace(/^#/, "").trim().toLowerCase()
    return isManageTabId(hash) ? hash : null
}

// Helper to get date range for filter type
const getDateRange = (type: FilterType, customFrom?: Date, customTo?: Date) => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    switch (type) {
        case "1d":
            return { from: today, to: endOfToday }
        case "3d":
            return { from: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000), to: endOfToday }
        case "1w":
            return { from: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000), to: endOfToday }
        case "1m":
            return { from: new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000), to: endOfToday }
        case "custom":
            return { from: customFrom || today, to: customTo || endOfToday }
    }
}

export default function ManagePanel({ baseUrl, theme, onThemeToggle }: ManagePanelProps) {
    const [lang] = useState<Lang>(storedLang)
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const urlToken = searchParams.get("token")

    // Auth state
    const [isValidating, setIsValidating] = useState(true)
    const [isAuthorized, setIsAuthorized] = useState(false)
    const [userRole, setUserRole] = useState<"owner" | "admin" | null>(null)
    const [userRights, setUserRights] = useState<string[]>([])
    const [adminToken, setAdminToken] = useState<string | null>(null)

    // Admin data
    const [sessions, setSessions] = useState<SessionConfig[]>([])
    const [activeSession, setActiveSession] = useState<string>("")
    const [currentTrend, setCurrentTrend] = useState<string>("random")
    const [trendMode, setTrendMode] = useState<string>("auto")
    const [autoTrendState, setAutoTrendState] = useState<{
        active: boolean
        trend: string
        session_id: string
        next_switch_at: number
        remaining_sec: number
    } | null>(null)
    const [mode, setMode] = useState<string>("manual")
    const [loading, setLoading] = useState(false)
    const [initialLoad, setInitialLoad] = useState(true)

    // Volatility data
    const [volConfigs, setVolConfigs] = useState<VolatilityConfig[]>([])
    const [activeVol, setActiveVol] = useState<string>("")
    const [volMode, setVolMode] = useState<string>("auto")
    const [tradingRisk, setTradingRisk] = useState<TradingRiskConfig | null>(null)
    const [tradingPairs, setTradingPairs] = useState<TradingPairSpec[]>([])
    const [tradingConfigLoading, setTradingConfigLoading] = useState(false)

    const [error, setError] = useState<string | null>(null)

    // Events state with pagination
    const [events, setEvents] = useState<PriceEvent[]>([])
    const [eventsOffset, setEventsOffset] = useState(0)
    const [eventsTotal, setEventsTotal] = useState(0)
    const [eventsLoading, setEventsLoading] = useState(false)
    const EVENTS_LIMIT = 20
    const [newsEvents, setNewsEvents] = useState<EconomicNewsEvent[]>([])
    const [newsOffset, setNewsOffset] = useState(0)
    const [newsTotal, setNewsTotal] = useState(0)
    const [newsLoading, setNewsLoading] = useState(false)
    const NEWS_LIMIT = 20

    // Events filter state
    const [filterType, setFilterType] = useState<FilterType>("1d")
    const [customDateFrom, setCustomDateFrom] = useState<Date | null>(null)
    const [customDateTo, setCustomDateTo] = useState<Date | null>(null)

    // Active event state
    const [activeEventState, setActiveEventState] = useState<{
        active: boolean
        trend: string
        endTime: number
        countdown: number
        manualTrend: string
    } | null>(null)
    const [eventLoading, setEventLoading] = useState(true)
    const [isHeaderCompact, setIsHeaderCompact] = useState(false)
    const [isMobileHeader, setIsMobileHeader] = useState<boolean>(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
        return window.matchMedia("(max-width: 768px)").matches
    })
    const [activeTab, setActiveTab] = useState<ManageTabId>(() => {
        if (typeof window === "undefined") return "market"
        const hashTab = tabFromHash()
        if (hashTab) return hashTab
        const stored = window.localStorage.getItem(MANAGE_TAB_STORAGE_KEY)
        return isManageTabId(stored) ? stored : "market"
    })
    const [systemUpdateAvailable, setSystemUpdateAvailable] = useState(false)

    // Error logging flags
    const errorLogged = useRef({ fetchData: false, fetchEvents: false })
    const scrollRafRef = useRef<number | null>(null)

    // Validate token on mount
    useEffect(() => {
        const validateToken = async () => {
            if (!urlToken) {
                navigate("/404", { replace: true })
                return
            }

            try {
                const res = await fetch(`${baseUrl}/v1/admin/validate-token?token=${urlToken}`)
                if (!res.ok) {
                    navigate("/404", { replace: true })
                    return
                }

                const data = await res.json()
                if (!data.valid) {
                    navigate("/404", { replace: true })
                    return
                }

                const normalizedRole = typeof data.role === "string" && data.role.trim().toLowerCase() === "owner"
                    ? "owner"
                    : "admin"
                setIsAuthorized(true)
                setUserRole(normalizedRole)
                setUserRights(Array.isArray(data.rights) ? data.rights : [])
                setAdminToken(data.admin_token)
            } catch {
                navigate("/404", { replace: true })
            } finally {
                setIsValidating(false)
            }
        }

        validateToken()
    }, [urlToken, baseUrl, navigate])

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return

        const media = window.matchMedia("(max-width: 768px)")
        const apply = (matches: boolean) => {
            setIsMobileHeader(matches)
            if (!matches) setIsHeaderCompact(false)
        }

        apply(media.matches)
        const onMediaChange = (e: MediaQueryListEvent) => apply(e.matches)

        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", onMediaChange)
            return () => media.removeEventListener("change", onMediaChange)
        }

        const legacyListener = (e: MediaQueryListEvent) => apply(e.matches)
        media.addListener(legacyListener)
        return () => media.removeListener(legacyListener)
    }, [])

    useEffect(() => {
        if (!isMobileHeader) {
            setIsHeaderCompact(false)
            return
        }

        const updateCompact = () => {
            scrollRafRef.current = null
            const y = window.scrollY
            // Hysteresis prevents rapid flip-flop near threshold and keeps scroll smooth.
            setIsHeaderCompact(prev => (prev ? y > 8 : y > 28))
        }

        const onScroll = () => {
            if (scrollRafRef.current !== null) return
            scrollRafRef.current = window.requestAnimationFrame(updateCompact)
        }

        updateCompact()
        window.addEventListener("scroll", onScroll, { passive: true })
        return () => {
            window.removeEventListener("scroll", onScroll)
            if (scrollRafRef.current !== null) {
                window.cancelAnimationFrame(scrollRafRef.current)
                scrollRafRef.current = null
            }
        }
    }, [isMobileHeader])

    const headers = useMemo(() => ({
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json"
    }), [adminToken])

    const canAccess = (right: string) => {
        return userRole === "owner" || (Array.isArray(userRights) && userRights.includes(right))
    }
    const canSessions = canAccess("sessions")
    const canTrend = canAccess("trend")
    const canEvents = canAccess("events")
    const canVolatility = canAccess("volatility")
    const canSupportReview = canAccess("support_review")
    const canTradingConfig = userRole === "owner"

    const tabs = useMemo(() => {
        const list: Array<{
            id: ManageTabId
            label: string
            description: string
            icon: typeof Settings
            visible: boolean
        }> = [
                {
                    id: "market",
                    label: t("manage.tab.market", lang),
                    description: t("manage.tab.marketDesc", lang),
                    icon: Settings,
                    visible: canSessions || canTrend || canVolatility,
                },
                {
                    id: "events",
                    label: t("manage.tab.events", lang),
                    description: userRole === "owner" ? t("manage.tab.eventsDescOwner", lang) : t("manage.tab.eventsDescAdmin", lang),
                    icon: Target,
                    visible: canEvents || userRole === "owner",
                },
                {
                    id: "trading",
                    label: t("manage.tab.trading", lang),
                    description: t("manage.tab.tradingDesc", lang),
                    icon: ShieldAlert,
                    visible: canTradingConfig,
                },
                {
                    id: "support",
                    label: t("manage.tab.support", lang),
                    description: t("manage.tab.supportDesc", lang),
                    icon: LifeBuoy,
                    visible: canSupportReview,
                },
                {
                    id: "payments",
                    label: t("manage.tab.payments", lang),
                    description: t("manage.tab.paymentsDesc", lang),
                    icon: CreditCard,
                    visible: userRole === "owner",
                },
                {
                    id: "admins",
                    label: t("manage.tab.admins", lang),
                    description: t("manage.tab.adminsDesc", lang),
                    icon: Shield,
                    visible: userRole === "owner",
                },
                {
                    id: "updates",
                    label: t("manage.tab.updates", lang),
                    description: t("manage.tab.updatesDesc", lang),
                    icon: Activity,
                    visible: userRole === "owner",
                },
                {
                    id: "database",
                    label: t("manage.tab.database", lang),
                    description: t("manage.tab.databaseDesc", lang),
                    icon: Database,
                    visible: userRole === "owner",
                },
            ]

        return list.filter(tab => tab.visible)
    }, [canSessions, canTrend, canVolatility, canEvents, canSupportReview, canTradingConfig, userRole, lang])

    const activeTabMeta = useMemo(() => {
        return tabs.find(tab => tab.id === activeTab) || null
    }, [tabs, activeTab])

    const showTradingPairsCard = useMemo(() => {
        return canTradingConfig && (initialLoad || tradingConfigLoading || tradingPairs.length > 0)
    }, [canTradingConfig, initialLoad, tradingConfigLoading, tradingPairs.length])

    useEffect(() => {
        if (tabs.length === 0) return
        if (!tabs.some(tab => tab.id === activeTab)) {
            setActiveTab(tabs[0].id)
        }
    }, [tabs, activeTab])

    useEffect(() => {
        if (typeof window === "undefined") return
        window.localStorage.setItem(MANAGE_TAB_STORAGE_KEY, activeTab)
        const currentHash = window.location.hash.replace(/^#/, "").trim().toLowerCase()
        if (currentHash !== activeTab) {
            const url = `${window.location.pathname}${window.location.search}#${activeTab}`
            window.history.replaceState(null, "", url)
        }
    }, [activeTab])

    useEffect(() => {
        if (typeof window === "undefined") return
        const onHashChange = () => {
            const next = tabFromHash()
            if (!next) return
            if (!tabs.some(tab => tab.id === next)) return
            setActiveTab(prev => (prev === next ? prev : next))
        }
        window.addEventListener("hashchange", onHashChange)
        return () => window.removeEventListener("hashchange", onHashChange)
    }, [tabs])

    const fetchTradingConfig = useCallback(async () => {
        if (!adminToken || !canTradingConfig) return
        setTradingConfigLoading(true)
        try {
            const [riskRes, pairsRes] = await Promise.all([
                fetch(`${baseUrl}/v1/admin/trading/risk`, { headers }),
                fetch(`${baseUrl}/v1/admin/trading/pairs`, { headers })
            ])

            if (riskRes.ok) {
                const riskData = await riskRes.json()
                setTradingRisk(riskData || null)
            }
            if (pairsRes.ok) {
                const pairsData = await pairsRes.json()
                setTradingPairs(Array.isArray(pairsData) ? pairsData : [])
            }
        } catch (e) {
            console.error("[ManagePanel] Fetch trading config error:", e)
        } finally {
            setTradingConfigLoading(false)
        }
    }, [adminToken, canTradingConfig, baseUrl, headers])

    const fetchSystemUpdaterFlag = useCallback(async () => {
        if (!adminToken || userRole !== "owner") {
            setSystemUpdateAvailable(false)
            return
        }
        try {
            const res = await fetch(`${baseUrl}/v1/admin/system/updater`, { headers })
            if (!res.ok) return
            const data = await res.json().catch(() => null)
            setSystemUpdateAvailable(Boolean(data?.update_available))
        } catch {
            // no-op: keep last known badge state
        }
    }, [adminToken, userRole, baseUrl, headers])

    // Fetch events with pagination
    const fetchEvents = useCallback(async (reset = false) => {
        if (!adminToken || !canEvents) return
        setEventsLoading(true)

        const dateRange = getDateRange(filterType, customDateFrom || undefined, customDateTo || undefined)
        const offset = reset ? 0 : eventsOffset

        try {
            const params = new URLSearchParams({
                limit: String(EVENTS_LIMIT),
                offset: String(offset),
                date_from: dateRange.from.toISOString(),
                date_to: dateRange.to.toISOString()
            })

            const res = await fetch(`${baseUrl}/v1/admin/events?${params}`, { headers })
            if (res.ok) {
                const data = await res.json()
                if (reset) {
                    setEvents(data.events || [])
                    setEventsOffset(EVENTS_LIMIT)
                } else {
                    setEvents(prev => [...prev, ...(data.events || [])])
                    setEventsOffset(prev => prev + EVENTS_LIMIT)
                }
                setEventsTotal(data.total || 0)
            }
        } catch (e) {
            if (!errorLogged.current.fetchEvents) {
                console.error("[ManagePanel] Fetch events error:", e)
                errorLogged.current.fetchEvents = true
            }
        }
        setEventsLoading(false)
    }, [adminToken, canEvents, baseUrl, headers, filterType, customDateFrom, customDateTo, eventsOffset])

    const fetchNewsEvents = useCallback(async (reset = false) => {
        if (!adminToken || userRole !== "owner") return
        setNewsLoading(true)
        const offset = reset ? 0 : newsOffset
        const now = new Date()
        const from = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000)
        const to = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000)
        try {
            const params = new URLSearchParams({
                pair: "UZS-USD",
                limit: String(NEWS_LIMIT),
                offset: String(offset),
                date_from: from.toISOString(),
                date_to: to.toISOString(),
            })
            const res = await fetch(`${baseUrl}/v1/admin/news/events?${params}`, { headers })
            if (res.ok) {
                const data = await res.json()
                if (reset) {
                    setNewsEvents(data.events || [])
                    setNewsOffset(NEWS_LIMIT)
                } else {
                    setNewsEvents(prev => [...prev, ...(data.events || [])])
                    setNewsOffset(prev => prev + NEWS_LIMIT)
                }
                setNewsTotal(data.total || 0)
            }
        } catch (e) {
            console.error("[ManagePanel] Fetch news events error:", e)
        } finally {
            setNewsLoading(false)
        }
    }, [adminToken, userRole, baseUrl, headers, newsOffset])

    // Fetch other data
    const fetchData = useCallback(async () => {
        if (!adminToken) return
        try {
            const jobs: Array<Promise<void>> = []

            if (canSessions) {
                jobs.push((async () => {
                    const [sessRes, modeRes] = await Promise.all([
                        fetch(`${baseUrl}/v1/admin/sessions`, { headers }),
                        fetch(`${baseUrl}/v1/admin/sessions/mode`, { headers })
                    ])
                    if (sessRes.ok) {
                        const sessData = await sessRes.json()
                        setSessions(sessData || [])
                        const active = (sessData || []).find((s: SessionConfig) => s.is_active)
                        if (active) setActiveSession(active.id)
                    }
                    if (modeRes.ok) {
                        const modeData = await modeRes.json()
                        setMode(modeData.mode || "manual")
                    }
                })())
            } else {
                setSessions([])
                setActiveSession("")
            }

            if (canTrend) {
                jobs.push((async () => {
                    const [trendRes, trendModeRes, trendStateRes] = await Promise.all([
                        fetch(`${baseUrl}/v1/admin/trend`, { headers }),
                        fetch(`${baseUrl}/v1/admin/trend/mode`, { headers }),
                        fetch(`${baseUrl}/v1/admin/trend/state`, { headers })
                    ])
                    if (trendRes.ok) {
                        const trendData = await trendRes.json()
                        setCurrentTrend(trendData.trend || "random")
                    }
                    if (trendModeRes.ok) {
                        const trendModeData = await trendModeRes.json()
                        setTrendMode(trendModeData.mode || "auto")
                    }
                    if (trendStateRes.ok) {
                        const trendStateData = await trendStateRes.json()
                        setAutoTrendState(trendStateData || null)
                    } else {
                        setAutoTrendState(null)
                    }
                })())
            } else {
                setCurrentTrend("random")
                setTrendMode("auto")
                setAutoTrendState(null)
                setActiveEventState(null)
            }

            if (canVolatility) {
                jobs.push((async () => {
                    const volRes = await fetch(`${baseUrl}/v1/admin/volatility`, { headers })
                    if (volRes.ok) {
                        const volData = await volRes.json()
                        setVolConfigs(volData.settings || [])
                        setVolMode(volData.mode || "auto")
                        const activeV = (volData.settings || []).find((v: VolatilityConfig) => v.is_active)
                        if (activeV) setActiveVol(activeV.id)
                    }
                })())
            } else {
                setVolConfigs([])
                setActiveVol("")
            }

            await Promise.all(jobs)

            if (error === "Network Error") setError(null)
        } catch (e) {
            if (!errorLogged.current.fetchData) {
                console.error("[ManagePanel] Fetch error:", e)
                errorLogged.current.fetchData = true
            }
        } finally {
            setInitialLoad(false)
        }
    }, [baseUrl, adminToken, headers, error, canSessions, canTrend, canVolatility])

    // Fetch active event
    useEffect(() => {
        const fetchActiveEvent = async () => {
            try {
                const res = await fetch(`${baseUrl}/v1/admin/events/active`, { headers })
                if (res.ok) {
                    const data = await res.json()
                    if (data.active) {
                        setActiveEventState({
                            active: true,
                            trend: data.trend,
                            endTime: data.end_time,
                            countdown: Math.max(0, Math.floor((data.end_time - Date.now()) / 1000)),
                            manualTrend: data.manual_trend || currentTrend
                        })
                    } else {
                        setActiveEventState(null)
                    }
                }
            } catch { }
            setEventLoading(false)
        }
        if (isAuthorized && adminToken && canTrend) fetchActiveEvent()
        else setEventLoading(false)
    }, [isAuthorized, adminToken, canTrend, baseUrl, headers, currentTrend])

    // WebSocket for event_state updates
    useEffect(() => {
        if (!isAuthorized || !canTrend) return
        const wsUrl = `${baseUrl.replace(/^http/, "ws").replace(/\/+$/, "")}/v1/events/ws`
        const ws = new WebSocket(wsUrl)

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data)
                if (msg.type === "event_state") {
                    const data = msg.data || msg
                    if (data.active) {
                        setActiveEventState({
                            active: true,
                            trend: data.trend,
                            endTime: data.end_time,
                            countdown: Math.max(0, Math.floor((data.end_time - Date.now()) / 1000)),
                            manualTrend: data.manual_trend || currentTrend
                        })
                    } else {
                        setActiveEventState(null)
                        fetchEvents(true)
                    }
                }
            } catch { }
        }

        return () => ws.close()
    }, [isAuthorized, canTrend, currentTrend, fetchEvents, baseUrl])

    // Countdown timer
    useEffect(() => {
        if (!activeEventState?.active) return
        const timer = setInterval(() => {
            const remaining = Math.max(0, Math.floor((activeEventState.endTime - Date.now()) / 1000))
            setActiveEventState(prev => prev ? { ...prev, countdown: remaining } : null)
            if (remaining <= 0) setActiveEventState(null)
        }, 1000)
        return () => clearInterval(timer)
    }, [activeEventState?.endTime])

    // Initial data load
    useEffect(() => {
        if (isAuthorized && adminToken) {
            fetchData()
            if (canEvents) fetchEvents(true)
            if (canTradingConfig) fetchTradingConfig()
            if (userRole === "owner") fetchNewsEvents(true)
        }
    }, [isAuthorized, adminToken, canEvents, canTradingConfig, fetchData, fetchEvents, fetchTradingConfig, userRole, fetchNewsEvents])

    useEffect(() => {
        if (!isAuthorized || !adminToken || userRole !== "owner") {
            setSystemUpdateAvailable(false)
            return
        }
        fetchSystemUpdaterFlag()
        const timer = setInterval(fetchSystemUpdaterFlag, 30000)
        return () => clearInterval(timer)
    }, [isAuthorized, adminToken, userRole, fetchSystemUpdaterFlag])

    // Reset events when filter changes
    useEffect(() => {
        if (isAuthorized && adminToken && canEvents && !initialLoad) {
            fetchEvents(true)
        }
    }, [isAuthorized, adminToken, canEvents, initialLoad, filterType, customDateFrom, customDateTo, fetchEvents])

    // Auto refresh data (every 5s)
    useEffect(() => {
        if (isAuthorized && adminToken) {
            const interval = setInterval(fetchData, 5000)
            return () => clearInterval(interval)
        }
    }, [isAuthorized, adminToken, fetchData])

    // Auto Session Switching
    useEffect(() => {
        if (canSessions && mode === "auto" && isAuthorized && activeSession) {
            const checkAndSwitch = () => {
                const hour = new Date().getUTCHours()
                const targetId = (hour >= 13 && hour < 22) ? "newyork" : "london"
                if (activeSession !== targetId) switchSession(targetId)
            }
            checkAndSwitch()
            const timer = setInterval(checkAndSwitch, 10000)
            return () => clearInterval(timer)
        }
    }, [canSessions, mode, activeSession, isAuthorized])

    // Actions
    const switchSession = async (sessionId: string) => {
        if (!canAccess("sessions")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/sessions/switch`, {
                method: "POST", headers,
                body: JSON.stringify({ session_id: sessionId })
            })
            setActiveSession(sessionId)
            fetchData()
        } catch (e) { setError(String(e)) }
        setLoading(false)
    }

    const setTrend = async (trend: string, durationSeconds?: number) => {
        if (!canAccess("trend")) return
        setLoading(true)
        try {
            const payload: Record<string, unknown> = { trend }
            if ((trend === "bullish" || trend === "bearish") && (durationSeconds === 180 || durationSeconds === 300)) {
                payload.duration_seconds = durationSeconds
            }
            await fetch(`${baseUrl}/v1/admin/trend`, {
                method: "POST", headers,
                body: JSON.stringify(payload)
            })
            setCurrentTrend(trend)
            setTrendMode("manual")
            fetchData()
        } catch (e) { setError(String(e)) }
        setLoading(false)
    }

    const toggleTrendMode = async () => {
        if (!canAccess("trend")) return
        const newMode = trendMode === "auto" ? "manual" : "auto"
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/trend/mode`, {
                method: "POST", headers,
                body: JSON.stringify({ mode: newMode })
            })
            setTrendMode(newMode)
            if (newMode === "auto") fetchData()
        } catch (e) { setError(String(e)) }
        setLoading(false)
    }

    const toggleMode = async () => {
        if (!canAccess("sessions")) return
        const newMode = mode === "auto" ? "manual" : "auto"
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/sessions/mode`, {
                method: "POST", headers,
                body: JSON.stringify({ mode: newMode })
            })
            setMode(newMode)
        } catch (e) { setError(String(e)) }
        setLoading(false)
    }

    const switchVolatility = async (volId: string) => {
        if (!canAccess("volatility")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/volatility/activate`, {
                method: "POST", headers,
                body: JSON.stringify({ id: volId })
            })
            setActiveVol(volId)
            fetchData()
        } catch (e) { setError(String(e)) }
        setLoading(false)
    }

    const toggleVolMode = async () => {
        if (!canAccess("volatility")) return
        const newMode = volMode === "auto" ? "manual" : "auto"
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/volatility/mode`, {
                method: "POST", headers,
                body: JSON.stringify({ mode: newMode })
            })
            setVolMode(newMode)
        } catch (e) { setError(String(e)) }
        setLoading(false)
    }

    const createEvent = async (direction: string, duration: number, scheduledAt: string) => {
        if (!canAccess("events")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/events`, {
                method: "POST", headers,
                body: JSON.stringify({ direction, duration_seconds: duration, scheduled_at: scheduledAt })
            })
            fetchEvents(true)
        } catch (e) { setError(String(e)) }
        setLoading(false)
    }

    const cancelEvent = async (id: number) => {
        if (!canAccess("events")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/events/${id}`, { method: "DELETE", headers })
            fetchEvents(true)
        } catch (e) { setError(String(e)) }
        setLoading(false)
    }

    const createNewsEvent = async (payload: {
        title: string
        impact: "low" | "medium" | "high"
        forecastValue: number
        scheduledAt: string
        preSeconds: number
        eventSeconds: number
        postSeconds: number
    }) => {
        if (userRole !== "owner") return
        setNewsLoading(true)
        try {
            const res = await fetch(`${baseUrl}/v1/admin/news/events`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    pair: "UZS-USD",
                    title: payload.title,
                    impact: payload.impact,
                    forecast_value: payload.forecastValue,
                    scheduled_at: payload.scheduledAt,
                    pre_seconds: payload.preSeconds,
                    event_seconds: payload.eventSeconds,
                    post_seconds: payload.postSeconds,
                })
            })
            if (!res.ok) {
                const data = await res.json().catch(() => null)
                throw new Error(data?.error || t("manage.news.error.create", lang))
            }
            await fetchNewsEvents(true)
        } catch (e: any) {
            setError(e?.message || t("manage.news.error.create", lang))
        } finally {
            setNewsLoading(false)
        }
    }

    const cancelNewsEvent = async (id: number) => {
        if (userRole !== "owner") return
        setNewsLoading(true)
        try {
            const res = await fetch(`${baseUrl}/v1/admin/news/events/${id}`, {
                method: "DELETE",
                headers,
            })
            if (!res.ok) {
                const data = await res.json().catch(() => null)
                throw new Error(data?.error || t("manage.news.error.cancel", lang))
            }
            await fetchNewsEvents(true)
        } catch (e: any) {
            setError(e?.message || t("manage.news.error.cancel", lang))
        } finally {
            setNewsLoading(false)
        }
    }

    const saveTradingRisk = async (next: TradingRiskConfig) => {
        if (!canTradingConfig) return
        setTradingConfigLoading(true)
        try {
            const res = await fetch(`${baseUrl}/v1/admin/trading/risk`, {
                method: "POST",
                headers,
                body: JSON.stringify(next)
            })
            if (!res.ok) {
                const err = await res.json().catch(() => null)
                throw new Error(err?.error || t("manage.risk.error.save", lang))
            }
            const data = await res.json()
            setTradingRisk(data || null)
            setError(null)
        } catch (e: any) {
            setError(e?.message || t("manage.risk.error.save", lang))
        } finally {
            setTradingConfigLoading(false)
        }
    }

    const saveTradingPair = async (symbol: string, payload: Partial<TradingPairSpec>) => {
        if (!canTradingConfig) return
        setTradingConfigLoading(true)
        try {
            const res = await fetch(`${baseUrl}/v1/admin/trading/pairs/${encodeURIComponent(symbol)}`, {
                method: "POST",
                headers,
                body: JSON.stringify(payload)
            })
            if (!res.ok) {
                const err = await res.json().catch(() => null)
                throw new Error(err?.error || t("manage.pairs.error.saveSymbol", lang).replace("{symbol}", symbol))
            }
            setError(null)
            await fetchTradingConfig()
        } catch (e: any) {
            setError(e?.message || t("manage.pairs.error.saveSymbol", lang).replace("{symbol}", symbol))
        } finally {
            setTradingConfigLoading(false)
        }
    }

    const handleFilterChange = (type: FilterType, from?: Date, to?: Date) => {
        setFilterType(type)
        if (from !== undefined) setCustomDateFrom(from || null)
        if (to !== undefined) setCustomDateTo(to || null)
    }

    if (isValidating) {
        return (
            <div className="manage-panel-loading">
                <div className="admin-dashboard">
                    <header className="admin-header">
                        <div className="admin-header-left">
                            <Skeleton width={28} height={28} radius="50%" />
                            <Skeleton width={200} height={24} />
                        </div>
                    </header>
                </div>
            </div>
        )
    }

    if (!isAuthorized) return null

    return (
        <div className="admin-dashboard">
            {/* Header */}
            <header className={`admin-header ${isMobileHeader && isHeaderCompact ? "compact" : ""}`}>
                <div className="admin-header-left">
                    <Settings size={24} className="admin-title-icon" />
                    <h1>{t("manage.header.title", lang)}</h1>
                </div>
                <div className="admin-header-center">
                    <span className={`role-pill ${userRole === "owner" ? "owner" : "admin"}`}>
                        {userRole === "owner" ? t("manage.role.owner", lang) : t("manage.role.admin", lang)}
                    </span>
                </div>
                <div className="admin-header-right">
                    <button onClick={onThemeToggle} className="icon-btn">
                        {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                    <button onClick={() => navigate("/")} className="logout-btn">
                        <LogOut size={18} />
                        <span>{t("manage.header.exit", lang)}</span>
                    </button>
                </div>
            </header>

            {error && (
                <div className="admin-error-banner">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                    <button onClick={() => setError(null)}><X size={16} /></button>
                </div>
            )}

            {tabs.length > 0 && (
                <div className="admin-tabs-shell">
                    <div className="admin-tabs" role="tablist" aria-label={t("manage.tabs.ariaLabel", lang)}>
                        {tabs.map(tab => {
                            const Icon = tab.icon
                            const isActive = activeTab === tab.id
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`admin-tab-btn ${isActive ? "active" : ""}`}
                                    onClick={() => setActiveTab(tab.id)}
                                >
                                    <Icon size={16} />
                                    <span className="admin-tab-label">{tab.label}</span>
                                    {tab.id === "updates" && systemUpdateAvailable && <span className="admin-tab-dot" aria-label={t("manage.system.updater.badge", lang)} />}
                                </button>
                            )
                        })}
                    </div>
                    {activeTabMeta && (
                        <p className="admin-tab-caption">{activeTabMeta.description}</p>
                    )}
                </div>
            )}

            {tabs.length === 0 ? (
                <div className="admin-card full-width">
                    <div className="no-events">
                        <AlertCircle size={20} />
                        <span>{t("manage.noSectionsForRights", lang)}</span>
                    </div>
                </div>
            ) : (
                <div className="admin-grid">
                    {activeTab === "market" && (
                        <>
                            <SessionsCard
                                lang={lang}
                                sessions={sessions}
                                activeSession={activeSession}
                                mode={mode}
                                loading={loading}
                                initialLoad={initialLoad}
                                canAccess={canSessions}
                                onSwitchSession={switchSession}
                                onToggleMode={toggleMode}
                            />

                            <VolatilityCard
                                lang={lang}
                                configs={volConfigs}
                                activeId={activeVol}
                                mode={volMode}
                                loading={loading}
                                initialLoad={initialLoad}
                                canAccess={canVolatility}
                                onActivate={switchVolatility}
                                onToggleMode={toggleVolMode}
                            />

                            <TrendCard
                                lang={lang}
                                currentTrend={currentTrend}
                                mode={trendMode}
                                autoTrendState={autoTrendState}
                                activeEventState={activeEventState}
                                loading={loading}
                                initialLoad={initialLoad}
                                eventLoading={eventLoading}
                                canAccess={canTrend}
                                onSetTrend={setTrend}
                                onToggleMode={toggleTrendMode}
                            />
                        </>
                    )}

                    {activeTab === "events" && (
                        <>
                            <PriceEventsCard
                                lang={lang}
                                events={events}
                                total={eventsTotal}
                                loading={eventsLoading}
                                initialLoad={initialLoad}
                                canAccess={canEvents}
                                filterType={filterType}
                                customDateFrom={customDateFrom}
                                customDateTo={customDateTo}
                                onCreate={createEvent}
                                onCancel={cancelEvent}
                                onLoadMore={() => fetchEvents(false)}
                                onFilterChange={handleFilterChange}
                            />

                            <EconomicNewsCard
                                lang={lang}
                                canAccess={userRole === "owner"}
                                events={newsEvents}
                                total={newsTotal}
                                loading={newsLoading}
                                onRefresh={() => fetchNewsEvents(true)}
                                onLoadMore={() => fetchNewsEvents(false)}
                                onCreate={createNewsEvent}
                                onCancel={cancelNewsEvent}
                            />
                        </>
                    )}

                    {activeTab === "trading" && (
                        <>
                            <TradingRiskCard
                                lang={lang}
                                value={tradingRisk}
                                loading={tradingConfigLoading}
                                initialLoad={initialLoad}
                                canAccess={canTradingConfig}
                                onSave={saveTradingRisk}
                            />

                            {showTradingPairsCard && (
                                <TradingPairsCard
                                    lang={lang}
                                    pairs={tradingPairs}
                                    loading={tradingConfigLoading}
                                    initialLoad={initialLoad}
                                    canAccess={canTradingConfig}
                                    onSave={saveTradingPair}
                                />
                            )}
                        </>
                    )}

                    {activeTab === "payments" && (
                        <DepositMethodsCard
                            lang={lang}
                            baseUrl={baseUrl}
                            headers={headers}
                            canAccess={userRole === "owner"}
                        />
                    )}

                    {activeTab === "support" && (
                        <SupportReviewsCard
                            lang={lang}
                            baseUrl={baseUrl}
                            headers={headers}
                            canAccess={canSupportReview}
                        />
                    )}

                    {activeTab === "admins" && (
                        <PanelAdmins
                            lang={lang}
                            baseUrl={baseUrl}
                            headers={headers}
                            userRole={userRole}
                        />
                    )}

                    {activeTab === "updates" && (
                        <SystemHealthCard
                            lang={lang}
                            baseUrl={baseUrl}
                            headers={headers}
                            canAccess={userRole === "owner"}
                            showSummary={false}
                            showUpdater={true}
                            showDangerZone={false}
                            showRaw={true}
                        />
                    )}

                    {activeTab === "database" && (
                        <SystemHealthCard
                            lang={lang}
                            baseUrl={baseUrl}
                            headers={headers}
                            canAccess={userRole === "owner"}
                            showUpdater={false}
                            showDangerZone={true}
                            showRaw={false}
                        />
                    )}
                </div>
            )}
        </div>
    )
}
