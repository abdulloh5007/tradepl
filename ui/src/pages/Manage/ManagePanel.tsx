import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { LogOut, Sun, Moon, Settings, AlertCircle, X } from "lucide-react"
import Skeleton from "../../components/Skeleton"

// Components
import SessionsCard from "../../components/admin/SessionsCard"
import VolatilityCard from "../../components/admin/VolatilityCard"
import TrendCard from "../../components/admin/TrendCard"
import PriceEventsCard from "../../components/admin/PriceEventsCard"
import PanelAdmins from "../../components/admin/PanelAdmins"
import TradingRiskCard from "../../components/admin/TradingRiskCard"
import TradingPairsCard from "../../components/admin/TradingPairsCard"

// Types
import {
    SessionConfig,
    VolatilityConfig,
    PriceEvent,
    FilterType,
    TradingRiskConfig,
    TradingPairSpec
} from "../../components/admin/types"
import "./ManagePanel.css"

interface ManagePanelProps {
    baseUrl: string
    theme: "dark" | "light"
    onThemeToggle: () => void
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
    const canTradingConfig = userRole === "owner"

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
        const wsUrl = "ws://localhost:8080/v1/events/ws"
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
    }, [isAuthorized, canTrend, currentTrend, fetchEvents])

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
        }
    }, [isAuthorized, adminToken, canEvents, canTradingConfig, fetchData, fetchEvents, fetchTradingConfig])

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
                throw new Error(err?.error || "Failed to save trading risk")
            }
            const data = await res.json()
            setTradingRisk(data || null)
            setError(null)
        } catch (e: any) {
            setError(e?.message || "Failed to save trading risk")
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
                throw new Error(err?.error || `Failed to save ${symbol}`)
            }
            setError(null)
            await fetchTradingConfig()
        } catch (e: any) {
            setError(e?.message || `Failed to save ${symbol}`)
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
                    <h1>Panel</h1>
                </div>
                <div className="admin-header-center">
                    <span className={`role-pill ${userRole === "owner" ? "owner" : "admin"}`}>
                        {userRole === "owner" ? "OWNER" : "ADMIN"}
                    </span>
                </div>
                <div className="admin-header-right">
                    <button onClick={onThemeToggle} className="icon-btn">
                        {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                    <button onClick={() => navigate("/")} className="logout-btn">
                        <LogOut size={18} />
                        <span>Exit</span>
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

            <div className="admin-grid">
                <SessionsCard
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
                    configs={volConfigs}
                    activeId={activeVol}
                    mode={volMode}
                    loading={loading}
                    initialLoad={initialLoad}
                    canAccess={canVolatility}
                    onActivate={switchVolatility}
                    onToggleMode={toggleVolMode}
                />

                <TradingRiskCard
                    value={tradingRisk}
                    loading={tradingConfigLoading}
                    initialLoad={initialLoad}
                    canAccess={canTradingConfig}
                    onSave={saveTradingRisk}
                />

                <TrendCard
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

                <PriceEventsCard
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

                <TradingPairsCard
                    pairs={tradingPairs}
                    loading={tradingConfigLoading}
                    initialLoad={initialLoad}
                    canAccess={canTradingConfig}
                    onSave={saveTradingPair}
                />

                <PanelAdmins
                    baseUrl={baseUrl}
                    headers={headers}
                    userRole={userRole}
                />
            </div>
        </div>
    )
}
