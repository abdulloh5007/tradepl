import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import {
    LogOut, Activity, TrendingUp, TrendingDown, Minus, Shuffle,
    Zap, Timer, Gauge, Target, Plus, X, Calendar, Clock,
    Sun, Moon, Settings, CheckCircle, AlertCircle, User, Trash2, Shield,
    Filter, ChevronLeft, ChevronRight, Loader2, StopCircle, Edit2, RefreshCw
} from "lucide-react"
import Skeleton from "../components/Skeleton"

type SessionConfig = {
    id: string
    name: string
    update_rate_ms: number
    volatility: number
    spread: number
    trend_bias: string
    is_active: boolean
}

type VolatilityConfig = {
    id: string
    name: string
    value: number
    spread: number
    schedule_start: string
    schedule_end: string
    is_active: boolean
}

type PriceEvent = {
    id: number
    target_price: number
    direction: string
    duration_seconds: number
    scheduled_at: string
    status: string
    created_at: string
}

type PanelAdmin = {
    id: number
    telegram_id: number
    name: string
    rights: string[]
    created_at: string
}

type FilterType = "1d" | "3d" | "1w" | "1m" | "custom"

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

const filterLabels: Record<FilterType, string> = {
    "1d": "1 день",
    "3d": "3 дня",
    "1w": "1 неделя",
    "1m": "1 месяц",
    "custom": "Выбрать"
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
    const hasMoreEvents = events.length < eventsTotal

    // Events filter state
    const [filterType, setFilterType] = useState<FilterType>("1d")
    const [customDateFrom, setCustomDateFrom] = useState<Date | null>(null)
    const [customDateTo, setCustomDateTo] = useState<Date | null>(null)
    const [showFilterModal, setShowFilterModal] = useState(false)

    // New event form
    const [newDirection, setNewDirection] = useState<"up" | "down">("up")
    const [newDuration, setNewDuration] = useState("60")

    // Active event state
    const [activeEventState, setActiveEventState] = useState<{
        active: boolean
        trend: string
        endTime: number
        countdown: number
        manualTrend: string
    } | null>(null)
    const [eventLoading, setEventLoading] = useState(true)

    // Panel admins (for owner)
    const [panelAdmins, setPanelAdmins] = useState<PanelAdmin[]>([])
    const [newAdminTgId, setNewAdminTgId] = useState("")
    const [newAdminName, setNewAdminName] = useState("")

    const [newAdminRights, setNewAdminRights] = useState<string[]>([])
    const [editingAdmin, setEditingAdmin] = useState<any>(null)
    const [editAdminName, setEditAdminName] = useState("")
    const [editAdminRights, setEditAdminRights] = useState<string[]>([])

    const allRights = ["sessions", "volatility", "trend", "events"]

    // Error logging flags - prevent repeated console spam
    const errorLogged = useRef({ fetchData: false, fetchEvents: false, fetchAdmins: false })

    // Check if mobile
    const isMobile = useMemo(() => {
        if (typeof window === "undefined") return false
        return window.innerWidth <= 768
    }, [])

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

    // Fetch panel admins
    const fetchAdmins = useCallback(async () => {
        if (!adminToken || userRole !== "owner") return
        try {
            const res = await fetch(`${baseUrl}/v1/admin/panel-admins`, { headers })
            if (res.ok) {
                const data = await res.json()
                setPanelAdmins(data || [])
            }
        } catch (e) {
            if (!errorLogged.current.fetchAdmins) {
                console.error("[ManagePanel] Fetch admins error:", e)
                errorLogged.current.fetchAdmins = true
            }
        }
    }, [baseUrl, adminToken, userRole, headers])

    // Initial data load
    useEffect(() => {
        if (isAuthorized && adminToken) {
            fetchData()
            fetchEvents(true)
            fetchAdmins()
        }
    }, [isAuthorized, adminToken])

    // Reset events when filter changes
    useEffect(() => {
        if (isAuthorized && adminToken && !initialLoad) {
            fetchEvents(true)
        }
    }, [filterType, customDateFrom, customDateTo])

    // Auto refresh data (exclude events - those are paginated)
    useEffect(() => {
        if (isAuthorized && adminToken) {
            const interval = setInterval(() => {
                fetchData()
                fetchAdmins()
            }, 5000)
            return () => clearInterval(interval)
        }
    }, [isAuthorized, adminToken, fetchData, fetchAdmins])

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

    const createEvent = async () => {
        if (!canAccess("events")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/events`, {
                method: "POST", headers,
                body: JSON.stringify({ direction: newDirection, duration_seconds: parseInt(newDuration) })
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

    const createAdmin = async () => {
        if (userRole !== "owner" || !newAdminTgId || !newAdminName) return
        setLoading(true)
        try {
            // Convert rights array to map[string]bool for backend
            const rightsMap: Record<string, boolean> = {}
            newAdminRights.forEach(r => { rightsMap[r] = true })

            await fetch(`${baseUrl}/v1/admin/panel-admins`, {
                method: "POST", headers,
                body: JSON.stringify({ telegram_id: parseInt(newAdminTgId), name: newAdminName, rights: rightsMap })
            })
            setNewAdminTgId("")
            setNewAdminName("")
            setNewAdminRights([])
            fetchAdmins()
        } catch (e) { setError(String(e)) }
        setLoading(false)
    }

    const deleteAdmin = async (id: number) => {
        if (userRole !== "owner") return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/panel-admins/${id}`, { method: "DELETE", headers })
            fetchAdmins()
        } catch (e) { setError(String(e)) }
        setLoading(false)
    }

    const startEditing = (admin: any) => {
        setEditingAdmin(admin)
        setEditAdminName(admin.name)
        setEditAdminRights(Array.isArray(admin.rights) ? admin.rights : [])
    }

    const updateAdmin = async () => {
        if (!editingAdmin) return
        setLoading(true)
        try {
            const rightsMap: Record<string, boolean> = {}
            editAdminRights.forEach(r => rightsMap[r] = true)

            const res = await fetch(`${baseUrl}/v1/admin/panel-admins/${editingAdmin.id}`, {
                method: "PUT",
                headers: {
                    ...headers,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name: editAdminName,
                    rights: rightsMap
                })
            })
            if (!res.ok) throw new Error("Failed to update admin")

            // Convert rights map back to array for UI
            const rightsArr = []
            if (editAdminRights) {
                // We use local state updating, but better fetch fresh list
                fetchAdmins()
            }
            setEditingAdmin(null)
        } catch (e) {
            setError("Failed to update admin")
        } finally {
            setLoading(false)
        }
    }

    const toggleAdminRight = (right: string) => {
        if (newAdminRights.includes(right)) {
            setNewAdminRights(newAdminRights.filter(r => r !== right))
        } else {
            setNewAdminRights([...newAdminRights, right])
        }
    }

    const handleFilterSelect = (type: FilterType) => {
        if (type === "custom") {
            // Don't close modal, show date picker
            return
        }
        setFilterType(type)
        setCustomDateFrom(null)
        setCustomDateTo(null)
        setShowFilterModal(false)
    }

    const applyCustomFilter = () => {
        if (customDateFrom) {
            // If To is missing, set to today end of day
            if (!customDateTo) {
                const today = new Date()
                today.setHours(23, 59, 59, 999)
                setCustomDateTo(today)
            }
            setFilterType("custom")
            setShowFilterModal(false)
        }
    }

    const sessionIcons: Record<string, any> = { turbo: Zap, normal: Timer, calm: Gauge }
    const sessionSchedule: Record<string, string> = { turbo: "09:00 - 13:00", normal: "13:00 - 19:00", calm: "19:00 - 09:00" }

    const trendConfig = [
        { id: "bullish", icon: TrendingUp, label: "Bullish", color: "#16a34a" },
        { id: "bearish", icon: TrendingDown, label: "Bearish", color: "#ef4444" },
        { id: "sideways", icon: Minus, label: "Sideways", color: "#eab308" },
        { id: "random", icon: Shuffle, label: "Random", color: "var(--accent-2)" }
    ]

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
                {/* Sessions Card */}
                {canAccess("sessions") && (
                    <div className="admin-card">
                        <div className="admin-card-header">
                            <Activity size={20} />
                            <h2>Trading Sessions</h2>
                            <div className="mode-toggle">
                                {initialLoad ? <Skeleton width={120} height={24} radius={12} /> : (
                                    <>
                                        <span className={mode === "manual" ? "active" : ""}>Manual</span>
                                        <button className={`toggle-switch ${mode === "auto" ? "checked" : ""}`} onClick={toggleMode} disabled={loading}>
                                            <span className="toggle-thumb" />
                                        </button>
                                        <span className={mode === "auto" ? "active" : ""}>Auto</span>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="sessions-grid">
                            {initialLoad ? Array(3).fill(0).map((_, i) => (
                                <div key={i} className="session-card" style={{ pointerEvents: "none", opacity: 0.7 }}>
                                    <Skeleton width={24} height={24} radius="50%" />
                                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                        <Skeleton width="60%" height={16} />
                                        <Skeleton width="40%" height={12} />
                                    </div>
                                </div>
                            )) : sessions.map(s => {
                                const Icon = sessionIcons[s.id] || Timer
                                const isActive = activeSession === s.id
                                return (
                                    <button key={s.id} className={`session-card ${isActive ? "active" : ""} ${mode === "auto" ? "auto-disabled" : ""}`}
                                        onClick={() => switchSession(s.id)} disabled={loading || mode === "auto"}
                                        style={{ opacity: mode === "auto" && !isActive ? 0.6 : 1 }}>
                                        <Icon size={24} />
                                        <span className="session-name">{s.name}</span>
                                        {mode === "auto" ? <span className="session-rate" style={{ fontSize: 11 }}>{sessionSchedule[s.id] || "All Day"}</span>
                                            : <span className="session-rate">{s.update_rate_ms}ms</span>}
                                        {isActive && <CheckCircle size={16} className="session-check" />}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Volatility Card */}
                {canAccess("volatility") && (
                    <div className="admin-card">
                        <div className="admin-card-header">
                            <Activity size={20} />
                            <h2>Market Volatility</h2>
                            <div className="mode-toggle">
                                {initialLoad ? <Skeleton width={120} height={24} radius={12} /> : (
                                    <>
                                        <span className={volMode === "manual" ? "active" : ""}>Manual</span>
                                        <button className={`toggle-switch ${volMode === "auto" ? "checked" : ""}`} onClick={toggleVolMode} disabled={loading}>
                                            <span className="toggle-thumb" />
                                        </button>
                                        <span className={volMode === "auto" ? "active" : ""}>Auto</span>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="sessions-grid">
                            {initialLoad ? Array(3).fill(0).map((_, i) => (
                                <div key={i} className="session-card" style={{ pointerEvents: "none", opacity: 0.7 }}>
                                    <Skeleton width={24} height={24} radius="50%" />
                                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                        <Skeleton width="60%" height={16} />
                                        <Skeleton width="40%" height={12} />
                                    </div>
                                </div>
                            )) : [...volConfigs].sort((a, b) => {
                                const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
                                return (order[a.id] ?? 9) - (order[b.id] ?? 9)
                            }).map(v => {
                                let Icon = Activity
                                if (v.id === "low") Icon = Moon
                                if (v.id === "medium") Icon = Sun
                                if (v.id === "high") Icon = Zap
                                const isActive = activeVol === v.id
                                return (
                                    <button key={v.id} className={`session-card ${isActive ? "active" : ""} ${volMode === "auto" ? "auto-disabled" : ""}`}
                                        onClick={() => switchVolatility(v.id)} disabled={loading || volMode === "auto"}
                                        style={{ opacity: volMode === "auto" && !isActive ? 0.6 : 1 }}>
                                        <Icon size={24} />
                                        <span className="session-name">{v.name}</span>
                                        {volMode === "auto" ? <span className="session-rate" style={{ fontSize: 11 }}>{v.schedule_start} - {v.schedule_end}</span>
                                            : <span className="session-rate">Spread: {v.spread.toExponential(0)}</span>}
                                        {isActive && <CheckCircle size={16} className="session-check" />}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Trend Card */}
                {canAccess("trend") && (
                    <div className="admin-card">
                        <div className="admin-card-header">
                            <TrendingUp size={20} />
                            <h2>Market Trend</h2>
                        </div>
                        <div className={`trend-grid ${activeEventState?.active ? "event-running" : ""}`}>
                            {(initialLoad || eventLoading) ? Array(4).fill(0).map((_, i) => (
                                <div key={i} className="trend-btn" style={{ pointerEvents: "none", border: "1px solid var(--border-subtle)" }}>
                                    <Skeleton width={22} height={22} radius="50%" />
                                    <Skeleton width={60} height={14} />
                                </div>
                            )) : trendConfig.map(t => {
                                const isEventRunning = activeEventState?.active
                                const isManualActive = isEventRunning ? activeEventState.manualTrend === t.id : currentTrend === t.id
                                const isEventTrend = isEventRunning && activeEventState.trend === t.id
                                return (
                                    <button key={t.id}
                                        className={`trend-btn ${isManualActive ? "active" : ""} ${isEventTrend ? "event-active" : ""} ${isEventRunning ? "event-disabled" : ""}`}
                                        onClick={() => setTrend(t.id)} disabled={loading || isEventRunning}
                                        style={{ "--trend-color": t.color } as React.CSSProperties}>
                                        <t.icon size={22} />
                                        <span>{t.label}</span>
                                        {isEventTrend && activeEventState && <span className="event-timer">{activeEventState.countdown}s</span>}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Price Events Card */}
                {canAccess("events") && (
                    <div className="admin-card full-width">
                        <div className="admin-card-header">
                            <Target size={20} />
                            <h2>Scheduled Price Events</h2>
                            <button className="filter-btn" onClick={() => setShowFilterModal(true)}>
                                <Filter size={16} />
                                <span>{filterLabels[filterType]}</span>
                            </button>
                        </div>

                        {/* New Event Form */}
                        <div className="event-form">
                            <div className="event-form-row">
                                <div className="event-field">
                                    <label>Direction</label>
                                    <div className="direction-btns">
                                        <button className={newDirection === "up" ? "active up" : ""} onClick={() => setNewDirection("up")}>
                                            <TrendingUp size={16} /> Bullish
                                        </button>
                                        <button className={newDirection === "down" ? "active down" : ""} onClick={() => setNewDirection("down")}>
                                            <TrendingDown size={16} /> Bearish
                                        </button>
                                    </div>
                                </div>
                                <div className="event-field">
                                    <label>Duration</label>
                                    <div className="duration-input">
                                        <input type="number" value={newDuration} onChange={e => setNewDuration(e.target.value)} placeholder="60" min="5" />
                                        <span>sec</span>
                                    </div>
                                </div>
                                <button className="add-event-btn" onClick={createEvent} disabled={loading}>
                                    <Plus size={18} />
                                    <span>Start Event</span>
                                </button>
                            </div>
                        </div>

                        {/* Events List */}
                        <div className="events-list">
                            {initialLoad ? Array(2).fill(0).map((_, i) => (
                                <div key={i} className="event-item" style={{ pointerEvents: "none", opacity: 0.7 }}>
                                    <div className="event-info">
                                        <Skeleton width={60} height={20} />
                                        <Skeleton width={40} height={16} />
                                        <Skeleton width={50} height={16} />
                                    </div>
                                    <Skeleton width={24} height={24} radius={4} />
                                </div>
                            )) : events.length === 0 ? (
                                <div className="no-events">
                                    <Calendar size={24} />
                                    <span>No events for {filterLabels[filterType]}</span>
                                </div>
                            ) : events.map(evt => (
                                <div key={evt.id} className={`event-item ${evt.status}`}>
                                    <div className="event-info">
                                        <span className={`event-direction ${evt.direction}`}>
                                            {evt.direction === "up" ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                            {evt.direction === "up" ? "Bullish" : "Bearish"}
                                        </span>
                                        <span className="event-duration">
                                            <Clock size={14} />
                                            {evt.duration_seconds}s
                                        </span>
                                        <span className={`event-status ${evt.status}`}>{evt.status}</span>
                                    </div>
                                    {evt.status === "pending" && (
                                        <button className="cancel-event-btn" onClick={() => cancelEvent(evt.id)}>
                                            <X size={16} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Load More Button */}
                        {hasMoreEvents && (
                            <button className="load-more-btn" onClick={() => fetchEvents(false)} disabled={eventsLoading}>
                                {eventsLoading ? <Loader2 size={18} className="spin" /> : <Plus size={18} />}
                                <span>{eventsLoading ? "Загрузка..." : `Загрузить ещё (${events.length}/${eventsTotal})`}</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Panel Admins Card */}
                {userRole === "owner" && (
                    <div className="admin-card full-width">
                        <div className="admin-card-header">
                            <Shield size={20} />
                            <h2>Panel Administrators</h2>
                        </div>
                        <div className="admin-form">
                            <div className="admin-form-row">
                                <input type="number" value={newAdminTgId} onChange={e => setNewAdminTgId(e.target.value)} placeholder="Telegram ID" />
                                <input type="text" value={newAdminName} onChange={e => setNewAdminName(e.target.value)} placeholder="Admin Name" />
                            </div>
                            <div className="rights-chips">
                                {allRights.map(right => (
                                    <button key={right}
                                        className={`right-chip ${newAdminRights.includes(right) ? 'active' : ''}`}
                                        onClick={() => toggleAdminRight(right)}>
                                        {right.charAt(0).toUpperCase() + right.slice(1)}
                                    </button>
                                ))}
                            </div>
                            <button className="add-event-btn" onClick={createAdmin} disabled={loading || !newAdminTgId || !newAdminName}>
                                <Plus size={18} />
                                <span>Add Admin</span>
                            </button>
                        </div>
                        <div className="admins-list">
                            {panelAdmins.length === 0 ? (
                                <div className="no-events">
                                    <User size={24} />
                                    <span>No admins yet</span>
                                </div>
                            ) : panelAdmins.map(admin => (
                                <div key={admin.id} className="admin-item">
                                    <div className="admin-info">
                                        <User size={20} />
                                        <div>
                                            <span className="admin-name">{admin.name}</span>
                                            <span className="admin-tg">ID: {admin.telegram_id}</span>
                                        </div>
                                    </div>
                                    <div className="admin-rights">
                                        {Array.isArray(admin.rights) && admin.rights.map(r => <span key={r} className="right-badge">{r}</span>)}
                                    </div>
                                    <div className="admin-actions">
                                        <button className="edit-admin-btn" onClick={() => startEditing(admin)} style={{ marginRight: 8 }}>
                                            <Edit2 size={16} />
                                        </button>
                                        <button className="delete-admin-btn" onClick={() => deleteAdmin(admin.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Filter Modal / Swiper */}
            {showFilterModal && (
                <>
                    <div className="filter-overlay" onClick={() => setShowFilterModal(false)} />
                    <div className={`filter-modal ${isMobile ? "swiper" : ""}`}>
                        <div className="filter-header">
                            <h3>Фильтр событий</h3>
                            <button onClick={() => setShowFilterModal(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="filter-presets">
                            {(["1d", "3d", "1w", "1m"] as FilterType[]).map(type => (
                                <button key={type} className={`filter-preset-btn ${filterType === type ? "active" : ""}`}
                                    onClick={() => handleFilterSelect(type)}>
                                    {filterLabels[type]}
                                </button>
                            ))}
                        </div>

                        <div className="filter-custom">
                            <h4>Выбрать диапазон</h4>
                            <div className="date-range-inputs">
                                <div className="date-input-group">
                                    <label>From</label>
                                    <input type="date" value={customDateFrom ? customDateFrom.toISOString().split('T')[0] : ''}
                                        onChange={e => setCustomDateFrom(e.target.value ? new Date(e.target.value) : null)} />
                                </div>
                                <div className="date-input-group">
                                    <label>To (Optional)</label>
                                    <input type="date" value={customDateTo ? customDateTo.toISOString().split('T')[0] : ''}
                                        onChange={e => setCustomDateTo(e.target.value ? new Date(e.target.value + 'T23:59:59') : null)}
                                        placeholder="Today" />
                                </div>
                            </div>
                            <button className="apply-filter-btn" onClick={applyCustomFilter} disabled={!customDateFrom}>
                                Apply Filter
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Edit Admin Modal */}
            {editingAdmin && (
                <>
                    <div className="filter-overlay" onClick={() => setEditingAdmin(null)} />
                    <div className={`filter-modal ${isMobile ? "swiper" : ""}`}>
                        <div className="filter-header">
                            <h3>Edit Admin</h3>
                            <button onClick={() => setEditingAdmin(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="filter-custom">
                            <div className="date-range-inputs">
                                <div className="date-input-group" style={{ gridColumn: "1 / -1" }}>
                                    <label>Name</label>
                                    <input type="text" value={editAdminName} onChange={e => setEditAdminName(e.target.value)} />
                                </div>
                            </div>

                            <label style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8, display: "block" }}>Rights</label>
                            <div className="rights-chips" style={{ marginBottom: 20 }}>
                                {allRights.map(right => (
                                    <button key={right}
                                        className={`right-chip ${editAdminRights.includes(right) ? 'active' : ''}`}
                                        onClick={() => {
                                            if (editAdminRights.includes(right)) {
                                                setEditAdminRights(prev => prev.filter(r => r !== right))
                                            } else {
                                                setEditAdminRights(prev => [...prev, right])
                                            }
                                        }}>
                                        {right.charAt(0).toUpperCase() + right.slice(1)}
                                    </button>
                                ))}
                            </div>

                            <button className="apply-filter-btn" onClick={updateAdmin} disabled={loading || !editAdminName}>
                                {loading ? <Loader2 className="spin" /> : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
