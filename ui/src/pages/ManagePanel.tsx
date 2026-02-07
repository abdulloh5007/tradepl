import { useState, useEffect, useCallback } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import {
    LogOut, Activity, TrendingUp, TrendingDown, Minus, Shuffle,
    Zap, Timer, Gauge, Target, Plus, X, Calendar, Clock,
    Sun, Moon, Settings, CheckCircle, AlertCircle, User, Trash2, Shield
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
}

type PanelAdmin = {
    id: number
    telegram_id: number
    name: string
    rights: string[]
    created_at: string
}

interface ManagePanelProps {
    baseUrl: string
    theme: "dark" | "light"
    onThemeToggle: () => void
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
    const [events, setEvents] = useState<PriceEvent[]>([])
    const [loading, setLoading] = useState(false)
    const [initialLoad, setInitialLoad] = useState(true)

    // Volatility data
    const [volConfigs, setVolConfigs] = useState<VolatilityConfig[]>([])
    const [activeVol, setActiveVol] = useState<string>("")
    const [volMode, setVolMode] = useState<string>("auto")

    const [error, setError] = useState<string | null>(null)

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

    // Available rights
    const allRights = ["sessions", "volatility", "trend", "events"]

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

    const headers = {
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json"
    }

    // Check if user can access a feature
    const canAccess = (right: string) => {
        return userRole === "owner" || (Array.isArray(userRights) && userRights.includes(right))
    }

