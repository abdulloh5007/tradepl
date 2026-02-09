import { useEffect, useState } from "react"
import { TrendingUp, TrendingDown, Minus, Shuffle } from "lucide-react"
import Skeleton from "../Skeleton"

interface TrendCardProps {
    currentTrend: string
    mode: string
    autoTrendState: {
        active: boolean
        trend: string
        session_id: string
        next_switch_at: number
        remaining_sec: number
    } | null
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
    onSetTrend: (trend: string, durationSeconds?: number) => void
    onToggleMode: () => void
}

export default function TrendCard({
    currentTrend, mode, autoTrendState, activeEventState, loading, initialLoad, eventLoading, canAccess,
    onSetTrend, onToggleMode
}: TrendCardProps) {

    if (!canAccess) return null

    const [autoCountdown, setAutoCountdown] = useState<number | null>(null)
    const [impulseDuration, setImpulseDuration] = useState<180 | 300>(180)

    const formatCountdown = (seconds: number) => {
        const safe = Math.max(0, Math.floor(seconds))
        const mm = Math.floor(safe / 60)
        const ss = safe % 60
        return `${mm}:${String(ss).padStart(2, "0")}`
    }

    useEffect(() => {
        if (mode !== "auto" || !autoTrendState?.active || !autoTrendState.next_switch_at) {
            setAutoCountdown(null)
            return
        }
        const update = () => {
            const nextMs = autoTrendState.next_switch_at || 0
            const left = Math.max(0, Math.ceil((nextMs - Date.now()) / 1000))
            setAutoCountdown(left)
        }
        update()
        const timer = window.setInterval(update, 1000)
        return () => window.clearInterval(timer)
    }, [mode, autoTrendState?.active, autoTrendState?.next_switch_at])

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
                <div className="mode-toggle">
                    {initialLoad ? <Skeleton width={120} height={24} radius={12} /> : (
                        <>
                            <span className={mode === "manual" ? "active" : ""}>Manual</span>
                            <button className={`toggle-switch ${mode === "auto" ? "checked" : ""}`} onClick={onToggleMode} disabled={loading || !!activeEventState?.active}>
                                <span className="toggle-thumb" />
                            </button>
                            <span className={mode === "auto" ? "active" : ""}>Auto</span>
                        </>
                    )}
                </div>
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
                    const showAutoTimer = !isEventRunning && mode === "auto" && isManualActive && autoTrendState?.active && autoCountdown !== null
                    return (
                        <button key={t.id}
                            className={`trend-btn ${isManualActive ? "active" : ""} ${isEventTrend ? "event-active" : ""} ${(isEventRunning || mode === "auto") ? "event-disabled" : ""}`}
                            onClick={() => onSetTrend(t.id, t.id === "bullish" || t.id === "bearish" ? impulseDuration : undefined)}
                            disabled={loading || isEventRunning || mode === "auto"}
                            style={{ "--trend-color": t.color } as React.CSSProperties}>
                            <t.icon size={22} />
                            <span>{t.label}</span>
                            {isEventTrend && activeEventState && <span className="event-timer">{formatCountdown(activeEventState.countdown)}</span>}
                            {showAutoTimer && <span className="event-timer">{formatCountdown(autoCountdown)}</span>}
                        </button>
                    )
                })}
            </div>
            {!initialLoad && !eventLoading && mode === "manual" && !activeEventState?.active && (
                <div className="mode-toggle" style={{ marginTop: 10 }}>
                    <span className={impulseDuration === 180 ? "active" : ""}>3m</span>
                    <button
                        className={`toggle-switch ${impulseDuration === 300 ? "checked" : ""}`}
                        onClick={() => setImpulseDuration(prev => prev === 180 ? 300 : 180)}
                        disabled={loading}
                    >
                        <span className="toggle-thumb" />
                    </button>
                    <span className={impulseDuration === 300 ? "active" : ""}>5m</span>
                </div>
            )}
        </div>
    )
}
