import { Activity, Zap, Timer, Gauge, CheckCircle } from "lucide-react"
import { SessionConfig } from "./types"
import Skeleton from "../Skeleton"

interface SessionsCardProps {
    sessions: SessionConfig[]
    activeSession: string
    mode: string
    loading: boolean
    initialLoad: boolean
    canAccess: boolean
    onSwitchSession: (id: string) => void
    onToggleMode: () => void
}

export default function SessionsCard({
    sessions, activeSession, mode, loading, initialLoad, canAccess,
    onSwitchSession, onToggleMode
}: SessionsCardProps) {

    if (!canAccess) return null

    const sessionIcons: Record<string, any> = { turbo: Zap, normal: Timer, calm: Gauge }
    const sessionSchedule: Record<string, string> = { turbo: "09:00 - 13:00", normal: "13:00 - 19:00", calm: "19:00 - 09:00" }

    return (
        <div className="admin-card">
            <div className="admin-card-header">
                <Activity size={20} />
                <h2>Trading Sessions</h2>
                <div className="mode-toggle">
                    {initialLoad ? <Skeleton width={120} height={24} radius={12} /> : (
                        <>
                            <span className={mode === "manual" ? "active" : ""}>Manual</span>
                            <button className={`toggle-switch ${mode === "auto" ? "checked" : ""}`} onClick={onToggleMode} disabled={loading}>
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
                            onClick={() => onSwitchSession(s.id)} disabled={loading || mode === "auto"}
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
    )
}
