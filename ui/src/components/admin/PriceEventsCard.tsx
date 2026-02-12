import { useState } from "react"
import { TrendingUp, TrendingDown, Clock, X, Loader2, Plus, Filter, Calendar, Target } from "lucide-react"
import { PriceEvent, FilterType } from "./types"
import Skeleton from "../Skeleton"

interface PriceEventsCardProps {
    events: PriceEvent[]
    total: number
    loading: boolean
    initialLoad: boolean
    canAccess: boolean

    // Filter State (Controlled)
    filterType: FilterType
    customDateFrom: Date | null
    customDateTo: Date | null

    // Actions
    onCreate: (direction: string, duration: number, scheduledAt: string) => Promise<void>
    onCancel: (id: number) => Promise<void>
    onLoadMore: () => void
    onFilterChange: (type: FilterType, from?: Date, to?: Date) => void
}

const toLocalInputValue = (date: Date) => {
    const d = new Date(date)
    d.setSeconds(0, 0)
    const pad = (n: number) => String(n).padStart(2, "0")
    const yyyy = d.getFullYear()
    const mm = pad(d.getMonth() + 1)
    const dd = pad(d.getDate())
    const hh = pad(d.getHours())
    const min = pad(d.getMinutes())
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`
}

const defaultScheduleInput = () => {
    const now = new Date()
    now.setMinutes(now.getMinutes() + 5)
    return toLocalInputValue(now)
}

const formatScheduledAt = (raw: string) => {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return "—"
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function PriceEventsCard({
    events, total, loading, initialLoad, canAccess,
    filterType, customDateFrom, customDateTo,
    onCreate, onCancel, onLoadMore, onFilterChange
}: PriceEventsCardProps) {

    const [showFilterModal, setShowFilterModal] = useState(false)
    const [newDirection, setNewDirection] = useState<"up" | "down">("up")
    const [newDuration, setNewDuration] = useState("60")
    const [newScheduledAt, setNewScheduledAt] = useState(defaultScheduleInput)
    const [isCreating, setIsCreating] = useState(false)

    // Check if mobile (simple check)
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768

    const filterLabels: Record<FilterType, string> = {
        "1d": "1 день",
        "3d": "3 дня",
        "1w": "1 неделя",
        "1m": "1 месяц",
        "custom": "Выбрать"
    }

    if (!canAccess) return null

    const handleCreate = async () => {
        const scheduled = newScheduledAt ? new Date(newScheduledAt) : new Date()
        const scheduledISO = Number.isNaN(scheduled.getTime()) ? new Date().toISOString() : scheduled.toISOString()
        setIsCreating(true)
        await onCreate(newDirection, parseInt(newDuration), scheduledISO)
        setIsCreating(false)
    }

    const handleFilterSelect = (type: FilterType) => {
        if (type === "custom") return // Just activate input

        // This will update parent state
        onFilterChange(type, undefined, undefined)
        setShowFilterModal(false)
    }

    const applyCustomFilter = () => {
        if (customDateFrom) {
            let to = customDateTo
            if (!to) {
                const today = new Date()
                today.setHours(23, 59, 59, 999)
                to = today
            }
            onFilterChange("custom", customDateFrom || undefined, to || undefined)
            setShowFilterModal(false)
        }
    }

    const hasMoreEvents = events.length < total

    return (
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
                    <div className="event-field">
                        <label>Start Time</label>
                        <input
                            type="datetime-local"
                            value={newScheduledAt}
                            onChange={e => setNewScheduledAt(e.target.value)}
                        />
                    </div>
                    <button className="add-event-btn" onClick={handleCreate} disabled={loading || isCreating}>
                        {isCreating ? <Loader2 className="spin" /> : <Plus size={18} />}
                        <span>Schedule Event</span>
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
                            <span className="event-duration event-scheduled">
                                <Calendar size={14} />
                                {formatScheduledAt(evt.scheduled_at)}
                            </span>
                            <span className={`event-status ${evt.status}`}>{evt.status}</span>
                            {evt.source === "auto" && (
                                <span className="event-status pending">auto</span>
                            )}
                        </div>
                        {evt.status === "pending" && evt.source !== "auto" && evt.id > 0 && (
                            <button className="cancel-event-btn" onClick={() => onCancel(evt.id)}>
                                <X size={16} />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {hasMoreEvents && (
                <button className="load-more-btn" onClick={onLoadMore} disabled={loading}>
                    {loading ? <Loader2 size={18} className="spin" /> : <Plus size={18} />}
                    <span>{loading ? "Загрузка..." : `Загрузить ещё (${events.length}/${total})`}</span>
                </button>
            )}

            {/* Filter Modal */}
            {showFilterModal && (
                <>
                    <div className="filter-overlay" onClick={() => setShowFilterModal(false)} />
                    <div className={`filter-modal ${isMobile ? "swiper" : ""}`}>
                        <div className="filter-header">
                            <h3>Events Filter</h3>
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
                            <h4>Custom Range</h4>
                            <div className="date-range-inputs">
                                <div className="date-input-group">
                                    <label>From</label>
                                    <input type="date" value={customDateFrom ? customDateFrom.toISOString().split('T')[0] : ''}
                                        onChange={e => onFilterChange("custom", e.target.value ? new Date(e.target.value) : undefined, customDateTo || undefined)} />
                                </div>
                                <div className="date-input-group">
                                    <label>To (Optional)</label>
                                    <input type="date" value={customDateTo ? customDateTo.toISOString().split('T')[0] : ''}
                                        onChange={e => onFilterChange("custom", customDateFrom || undefined, e.target.value ? new Date(e.target.value + 'T23:59:59') : undefined)}
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
        </div>
    )
}
