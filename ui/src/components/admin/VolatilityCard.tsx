import { Activity, Moon, Zap, CheckCircle } from "lucide-react"
import { VolatilityConfig } from "./types"
import Skeleton from "../Skeleton"

interface VolatilityCardProps {
    configs: VolatilityConfig[]
    activeId: string
    mode: string
    loading: boolean
    initialLoad: boolean
    canAccess: boolean
    onActivate: (id: string) => void
    onToggleMode: () => void
}

export default function VolatilityCard({
    configs, activeId, mode, loading, initialLoad, canAccess,
    onActivate, onToggleMode
}: VolatilityCardProps) {

    if (!canAccess) return null

    return (
        <div className="admin-card">
            <div className="admin-card-header">
                <Activity size={20} />
                <h2>Volatility Profiles</h2>
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
                {initialLoad ? Array(2).fill(0).map((_, i) => (
                    <div key={i} className="session-card" style={{ pointerEvents: "none", opacity: 0.7 }}>
                        <Skeleton width={24} height={24} radius="50%" />
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                            <Skeleton width="60%" height={16} />
                            <Skeleton width="40%" height={12} />
                        </div>
                    </div>
                )) : [...configs].sort((a, b) => {
                    const order: Record<string, number> = { london: 0, newyork: 1 }
                    return (order[a.id] ?? 9) - (order[b.id] ?? 9)
                }).map(v => {
                    let Icon = Activity
                    if (v.id === "london") Icon = Moon
                    if (v.id === "newyork") Icon = Zap
                    const isActive = activeId === v.id
                    return (
                        <button key={v.id} className={`session-card ${isActive ? "active" : ""} ${mode === "auto" ? "auto-disabled" : ""}`}
                            onClick={() => onActivate(v.id)} disabled={loading || mode === "auto"}
                            style={{ opacity: mode === "auto" && !isActive ? 0.6 : 1 }}>
                            <Icon size={24} />
                            <span className="session-name">{v.name}</span>
                            {mode === "auto" ? <span className="session-rate" style={{ fontSize: 11 }}>{v.schedule_start} - {v.schedule_end}</span>
                                : <span className="session-rate">Vol: {v.value.toFixed(5)}</span>}
                            {isActive && <CheckCircle size={16} className="session-check" />}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
