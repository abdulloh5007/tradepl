import { useState, useEffect, useCallback } from "react"
import {
    LogIn, LogOut, Activity, TrendingUp, TrendingDown, Minus, Shuffle,
    Zap, Timer, Gauge, Target, Plus, X, Calendar, Clock,
    Sun, Moon, Settings, CheckCircle, AlertCircle, Wifi, WifiOff
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

type PriceEvent = {
    id: number
    target_price: number
    direction: string
    duration_seconds: number
    scheduled_at: string
    status: string
}

interface AdminPageProps {
    baseUrl: string
    theme: "dark" | "light"
    onThemeToggle: () => void
}

export default function AdminPage({ baseUrl, theme, onThemeToggle }: AdminPageProps) {
    const [isLoggedIn, setIsLoggedIn] = useState(false)
    const [token, setToken] = useState<string | null>(null)
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [loginError, setLoginError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [initialLoad, setInitialLoad] = useState(true)

    // Connection state
    const [isOffline, setIsOffline] = useState(false)
    const [showOnlineToast, setShowOnlineToast] = useState(false)

    // Admin data
    const [sessions, setSessions] = useState<SessionConfig[]>([])
    const [activeSession, setActiveSession] = useState<string>("")
    const [currentTrend, setCurrentTrend] = useState<string>("random")
    const [mode, setMode] = useState<string>("manual")
    const [events, setEvents] = useState<PriceEvent[]>([])
    const [error, setError] = useState<string | null>(null)

    // New event form
    const [newTargetPrice, setNewTargetPrice] = useState("")
    const [newDirection, setNewDirection] = useState<"up" | "down">("up")
    const [newDuration, setNewDuration] = useState("300")

    // Check for stored token on mount
    useEffect(() => {
        const storedToken = localStorage.getItem("admin_token")
        if (storedToken) {
            setToken(storedToken)
            setIsLoggedIn(true)
        }
    }, [])

    const headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
    }

    const fetchData = useCallback(async () => {
        if (!token) return
        try {
            // Parallel fetches for efficiency and unified error handling
            const [sessRes, trendRes, modeRes, eventsRes] = await Promise.all([
                fetch(`${baseUrl}/v1/admin/sessions`, { headers }),
                fetch(`${baseUrl}/v1/admin/trend`, { headers }),
                fetch(`${baseUrl}/v1/admin/sessions/mode`, { headers }),
                fetch(`${baseUrl}/v1/admin/events`, { headers })
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

            // Connection restored
            if (isOffline) {
                setIsOffline(false)
                setShowOnlineToast(true)
                setTimeout(() => setShowOnlineToast(false), 3000)
            }
            if (error === "Network Error") setError(null)

        } catch (e) {
            // Handle offline state
            if (!isOffline) {
                setIsOffline(true)
                // Only log if not already offline to avoid spam
                console.warn("[Admin] Connection lost:", e)
            }
        } finally {
            setInitialLoad(false)
        }
    }, [baseUrl, token, isOffline])

    useEffect(() => {
        if (isLoggedIn && token) {
            fetchData()
            const interval = setInterval(fetchData, 5000)
            return () => clearInterval(interval)
        }
    }, [isLoggedIn, token, fetchData])

    // Auto Session Switching
    useEffect(() => {
        if (mode === "auto" && isLoggedIn && activeSession) {
            const checkAndSwitch = () => {
                const hour = new Date().getHours()
                let targetId = "calm"
                if (hour >= 9 && hour < 13) targetId = "turbo"
                else if (hour >= 13 && hour < 19) targetId = "normal"

                if (activeSession !== targetId) {
                    console.log(`[Auto] Switching from ${activeSession} to ${targetId}`)
                    switchSession(targetId)
                }
            }

            checkAndSwitch()
            const timer = setInterval(checkAndSwitch, 10000) // Check every 10s
            return () => clearInterval(timer)
        }
    }, [mode, activeSession, isLoggedIn])

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setLoginError(null)
        try {
            const res = await fetch(`${baseUrl}/v1/admin/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            })
            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error || "Login failed")
            }
            localStorage.setItem("admin_token", data.token)
            setToken(data.token)
            setIsLoggedIn(true)
            setPassword("")
        } catch (e: any) {
            setLoginError(e.message || "Login failed")
        }
        setLoading(false)
    }

    const handleLogout = () => {
        localStorage.removeItem("admin_token")
        setToken(null)
        setIsLoggedIn(false)
        setSessions([])
        setEvents([])
        setInitialLoad(true)
    }

    const switchSession = async (sessionId: string) => {
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

    const createEvent = async () => {
        if (!newTargetPrice) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/events`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    target_price: parseFloat(newTargetPrice),
                    direction: newDirection,
                    duration_seconds: parseInt(newDuration)
                })
            })
            setNewTargetPrice("")
            fetchData()
        } catch (e) {
            setError(String(e))
        }
        setLoading(false)
    }

    const cancelEvent = async (id: number) => {
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

    // Login Page
    if (!isLoggedIn) {
        return (
            <div className="admin-login-wrapper">
                <div className="admin-login-card">
                    <div className="admin-login-header">
                        <Settings size={48} className="admin-logo-icon" />
                        <h1>Admin Panel</h1>
                        <p>Enter your credentials to continue</p>
                    </div>

                    <form onSubmit={handleLogin} className="admin-login-form">
                        {loginError && (
                            <div className="admin-error">
                                <AlertCircle size={16} />
                                <span>{loginError}</span>
                            </div>
                        )}

                        <div className="admin-field">
                            <label>Username</label>
                            <input
                                type="text"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                placeholder="admin"
                                required
                            />
                        </div>

                        <div className="admin-field">
                            <label>Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        <button type="submit" className="admin-login-btn" disabled={loading}>
                            <LogIn size={18} />
                            <span>{loading ? "Signing in..." : "Sign In"}</span>
                        </button>
                    </form>


                </div>
            </div>
        )
    }

    // Admin Dashboard
    return (
        <div className="admin-dashboard">
            {/* Connection Status Banners */}
            {isOffline && (
                <div style={{
                    position: "fixed",
                    top: 24,
                    right: 24,
                    zIndex: 200,
                    background: "#ef4444",
                    color: "white",
                    padding: "12px 20px",
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    boxShadow: "0 8px 20px rgba(239, 68, 68, 0.3)",
                    fontWeight: 600,
                    fontSize: 14,
                    border: "1px solid rgba(255,255,255,0.2)"
                }}>
                    <WifiOff size={20} />
                    <span>Offline mode. Trying to reconnect...</span>
                </div>
            )}
            {showOnlineToast && (
                <div style={{
                    position: "fixed",
                    top: 24,
                    right: 24,
                    zIndex: 200,
                    background: "#16a34a",
                    color: "white",
                    padding: "12px 20px",
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    boxShadow: "0 8px 20px rgba(22, 163, 74, 0.3)",
                    fontWeight: 600,
                    fontSize: 14,
                    border: "1px solid rgba(255,255,255,0.2)"
                }}>
                    <Wifi size={20} />
                    <span>Back Online</span>
                    <CheckCircle size={16} fill="white" color="#16a34a" />
                </div>
            )}

            {/* Header */}
            <header className="admin-header">
                <div className="admin-header-left">
                    <Settings size={28} />
                    <h1>Admin Control Panel</h1>
                </div>
                <div className="admin-header-right">
                    <button onClick={onThemeToggle} className="icon-btn">
                        {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                    <button onClick={handleLogout} className="logout-btn">
                        <LogOut size={18} />
                        <span>Logout</span>
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

                {/* Trend Card */}
                <div className="admin-card">
                    <div className="admin-card-header">
                        <TrendingUp size={20} />
                        <h2>Market Trend</h2>
                    </div>
                    <div className="trend-grid">
                        {initialLoad ? (
                            Array(4).fill(0).map((_, i) => (
                                <div key={i} className="trend-btn" style={{ pointerEvents: "none", border: "1px solid var(--border-subtle)" }}>
                                    <Skeleton width={22} height={22} radius="50%" />
                                    <Skeleton width={60} height={14} />
                                </div>
                            ))
                        ) : (
                            trendConfig.map(t => {
                                const isActive = currentTrend === t.id
                                return (
                                    <button
                                        key={t.id}
                                        className={`trend-btn ${isActive ? "active" : ""}`}
                                        onClick={() => setTrend(t.id)}
                                        disabled={loading}
                                        style={{ "--trend-color": t.color } as React.CSSProperties}
                                    >
                                        <t.icon size={22} />
                                        <span>{t.label}</span>
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>

                {/* Price Events Card */}
                <div className="admin-card full-width">
                    <div className="admin-card-header">
                        <Target size={20} />
                        <h2>Scheduled Price Events</h2>
                    </div>

                    {/* New Event Form */}
                    <div className="event-form">
                        <div className="event-form-row">
                            <div className="event-field">
                                <label>Target Price</label>
                                <input
                                    type="number"
                                    value={newTargetPrice}
                                    onChange={e => setNewTargetPrice(e.target.value)}
                                    placeholder="12900"
                                />
                            </div>
                            <div className="event-field">
                                <label>Direction</label>
                                <div className="direction-btns">
                                    <button
                                        className={newDirection === "up" ? "active up" : ""}
                                        onClick={() => setNewDirection("up")}
                                    >
                                        <TrendingUp size={16} /> Up
                                    </button>
                                    <button
                                        className={newDirection === "down" ? "active down" : ""}
                                        onClick={() => setNewDirection("down")}
                                    >
                                        <TrendingDown size={16} /> Down
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
                                        placeholder="300"
                                    />
                                    <span>sec</span>
                                </div>
                            </div>
                            <button
                                className="add-event-btn"
                                onClick={createEvent}
                                disabled={loading || !newTargetPrice}
                            >
                                <Plus size={18} />
                                <span>Add Event</span>
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
                                <span>No scheduled events</span>
                            </div>
                        ) : (
                            events.map(evt => (
                                <div key={evt.id} className={`event-item ${evt.status}`}>
                                    <div className="event-info">
                                        <span className="event-price">{evt.target_price.toFixed(2)}</span>
                                        <span className={`event-direction ${evt.direction}`}>
                                            {evt.direction === "up" ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                            {evt.direction}
                                        </span>
                                        <span className="event-duration">
                                            <Clock size={14} />
                                            {Math.floor(evt.duration_seconds / 60)}m {evt.duration_seconds % 60}s
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
            </div>
        </div>
    )
}
