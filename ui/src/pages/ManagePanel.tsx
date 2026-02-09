import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { LogOut, Sun, Moon, Settings, AlertCircle, X } from "lucide-react"
import Skeleton from "../components/Skeleton"

// Components
import SessionsCard from "../components/admin/SessionsCard"
import VolatilityCard from "../components/admin/VolatilityCard"
import TrendCard from "../components/admin/TrendCard"
import PriceEventsCard from "../components/admin/PriceEventsCard"
import PanelAdmins from "../components/admin/PanelAdmins"

// Types
import { SessionConfig, VolatilityConfig, PriceEvent, FilterType } from "../components/admin/types"

interface ManagePanelProps {
    baseUrl: string
    theme: "dark" | "light"
    onThemeToggle: () => void
}

// Helper to get date range for filter type
const getDateRange = (type: FilterType, customFrom?: Date, customTo?: Date) => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)

    switch (type) {
        case "1d":
            return { from: today, to: now }
        case "3d":
            return { from: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000), to: now }
        case "1w":
            return { from: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000), to: now }
        case "1m":
            return { from: new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000), to: now }
        case "custom":
            return { from: customFrom || today, to: customTo || now }
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
    const [mode, setMode] = useState<string>("manual")
    const [loading, setLoading] = useState(false)
    const [initialLoad, setInitialLoad] = useState(true)

    // Volatility data
    const [volConfigs, setVolConfigs] = useState<VolatilityConfig[]>([])
    const [activeVol, setActiveVol] = useState<string>("")
    const [volMode, setVolMode] = useState<string>("auto")

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

    // Error logging flags
    const errorLogged = useRef({ fetchData: false, fetchEvents: false })

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

                setIsAuthorized(true)
                setUserRole(data.role)
                setUserRights(data.rights || [])
                setAdminToken(data.admin_token)
            } catch {
                navigate("/404", { replace: true })
            } finally {
                setIsValidating(false)
            }
        }

        validateToken()
    }, [urlToken, baseUrl, navigate])

    const headers = useMemo(() => ({
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json"
    }), [adminToken])

    const canAccess = (right: string) => {
        return userRole === "owner" || (Array.isArray(userRights) && userRights.includes(right))
    }

    // Fetch events with pagination
    const fetchEvents = useCallback(async (reset = false) => {
        if (!adminToken) return
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
    }, [adminToken, baseUrl, headers, filterType, customDateFrom, customDateTo, eventsOffset])

    // Fetch other data
    const fetchData = useCallback(async () => {
        if (!adminToken) return
        try {
            const [sessRes, trendRes, modeRes, volRes] = await Promise.all([
                fetch(`${baseUrl}/v1/admin/sessions`, { headers }),
                fetch(`${baseUrl}/v1/admin/trend`, { headers }),
                fetch(`${baseUrl}/v1/admin/sessions/mode`, { headers }),
                fetch(`${baseUrl}/v1/admin/volatility`, { headers })
            ])

            if (sessRes.ok) {
                const sessData = await sessRes.json()
                setSessions(sessData || [])
                const active = (sessData || []).find((s: SessionConfig) => s.is_active)
                if (active) setActiveSession(active.id)
            }

            if (trendRes.ok) {
                const trendData = await trendRes.json()
                setCurrentTrend(trendData.trend || "random")
            }

            if (modeRes.ok) {
                const modeData = await modeRes.json()
                setMode(modeData.mode || "manual")
            }

            if (volRes.ok) {
                const volData = await volRes.json()
                setVolConfigs(volData.settings || [])
                setVolMode(volData.mode || "auto")
                const activeV = (volData.settings || []).find((v: VolatilityConfig) => v.is_active)
                if (activeV) setActiveVol(activeV.id)
            }

            if (error === "Network Error") setError(null)
        } catch (e) {
            if (!errorLogged.current.fetchData) {
                console.error("[ManagePanel] Fetch error:", e)
                errorLogged.current.fetchData = true
            }
        } finally {
            setInitialLoad(false)
        }
    }, [baseUrl, adminToken, headers, error])

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
        if (isAuthorized && adminToken) fetchActiveEvent()
        else setEventLoading(false)
    }, [isAuthorized, adminToken, baseUrl, headers, currentTrend])

    // WebSocket for event_state updates
    useEffect(() => {
        if (!isAuthorized) return
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
    }, [isAuthorized, currentTrend, fetchEvents])

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
            fetchEvents(true)
        }
    }, [isAuthorized, adminToken])

    // Reset events when filter changes
    useEffect(() => {
        if (isAuthorized && adminToken && !initialLoad) {
            fetchEvents(true)
        }
    }, [filterType, customDateFrom, customDateTo])

    // Auto refresh data (every 5s)
    useEffect(() => {
        if (isAuthorized && adminToken) {
            const interval = setInterval(fetchData, 5000)
            return () => clearInterval(interval)
        }
    }, [isAuthorized, adminToken, fetchData])

    // Auto Session Switching
    useEffect(() => {
        if (mode === "auto" && isAuthorized && activeSession) {
            const checkAndSwitch = () => {
                const hour = new Date().getHours()
                let targetId = "calm"
                if (hour >= 9 && hour < 13) targetId = "turbo"
                else if (hour >= 13 && hour < 19) targetId = "normal"
                if (activeSession !== targetId) switchSession(targetId)
            }
            checkAndSwitch()
            const timer = setInterval(checkAndSwitch, 10000)
            return () => clearInterval(timer)
        }
    }, [mode, activeSession, isAuthorized])

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

    const setTrend = async (trend: string) => {
        if (!canAccess("trend")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/trend`, {
                method: "POST", headers,
                body: JSON.stringify({ trend })
            })
            setCurrentTrend(trend)
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

    const createEvent = async (direction: string, duration: number) => {
        if (!canAccess("events")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/events`, {
                method: "POST", headers,
                body: JSON.stringify({ direction, duration_seconds: duration })
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
            <header className="admin-header">
                <div className="admin-header-left">
                    <Settings size={28} />
                    <h1>{userRole === "owner" ? "Owner Panel" : "Admin Panel"}</h1>
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
                    canAccess={canAccess("sessions")}
                    onSwitchSession={switchSession}
                    onToggleMode={toggleMode}
                />

                <VolatilityCard
                    configs={volConfigs}
                    activeId={activeVol}
                    mode={volMode}
                    loading={loading}
                    initialLoad={initialLoad}
                    canAccess={canAccess("volatility")}
                    onActivate={switchVolatility}
                    onToggleMode={toggleVolMode}
                />

                <TrendCard
                    currentTrend={currentTrend}
                    activeEventState={activeEventState}
                    loading={loading}
                    initialLoad={initialLoad}
                    eventLoading={eventLoading}
                    canAccess={canAccess("trend")}
                    onSetTrend={setTrend}
                />

                <PriceEventsCard
                    events={events}
                    total={eventsTotal}
                    loading={eventsLoading}
                    initialLoad={initialLoad}
                    canAccess={canAccess("events")}
                    filterType={filterType}
                    customDateFrom={customDateFrom}
                    customDateTo={customDateTo}
                    onCreate={createEvent}
                    onCancel={cancelEvent}
                    onLoadMore={() => fetchEvents(false)}
                    onFilterChange={handleFilterChange}
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
