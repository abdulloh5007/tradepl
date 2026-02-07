import { useState, useEffect, useCallback } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import {
    LogOut, Activity, TrendingUp, TrendingDown, Minus, Shuffle,
    Zap, Timer, Gauge, Target, Plus, X, Calendar, Clock,
    Sun, Moon, Settings, CheckCircle, AlertCircle, Users, Shield
} from "lucide-react"
import Skeleton from "../components/Skeleton"
import { NotFoundPage } from "./NotFoundPage"

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
    rights: Record<string, boolean>
    created_at: string
    updated_at: string
}

type TokenInfo = {
    valid: boolean
    token_type: "owner" | "admin"
    telegram_id: number
    expires_at: string
    rights: Record<string, boolean>
}

interface ManagePanelProps {
    baseUrl: string
    theme: "dark" | "light"
    onThemeToggle: () => void
}

export default function ManagePanel({ baseUrl, theme, onThemeToggle }: ManagePanelProps) {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const token = searchParams.get("token")

    // Auth state
    const [validating, setValidating] = useState(true)
    const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null)
    const [authError, setAuthError] = useState(false)

    // Data state
    const [loading, setLoading] = useState(false)
    const [initialLoad, setInitialLoad] = useState(true)
    const [sessions, setSessions] = useState<SessionConfig[]>([])
    const [activeSession, setActiveSession] = useState<string>("")
    const [currentTrend, setCurrentTrend] = useState<string>("random")
    const [mode, setMode] = useState<string>("manual")
    const [events, setEvents] = useState<PriceEvent[]>([])
    const [volConfigs, setVolConfigs] = useState<VolatilityConfig[]>([])
    const [activeVol, setActiveVol] = useState<string>("")
    const [volMode, setVolMode] = useState<string>("auto")
    const [error, setError] = useState<string | null>(null)
    const [panelAdmins, setPanelAdmins] = useState<PanelAdmin[]>([])

    // Event form
    const [newDirection, setNewDirection] = useState<"up" | "down">("up")
    const [newDuration, setNewDuration] = useState("60")

    // Admin form
    const [newAdminTgId, setNewAdminTgId] = useState("")
    const [newAdminName, setNewAdminName] = useState("")
    const [newAdminRights, setNewAdminRights] = useState({
        sessions: false,
        trend: false,
        events: false,
        volatility: false
    })

    // Active event state
    const [activeEventState, setActiveEventState] = useState<{
        active: boolean
        trend: string
        endTime: number
        countdown: number
        manualTrend: string
    } | null>(null)
    const [eventLoading, setEventLoading] = useState(true)

    // Validate token on mount
    useEffect(() => {
        if (!token) {
            setAuthError(true)
            setValidating(false)
            return
        }

        const validateToken = async () => {
            try {
                const res = await fetch(`${baseUrl}/v1/admin/validate-token?token=${token}`)
                if (res.ok) {
                    const data = await res.json()
                    if (data.valid) {
                        setTokenInfo(data)
                    } else {
                        setAuthError(true)
                    }
                } else {
                    setAuthError(true)
                }
            } catch {
                setAuthError(true)
            }
            setValidating(false)
        }
        validateToken()
    }, [token, baseUrl])

    // Fetch data helper
    const headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
    }

    const fetchData = useCallback(async () => {
        if (!tokenInfo) return
        setLoading(true)
        try {
            const rights = tokenInfo.rights

            // Fetch based on rights
            if (rights.sessions) {
                const [sessRes, activeRes, modeRes] = await Promise.all([
                    fetch(`${baseUrl}/v1/admin/sessions`, { headers }),
                    fetch(`${baseUrl}/v1/admin/sessions/active`, { headers }),
                    fetch(`${baseUrl}/v1/admin/sessions/mode`, { headers })
                ])
                if (sessRes.ok) setSessions(await sessRes.json())
                if (activeRes.ok) {
                    const active = await activeRes.json()
                    setActiveSession(active.session_id || "")
                }
                if (modeRes.ok) {
                    const modeData = await modeRes.json()
                    setMode(modeData.mode || "manual")
                }
            }

            if (rights.trend) {
                const trendRes = await fetch(`${baseUrl}/v1/admin/trend`, { headers })
                if (trendRes.ok) {
                    const trend = await trendRes.json()
                    setCurrentTrend(trend.trend_bias || "random")
                }
            }

            if (rights.events) {
                const eventsRes = await fetch(`${baseUrl}/v1/admin/events`, { headers })
                if (eventsRes.ok) setEvents(await eventsRes.json())

                const activeEventRes = await fetch(`${baseUrl}/v1/admin/events/active`, { headers })
                if (activeEventRes.ok) {
                    const data = await activeEventRes.json()
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
            }

            if (rights.volatility) {
                const volRes = await fetch(`${baseUrl}/v1/admin/volatility`, { headers })
                if (volRes.ok) {
                    const volData = await volRes.json()
                    setVolConfigs(volData.configs || [])
                    setActiveVol(volData.active_id || "")
                    setVolMode(volData.mode || "auto")
                }
            }

            // Owner can manage admins
            if (tokenInfo.token_type === "owner") {
                const adminsRes = await fetch(`${baseUrl}/v1/admin/panel-admins`, { headers })
                if (adminsRes.ok) setPanelAdmins(await adminsRes.json())
            }

        } catch (err) {
            setError("Failed to fetch data")
        }
        setLoading(false)
        setInitialLoad(false)
        setEventLoading(false)
    }, [baseUrl, tokenInfo, currentTrend])

    useEffect(() => {
        if (tokenInfo) fetchData()
    }, [tokenInfo, fetchData])

    // WebSocket for event_state
    useEffect(() => {
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
    }, [currentTrend, fetchData])

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
    }, [activeEventState?.active, activeEventState?.endTime])

    // Actions
    const switchSession = async (sessionId: string) => {
        setLoading(true)
        await fetch(`${baseUrl}/v1/admin/sessions/switch`, {
            method: "POST", headers, body: JSON.stringify({ session_id: sessionId })
        })
        await fetchData()
    }

    const setTrend = async (trend: string) => {
        if (activeEventState?.active) return
        setLoading(true)
        await fetch(`${baseUrl}/v1/admin/trend`, {
            method: "POST", headers, body: JSON.stringify({ trend_bias: trend })
        })
        setCurrentTrend(trend)
        setLoading(false)
    }

    const createEvent = async () => {
        setLoading(true)
        await fetch(`${baseUrl}/v1/admin/events`, {
            method: "POST", headers,
            body: JSON.stringify({
                direction: newDirection,
                duration_seconds: parseInt(newDuration),
                scheduled_at: new Date().toISOString()
            })
        })
        await fetchData()
    }

    const cancelEvent = async (id: number) => {
        await fetch(`${baseUrl}/v1/admin/events/${id}`, { method: "DELETE", headers })
        await fetchData()
    }

    const setVolatility = async (volId: string) => {
        setLoading(true)
        await fetch(`${baseUrl}/v1/admin/volatility/activate`, {
            method: "POST", headers, body: JSON.stringify({ volatility_id: volId })
        })
        await fetchData()
    }

    const setVolatilityMode = async (mode: string) => {
        setLoading(true)
        await fetch(`${baseUrl}/v1/admin/volatility/mode`, {
            method: "POST", headers, body: JSON.stringify({ mode })
        })
        setVolMode(mode)
        setLoading(false)
    }

    const createAdmin = async () => {
        const telegramId = parseInt(newAdminTgId)
        if (!telegramId) return
        await fetch(`${baseUrl}/v1/admin/panel-admins`, {
            method: "POST", headers,
            body: JSON.stringify({
                telegram_id: telegramId,
                name: newAdminName,
                rights: newAdminRights
            })
        })
        setNewAdminTgId("")
        setNewAdminName("")
        setNewAdminRights({ sessions: false, trend: false, events: false, volatility: false })
        await fetchData()
    }

    const deleteAdmin = async (id: number) => {
        await fetch(`${baseUrl}/v1/admin/panel-admins/${id}`, { method: "DELETE", headers })
        await fetchData()
    }

    // Show blank screen while validating
    if (validating) {
        return <div className="manage-panel-loading" />
    }

    // Show 404 if auth failed
    if (authError) {
        return <NotFoundPage />
    }

    const isOwner = tokenInfo?.token_type === "owner"
    const rights = tokenInfo?.rights || {}

    const trendConfig = [
        { id: "bullish", label: "Bullish", icon: TrendingUp, color: "#00c853" },
        { id: "bearish", label: "Bearish", icon: TrendingDown, color: "#ff5252" },
        { id: "sideways", label: "Sideways", icon: Minus, color: "#ffab00" },
        { id: "random", label: "Random", icon: Shuffle, color: "#7c4dff" }
    ]

    const volIcons: Record<string, React.ElementType> = { high: Zap, medium: Gauge, low: Timer }

    return (
        <div className="admin-page">
            <header className="admin-header">
                <div className="admin-header-left">
                    <Activity size={24} />
                    <h1>{isOwner ? "👑 Owner Panel" : "👤 Admin Panel"}</h1>
                </div>
                <div className="admin-header-right">
                    <button className="theme-toggle" onClick={onThemeToggle}>
                        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                    <button className="admin-logout-btn" onClick={() => navigate("/")}>
                        <LogOut size={16} />
                        Exit
                    </button>
                </div>
            </header>

            <main className="admin-content">
                {error && <div className="admin-error"><AlertCircle size={16} />{error}</div>}

                {/* Sessions Card */}
                {rights.sessions && (
                    <div className="admin-card">
                        <div className="admin-card-header">
                            <Settings size={20} />
                            <h2>Sessions</h2>
                        </div>
                        <div className="session-grid">
                            {initialLoad ? (
                                Array(3).fill(0).map((_, i) => (
                                    <div key={i} className="session-btn">
                                        <Skeleton width={20} height={20} radius="50%" />
                                        <Skeleton width={60} height={14} />
                                    </div>
                                ))
                            ) : (
                                sessions.map(s => (
                                    <button
                                        key={s.id}
                                        className={`session-btn ${activeSession === s.id ? "active" : ""}`}
                                        onClick={() => switchSession(s.id)}
                                        disabled={loading}
                                    >
                                        {activeSession === s.id && <CheckCircle size={16} />}
                                        {s.name}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* Trend Card */}
                {rights.trend && (
                    <div className="admin-card">
                        <div className="admin-card-header">
                            <TrendingUp size={20} />
                            <h2>Market Trend</h2>
                        </div>
                        <div className={`trend-grid ${activeEventState?.active ? "event-running" : ""}`}>
                            {(initialLoad || eventLoading) ? (
                                Array(4).fill(0).map((_, i) => (
                                    <div key={i} className="trend-btn">
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
                                            style={{ "--trend-color": t.color } as React.CSSProperties}
                                        >
                                            <t.icon size={22} />
                                            <span>{t.label}</span>
                                            {isEventTrend && activeEventState && (
                                                <span className="event-timer">{activeEventState.countdown}s</span>
                                            )}
                                        </button>
                                    )
                                })
                            )}
                        </div>
                    </div>
                )}

                {/* Events Card */}
                {rights.events && (
                    <div className="admin-card full-width">
                        <div className="admin-card-header">
                            <Target size={20} />
                            <h2>Price Events</h2>
                        </div>
                        <div className="event-form">
                            <div className="event-form-row">
                                <div className="event-field">
                                    <label>Direction</label>
                                    <select value={newDirection} onChange={e => setNewDirection(e.target.value as "up" | "down")}>
                                        <option value="up">Bullish</option>
                                        <option value="down">Bearish</option>
                                    </select>
                                </div>
                                <div className="event-field">
                                    <label>Duration (sec)</label>
                                    <input type="number" value={newDuration} onChange={e => setNewDuration(e.target.value)} />
                                </div>
                                <button className="event-create-btn" onClick={createEvent} disabled={loading || activeEventState?.active}>
                                    <Plus size={16} /> Start Event
                                </button>
                            </div>
                        </div>
                        <div className="events-list">
                            {events.length === 0 && !initialLoad && <p className="no-events">No events</p>}
                            {events.map(e => (
                                <div key={e.id} className={`event-item ${e.status}`}>
                                    <div className="event-info">
                                        <span className={`event-direction ${e.direction}`}>
                                            {e.direction === "up" ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                            {e.direction === "up" ? "Bullish" : "Bearish"}
                                        </span>
                                        <span className="event-duration"><Clock size={12} />{e.duration_seconds}s</span>
                                        <span className={`event-status ${e.status}`}>{e.status}</span>
                                    </div>
                                    {e.status === "pending" && (
                                        <button className="event-cancel-btn" onClick={() => cancelEvent(e.id)}><X size={14} /></button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Volatility Card */}
                {rights.volatility && (
                    <div className="admin-card">
                        <div className="admin-card-header">
                            <Gauge size={20} />
                            <h2>Volatility</h2>
                        </div>
                        <div className="volatility-mode">
                            <button className={`mode-btn ${volMode === "auto" ? "active" : ""}`} onClick={() => setVolatilityMode("auto")}>
                                Auto
                            </button>
                            <button className={`mode-btn ${volMode === "manual" ? "active" : ""}`} onClick={() => setVolatilityMode("manual")}>
                                Manual
                            </button>
                        </div>
                        <div className="volatility-grid">
                            {volConfigs.map(v => {
                                const Icon = volIcons[v.id] || Gauge
                                return (
                                    <button
                                        key={v.id}
                                        className={`volatility-btn ${activeVol === v.id ? "active" : ""}`}
                                        onClick={() => setVolatility(v.id)}
                                        disabled={loading || volMode === "auto"}
                                    >
                                        <Icon size={20} />
                                        <span>{v.name}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Panel Admins - Owner Only */}
                {isOwner && (
                    <div className="admin-card full-width">
                        <div className="admin-card-header">
                            <Users size={20} />
                            <h2>Panel Admins</h2>
                        </div>
                        <div className="admin-form">
                            <div className="admin-form-row">
                                <input
                                    type="text"
                                    placeholder="Telegram ID"
                                    value={newAdminTgId}
                                    onChange={e => setNewAdminTgId(e.target.value)}
                                />
                                <input
                                    type="text"
                                    placeholder="Name"
                                    value={newAdminName}
                                    onChange={e => setNewAdminName(e.target.value)}
                                />
                            </div>
                            <div className="admin-rights-row">
                                {Object.keys(newAdminRights).map(key => (
                                    <label key={key} className="right-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={newAdminRights[key as keyof typeof newAdminRights]}
                                            onChange={e => setNewAdminRights({ ...newAdminRights, [key]: e.target.checked })}
                                        />
                                        {key.charAt(0).toUpperCase() + key.slice(1)}
                                    </label>
                                ))}
                            </div>
                            <button className="event-create-btn" onClick={createAdmin}>
                                <Plus size={16} /> Add Admin
                            </button>
                        </div>
                        <div className="admins-list">
                            {panelAdmins.length === 0 && <p className="no-events">No admins</p>}
                            {panelAdmins.map(a => (
                                <div key={a.id} className="admin-item">
                                    <div className="admin-info">
                                        <Shield size={16} />
                                        <span className="admin-name">{a.name || `ID: ${a.telegram_id}`}</span>
                                        <span className="admin-tg">@{a.telegram_id}</span>
                                    </div>
                                    <div className="admin-rights">
                                        {Object.entries(a.rights).filter(([_, v]) => v).map(([k]) => (
                                            <span key={k} className="right-badge">{k}</span>
                                        ))}
                                    </div>
                                    <button className="event-cancel-btn" onClick={() => deleteAdmin(a.id)}>
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}
