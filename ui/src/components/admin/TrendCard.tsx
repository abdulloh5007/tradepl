import { TrendingUp, TrendingDown, Minus, Shuffle } from "lucide-react"
import Skeleton from "../Skeleton"

interface TrendCardProps {
    currentTrend: string
    activeEventState: {
        active: boolean
        trend: string
        endTime: number
        countdown: number
        manualTrend: string
    } | null
    loading: boolean
    initialLoad: boolean
    eventLoading: boolean
    canAccess: boolean
    onSetTrend: (trend: string) => void
}

export default function TrendCard({
    currentTrend, activeEventState, loading, initialLoad, eventLoading, canAccess,
    onSetTrend
}: TrendCardProps) {

    if (!canAccess) return null

    const trendConfig = [
        { id: "bullish", icon: TrendingUp, label: "Bullish", color: "#16a34a" },
        { id: "bearish", icon: TrendingDown, label: "Bearish", color: "#ef4444" },
        { id: "sideways", icon: Minus, label: "Sideways", color: "#eab308" },
        { id: "random", icon: Shuffle, label: "Random", color: "var(--accent-2)" }
    ]

    return (
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
                            onClick={() => onSetTrend(t.id)} disabled={loading || isEventRunning}
                            style={{ "--trend-color": t.color } as React.CSSProperties}>
                            <t.icon size={22} />
                            <span>{t.label}</span>
                            {isEventTrend && activeEventState && <span className="event-timer">{activeEventState.countdown}s</span>}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
