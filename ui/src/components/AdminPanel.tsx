import { useState, useEffect, useCallback } from "react"

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

interface AdminPanelProps {
    baseUrl: string
    internalToken: string
}

export default function AdminPanel({ baseUrl, internalToken }: AdminPanelProps) {
    const [sessions, setSessions] = useState<SessionConfig[]>([])
    const [activeSession, setActiveSession] = useState<string>("")
    const [currentTrend, setCurrentTrend] = useState<string>("random")
    const [mode, setMode] = useState<string>("manual")
    const [events, setEvents] = useState<PriceEvent[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // New event form
    const [newTargetPrice, setNewTargetPrice] = useState("")
    const [newDirection, setNewDirection] = useState<"up" | "down">("up")
    const [newDuration, setNewDuration] = useState("300")

    const headers = {
        "Authorization": `Bearer ${internalToken}`,
        "Content-Type": "application/json"
    }

    const fetchData = useCallback(async () => {
        try {
            // Fetch sessions
            const sessRes = await fetch(`${baseUrl}/v1/admin/sessions`, { headers })
            if (sessRes.ok) {
                const data = await sessRes.json()
                setSessions(data || [])
                const active = (data || []).find((s: SessionConfig) => s.is_active)
                if (active) setActiveSession(active.id)
            }

            // Fetch trend
            const trendRes = await fetch(`${baseUrl}/v1/admin/trend`, { headers })
            if (trendRes.ok) {
                const data = await trendRes.json()
                setCurrentTrend(data.trend || "random")
            }

            // Fetch mode
            const modeRes = await fetch(`${baseUrl}/v1/admin/sessions/mode`, { headers })
            if (modeRes.ok) {
                const data = await modeRes.json()
                setMode(data.mode || "manual")
            }

            // Fetch events
            const eventsRes = await fetch(`${baseUrl}/v1/admin/events`, { headers })
            if (eventsRes.ok) {
                const data = await eventsRes.json()
                setEvents(data || [])
            }
        } catch (e) {
            setError(String(e))
        }
    }, [baseUrl, internalToken])

    useEffect(() => {
        fetchData()
        const interval = setInterval(fetchData, 5000)
        return () => clearInterval(interval)
    }, [fetchData])

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

    return (
        <div className="panel admin-panel">
            <div className="panel-head">
                <h3 className="panel-title">🎛️ Admin Control</h3>
                <div className="switcher">
                    <span>{mode === "auto" ? "Auto" : "Manual"}</span>
                    <button className="switch-root" data-state={mode === "auto" ? "checked" : "unchecked"} onClick={toggleMode} disabled={loading}>
                        <span className="switch-thumb" />
                    </button>
                </div>
            </div>

            {error && <div className="error-msg" style={{ color: "#ef4444", marginBottom: 12 }}>{error}</div>}

            {/* Sessions */}
            <div className="admin-section">
                <h4>📊 Session</h4>
                <div className="btn-group" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {sessions.map(s => (
                        <button
                            key={s.id}
                            className={`ghost ${activeSession === s.id ? "active" : ""}`}
                            onClick={() => switchSession(s.id)}
                            disabled={loading}
                            style={{
                                background: activeSession === s.id ? "var(--accent-2)" : undefined,
                                color: activeSession === s.id ? "#fff" : undefined
                            }}
                        >
                            {s.name}
                            <span style={{ fontSize: 10, opacity: 0.7, display: "block" }}>
                                {s.update_rate_ms}ms
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Trend */}
            <div className="admin-section" style={{ marginTop: 16 }}>
                <h4>📈 Trend</h4>
                <div className="btn-group" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["bullish", "bearish", "sideways", "random"].map(t => (
                        <button
                            key={t}
                            className={`ghost ${currentTrend === t ? "active" : ""}`}
                            onClick={() => setTrend(t)}
                            disabled={loading}
                            style={{
                                background: currentTrend === t ? (t === "bullish" ? "#16a34a" : t === "bearish" ? "#ef4444" : "var(--accent-2)") : undefined,
                                color: currentTrend === t ? "#fff" : undefined
                            }}
                        >
                            {t === "bullish" ? "↑ Bull" : t === "bearish" ? "↓ Bear" : t === "sideways" ? "→ Side" : "⟳ Random"}
                        </button>
                    ))}
                </div>
            </div>

            {/* Price Events */}
            <div className="admin-section" style={{ marginTop: 16 }}>
                <h4>🎯 Price Events</h4>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                    <input
                        type="number"
                        placeholder="Target price"
                        value={newTargetPrice}
                        onChange={e => setNewTargetPrice(e.target.value)}
                        style={{ width: 100, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-alt)" }}
                    />
                    <select
                        value={newDirection}
                        onChange={e => setNewDirection(e.target.value as "up" | "down")}
                        className="select-compact"
                    >
                        <option value="up">↑ Up</option>
                        <option value="down">↓ Down</option>
                    </select>
                    <input
                        type="number"
                        placeholder="Duration (sec)"
                        value={newDuration}
                        onChange={e => setNewDuration(e.target.value)}
                        style={{ width: 80, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-alt)" }}
                    />
                    <button className="primary" onClick={createEvent} disabled={loading || !newTargetPrice}>
                        + Add
                    </button>
                </div>

                {events.length > 0 ? (
                    <div className="events-list">
                        {events.map(evt => (
                            <div
                                key={evt.id}
                                className="event-item"
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "8px 12px",
                                    marginBottom: 6,
                                    borderRadius: 8,
                                    background: "var(--panel-alt)",
                                    border: "1px solid var(--border)"
                                }}
                            >
                                <div>
                                    <span style={{ fontWeight: 600 }}>{evt.target_price.toFixed(2)}</span>
                                    <span style={{ marginLeft: 8, color: evt.direction === "up" ? "#16a34a" : "#ef4444" }}>
                                        {evt.direction === "up" ? "↑" : "↓"}
                                    </span>
                                    <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)" }}>
                                        {Math.floor(evt.duration_seconds / 60)}min
                                    </span>
                                    <span className="tag" style={{ marginLeft: 8 }}>{evt.status}</span>
                                </div>
                                {evt.status === "pending" && (
                                    <button
                                        onClick={() => cancelEvent(evt.id)}
                                        style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 16 }}
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ color: "var(--muted)", fontSize: 13 }}>No scheduled events</div>
                )}
            </div>
        </div>
    )
}