    // Fetch active event state on load
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
    }, [isAuthorized, adminToken, baseUrl, currentTrend])

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
                        fetchData()
                    }
                }
            } catch { }
        }

        return () => ws.close()
    }, [isAuthorized, currentTrend])

    // Countdown timer
    useEffect(() => {
        if (!activeEventState?.active) return

        const timer = setInterval(() => {
            const remaining = Math.max(0, Math.floor((activeEventState.endTime - Date.now()) / 1000))
            setActiveEventState(prev => prev ? { ...prev, countdown: remaining } : null)
            if (remaining <= 0) {
                setActiveEventState(null)
            }
        }, 1000)

        return () => clearInterval(timer)
    }, [activeEventState?.endTime])

    const fetchData = useCallback(async () => {
        if (!adminToken) return
        try {
            const [sessRes, trendRes, modeRes, eventsRes, volRes] = await Promise.all([
                fetch(`${baseUrl}/v1/admin/sessions`, { headers }),
                fetch(`${baseUrl}/v1/admin/trend`, { headers }),
                fetch(`${baseUrl}/v1/admin/sessions/mode`, { headers }),
                fetch(`${baseUrl}/v1/admin/events`, { headers }),
                fetch(`${baseUrl}/v1/admin/volatility`, { headers })
            ])

            if (!sessRes.ok || !trendRes.ok || !modeRes.ok || !eventsRes.ok) {
                throw new Error("API Error")
            }

            const sessData = await sessRes.json()
            setSessions(sessData || [])
            const active = (sessData || []).find((s: SessionConfig) => s.is_active)
            if (active) setActiveSession(active.id)

            const trendData = await trendRes.json()
            setCurrentTrend(trendData.trend || "random")

            const modeData = await modeRes.json()
            setMode(modeData.mode || "manual")

            const eventsData = await eventsRes.json()
            setEvents(eventsData || [])

            if (volRes.ok) {
                const volData = await volRes.json()
                setVolConfigs(volData.settings || [])
                setVolMode(volData.mode || "auto")
                const activeV = (volData.settings || []).find((v: VolatilityConfig) => v.is_active)
                if (activeV) setActiveVol(activeV.id)
            }

            if (error === "Network Error") setError(null)
        } catch (e) {
            console.error("[ManagePanel] Fetch error:", e)
        } finally {
            setInitialLoad(false)
        }
    }, [baseUrl, adminToken])

    // Fetch panel admins (for owner)
    const fetchAdmins = useCallback(async () => {
        if (!adminToken || userRole !== "owner") return
        try {
            const res = await fetch(`${baseUrl}/v1/admin/panel-admins`, { headers })
            if (res.ok) {
                const data = await res.json()
                setPanelAdmins(data || [])
            }
        } catch (e) {
            console.error("[ManagePanel] Fetch admins error:", e)
        }
    }, [baseUrl, adminToken, userRole])

    useEffect(() => {
        if (isAuthorized && adminToken) {
            fetchData()
            fetchAdmins()
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

                if (activeSession !== targetId) {
                    switchSession(targetId)
                }
            }

            checkAndSwitch()
            const timer = setInterval(checkAndSwitch, 10000)
            return () => clearInterval(timer)
        }
    }, [mode, activeSession, isAuthorized])

    const switchSession = async (sessionId: string) => {
        if (!canAccess("sessions")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/sessions/switch`, {
                method: "POST",
                headers,
                body: JSON.stringify({ session_id: sessionId })
            })
            setActiveSession(sessionId)
            fetchData()
        } catch (e) {
            setError(String(e))
        }
        setLoading(false)
    }

    const setTrend = async (trend: string) => {
        if (!canAccess("trend")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/trend`, {
                method: "POST",
                headers,
                body: JSON.stringify({ trend })
            })
            setCurrentTrend(trend)
        } catch (e) {
            setError(String(e))
        }
        setLoading(false)
    }

    const toggleMode = async () => {
        if (!canAccess("sessions")) return
        const newMode = mode === "auto" ? "manual" : "auto"
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/sessions/mode`, {
                method: "POST",
                headers,
                body: JSON.stringify({ mode: newMode })
            })
            setMode(newMode)
        } catch (e) {
            setError(String(e))
        }
        setLoading(false)
    }

    const switchVolatility = async (volId: string) => {
        if (!canAccess("volatility")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/volatility/activate`, {
                method: "POST",
                headers,
                body: JSON.stringify({ id: volId })
            })
            setActiveVol(volId)
            fetchData()
        } catch (e) {
            setError(String(e))
        }
        setLoading(false)
    }

    const toggleVolMode = async () => {
        if (!canAccess("volatility")) return
        const newMode = volMode === "auto" ? "manual" : "auto"
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/volatility/mode`, {
                method: "POST",
                headers,
                body: JSON.stringify({ mode: newMode })
            })
            setVolMode(newMode)
        } catch (e) {
            setError(String(e))
        }
        setLoading(false)
    }

    const createEvent = async () => {
        if (!canAccess("events")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/events`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    direction: newDirection,
                    duration_seconds: parseInt(newDuration)
                })
            })
            fetchData()
        } catch (e) {
            setError(String(e))
        }
        setLoading(false)
    }

    const cancelEvent = async (id: number) => {
        if (!canAccess("events")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/events/${id}`, {
                method: "DELETE",
                headers
            })
            fetchData()
        } catch (e) {
            setError(String(e))
        }
        setLoading(false)
    }

    // Admin management (owner only)
    const createAdmin = async () => {
        if (userRole !== "owner" || !newAdminTgId || !newAdminName) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/panel-admins`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    telegram_id: parseInt(newAdminTgId),
                    name: newAdminName,
                    rights: newAdminRights
                })
            })
            setNewAdminTgId("")
            setNewAdminName("")
            setNewAdminRights([])
            fetchAdmins()
        } catch (e) {
            setError(String(e))
        }
        setLoading(false)
    }

    const deleteAdmin = async (id: number) => {
        if (userRole !== "owner") return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/panel-admins/${id}`, {
                method: "DELETE",
                headers
            })
            fetchAdmins()
        } catch (e) {
            setError(String(e))
        }
        setLoading(false)
    }

    const toggleAdminRight = (right: string) => {
        if (newAdminRights.includes(right)) {
            setNewAdminRights(newAdminRights.filter(r => r !== right))
        } else {
            setNewAdminRights([...newAdminRights, right])
        }
    }

    const sessionIcons: Record<string, any> = {
        turbo: Zap,
        normal: Timer,
        calm: Gauge
    }

    const sessionSchedule: Record<string, string> = {
        turbo: "09:00 - 13:00",
        normal: "13:00 - 19:00",
        calm: "19:00 - 09:00"
    }

    const trendConfig = [
        { id: "bullish", icon: TrendingUp, label: "Bullish", color: "#16a34a" },
        { id: "bearish", icon: TrendingDown, label: "Bearish", color: "#ef4444" },
        { id: "sideways", icon: Minus, label: "Sideways", color: "#eab308" },
        { id: "random", icon: Shuffle, label: "Random", color: "var(--accent-2)" }
    ]

    // Loading state
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

    // Not authorized - should redirect to 404 but just in case
    if (!isAuthorized) {
        return null
    }

    // Admin Dashboard
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
                                {initialLoad ? (
                                    <Skeleton width={120} height={24} radius={12} />
                                ) : (
                                    <>
                                        <span className={mode === "manual" ? "active" : ""}>Manual</span>
                                        <button
                                            className={`toggle-switch ${mode === "auto" ? "checked" : ""}`}
                                            onClick={toggleMode}
                                            disabled={loading}
                                        >
                                            <span className="toggle-thumb" />
                                        </button>
                                        <span className={mode === "auto" ? "active" : ""}>Auto</span>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="sessions-grid">
                            {initialLoad ? (
                                Array(3).fill(0).map((_, i) => (
                                    <div key={i} className="session-card" style={{ pointerEvents: "none", opacity: 0.7 }}>
                                        <Skeleton width={24} height={24} radius="50%" />
                                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                            <Skeleton width="60%" height={16} />
                                            <Skeleton width="40%" height={12} />
                                        </div>
                                    </div>
                                ))
                            ) : (
                                sessions.map(s => {
                                    const Icon = sessionIcons[s.id] || Timer
                                    const isActive = activeSession === s.id
                                    return (
                                        <button
                                            key={s.id}
                                            className={`session-card ${isActive ? "active" : ""} ${mode === "auto" ? "auto-disabled" : ""}`}
                                            onClick={() => switchSession(s.id)}
                                            disabled={loading || mode === "auto"}
                                            style={{ opacity: mode === "auto" && !isActive ? 0.6 : 1 }}
                                        >
                                            <Icon size={24} />
                                            <span className="session-name">{s.name}</span>
                                            {mode === "auto" ? (
                                                <span className="session-rate" style={{ fontSize: 11 }}>
                                                    {sessionSchedule[s.id] || "All Day"}
                                                </span>
                                            ) : (
                                                <span className="session-rate">{s.update_rate_ms}ms</span>
                                            )}
                                            {isActive && <CheckCircle size={16} className="session-check" />}
                                        </button>
                                    )
                                })
                            )}
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
                                {initialLoad ? (
                                    <Skeleton width={120} height={24} radius={12} />
                                ) : (
                                    <>
                                        <span className={volMode === "manual" ? "active" : ""}>Manual</span>
                                        <button
                                            className={`toggle-switch ${volMode === "auto" ? "checked" : ""}`}
                                            onClick={toggleVolMode}
                                            disabled={loading}
                                        >
                                            <span className="toggle-thumb" />
                                        </button>
                                        <span className={volMode === "auto" ? "active" : ""}>Auto</span>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="sessions-grid">
                            {initialLoad ? (
                                Array(3).fill(0).map((_, i) => (
                                    <div key={i} className="session-card" style={{ pointerEvents: "none", opacity: 0.7 }}>
                                        <Skeleton width={24} height={24} radius="50%" />
                                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                            <Skeleton width="60%" height={16} />
                                            <Skeleton width="40%" height={12} />
                                        </div>
                                    </div>
                                ))
                            ) : (
                                volConfigs.map(v => {
                                    let Icon = Activity
                                    if (v.id === "low") Icon = Moon
                                    if (v.id === "medium") Icon = Sun
                                    if (v.id === "high") Icon = Zap

                                    const isActive = activeVol === v.id
                                    return (
                                        <button
                                            key={v.id}
                                            className={`session-card ${isActive ? "active" : ""} ${volMode === "auto" ? "auto-disabled" : ""}`}
                                            onClick={() => switchVolatility(v.id)}
                                            disabled={loading || volMode === "auto"}
                                            style={{ opacity: volMode === "auto" && !isActive ? 0.6 : 1 }}
                                        >
                                            <Icon size={24} />
                                            <span className="session-name">{v.name}</span>
                                            {volMode === "auto" ? (
                                                <span className="session-rate" style={{ fontSize: 11 }}>
                                                    {v.schedule_start} - {v.schedule_end}
                                                </span>
                                            ) : (
                                                <span className="session-rate">Spread: {v.spread.toExponential(0)}</span>
                                            )}
                                            {isActive && <CheckCircle size={16} className="session-check" />}
                                        </button>
                                    )
                                })
                            )}
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
                            {(initialLoad || eventLoading) ? (
                                Array(4).fill(0).map((_, i) => (
                                    <div key={i} className="trend-btn" style={{ pointerEvents: "none", border: "1px solid var(--border-subtle)" }}>
                                        <Skeleton width={22} height={22} radius="50%" />
                                        <Skeleton width={60} height={14} />
                                    </div>
                                ))
                            ) : (
                                trendConfig.map(t => {
                                    const isEventRunning = activeEventState?.active
                                    const isManualActive = isEventRunning
                                        ? activeEventState.manualTrend === t.id
                                        : currentTrend === t.id
                                    const isEventTrend = isEventRunning && activeEventState.trend === t.id
                                    return (
                                        <button
                                            key={t.id}
                                            className={`trend-btn ${isManualActive ? "active" : ""} ${isEventTrend ? "event-active" : ""} ${isEventRunning ? "event-disabled" : ""}`}
                                            onClick={() => setTrend(t.id)}
                                            disabled={loading || isEventRunning}
                                            style={{
                                                "--trend-color": t.color
                                            } as React.CSSProperties}
                                        >
                                            <t.icon size={22} />
                                            <span>{t.label}</span>
                                            {isEventTrend && activeEventState && (
                                                <span className="event-timer">
                                                    {activeEventState.countdown}s
                                                </span>
                                            )}
                                        </button>
                                    )
                                })
                            )}
                        </div>
                    </div>
                )}

                {/* Price Events Card */}
                {canAccess("events") && (
                    <div className="admin-card full-width">
                        <div className="admin-card-header">
                            <Target size={20} />
                            <h2>Scheduled Price Events</h2>
                        </div>

                        {/* New Event Form */}
                        <div className="event-form">
                            <div className="event-form-row">
                                <div className="event-field">
                                    <label>Direction</label>
                                    <div className="direction-btns">
                                        <button
                                            className={newDirection === "up" ? "active up" : ""}
                                            onClick={() => setNewDirection("up")}
                                        >
                                            <TrendingUp size={16} /> Bullish
                                        </button>
                                        <button
                                            className={newDirection === "down" ? "active down" : ""}
                                            onClick={() => setNewDirection("down")}
                                        >
                                            <TrendingDown size={16} /> Bearish
                                        </button>
                                    </div>
                                </div>
                                <div className="event-field">
                                    <label>Duration</label>
                                    <div className="duration-input">
                                        <input
                                            type="number"
                                            value={newDuration}
                                            onChange={e => setNewDuration(e.target.value)}
                                            placeholder="60"
                                            min="5"
                                        />
                                        <span>sec</span>
                                    </div>
                                </div>
                                <button
                                    className="add-event-btn"
                                    onClick={createEvent}
                                    disabled={loading}
                                >
                                    <Plus size={18} />
                                    <span>Start Event</span>
                                </button>
                            </div>
                        </div>

                        {/* Events List */}
                        <div className="events-list">
                            {initialLoad ? (
                                Array(2).fill(0).map((_, i) => (
                                    <div key={i} className="event-item" style={{ pointerEvents: "none", opacity: 0.7 }}>
                                        <div className="event-info">
                                            <Skeleton width={60} height={20} />
                                            <Skeleton width={40} height={16} />
                                            <Skeleton width={50} height={16} />
                                        </div>
                                        <Skeleton width={24} height={24} radius={4} />
                                    </div>
                                ))
                            ) : events.length === 0 ? (
                                <div className="no-events">
                                    <Calendar size={24} />
                                    <span>No events yet</span>
                                </div>
                            ) : (
                                events.map(evt => (
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
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* Panel Admins Card (Owner only) */}
                {userRole === "owner" && (
                    <div className="admin-card full-width">
                        <div className="admin-card-header">
                            <Shield size={20} />
                            <h2>Panel Administrators</h2>
                        </div>

                        {/* Add Admin Form */}
                        <div className="admin-form">
                            <div className="admin-form-row">
                                <input
                                    type="number"
                                    value={newAdminTgId}
                                    onChange={e => setNewAdminTgId(e.target.value)}
                                    placeholder="Telegram ID"
                                />
                                <input
                                    type="text"
                                    value={newAdminName}
                                    onChange={e => setNewAdminName(e.target.value)}
                                    placeholder="Admin Name"
                                />
                            </div>
                            <div className="admin-rights-row">
                                {allRights.map(right => (
                                    <label key={right} className="right-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={newAdminRights.includes(right)}
                                            onChange={() => toggleAdminRight(right)}
                                        />
                                        {right}
                                    </label>
                                ))}
                            </div>
                            <button
                                className="add-event-btn"
                                onClick={createAdmin}
                                disabled={loading || !newAdminTgId || !newAdminName}
                            >
                                <Plus size={18} />
                                <span>Add Admin</span>
                            </button>
                        </div>

                        {/* Admins List */}
                        <div className="admins-list">
                            {panelAdmins.length === 0 ? (
                                <div className="no-events">
                                    <User size={24} />
                                    <span>No admins yet</span>
                                </div>
                            ) : (
                                panelAdmins.map(admin => (
                                    <div key={admin.id} className="admin-item">
                                        <div className="admin-info">
                                            <User size={20} />
                                            <div>
                                                <span className="admin-name">{admin.name}</span>
                                                <span className="admin-tg">ID: {admin.telegram_id}</span>
                                            </div>
                                        </div>
                                        <div className="admin-rights">
                                            {admin.rights.map(r => (
                                                <span key={r} className="right-badge">{r}</span>
                                            ))}
                                        </div>
                                        <button className="cancel-event-btn" onClick={() => deleteAdmin(admin.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
