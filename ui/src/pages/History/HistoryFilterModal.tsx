import { useState } from "react"
import { X, Calendar } from "lucide-react"
import "../../components/accounts/SharedAccountSheet.css"

export type DateRange = {
    type: "today" | "week" | "month" | "custom"
    startDate?: string // YYYY-MM-DD
    endDate?: string   // YYYY-MM-DD
}

interface HistoryFilterModalProps {
    open: boolean
    currentRange: DateRange
    onClose: () => void
    onApply: (range: DateRange) => void
}

export default function HistoryFilterModal({ open, currentRange, onClose, onApply }: HistoryFilterModalProps) {
    const [rangeType, setRangeType] = useState<DateRange["type"]>(currentRange.type)
    const [startDate, setStartDate] = useState(currentRange.startDate || "")
    const [endDate, setEndDate] = useState(currentRange.endDate || "")

    if (!open) return null

    const handleApply = () => {
        onApply({
            type: rangeType,
            startDate: rangeType === "custom" ? startDate : undefined,
            endDate: rangeType === "custom" ? endDate : undefined
        })
        onClose()
    }

    return (
        <div className="acm-overlay" style={{ zIndex: 200 }}>
            <div className="acm-backdrop" onClick={onClose} />
            <div className="acm-sheet">
                <div className="acm-header">
                    <button onClick={onClose} className="acm-close-btn">
                        <X size={24} />
                    </button>
                    <h2 className="acm-title">Filter History</h2>
                    <div className="acm-spacer" />
                </div>

                <div className="acm-content">
                    <div className="acm-list">
                        <button
                            className={`acm-list-item ${rangeType === "today" ? "active" : ""}`}
                            onClick={() => setRangeType("today")}
                        >
                            <span>Today</span>
                            {rangeType === "today" && <span style={{ color: '#fbbf24' }}>✓</span>}
                        </button>
                        <button
                            className={`acm-list-item ${rangeType === "week" ? "active" : ""}`}
                            onClick={() => setRangeType("week")}
                        >
                            <span>Last Week</span>
                            {rangeType === "week" && <span style={{ color: '#fbbf24' }}>✓</span>}
                        </button>
                        <button
                            className={`acm-list-item ${rangeType === "month" ? "active" : ""}`}
                            onClick={() => setRangeType("month")}
                        >
                            <span>Last Month</span>
                            {rangeType === "month" && <span style={{ color: '#fbbf24' }}>✓</span>}
                        </button>
                        <button
                            className={`acm-list-item ${rangeType === "custom" ? "active" : ""}`}
                            onClick={() => setRangeType("custom")}
                        >
                            <span>Custom Period</span>
                            {rangeType === "custom" && <span style={{ color: '#fbbf24' }}>✓</span>}
                        </button>

                        {rangeType === "custom" && (
                            <div className="acm-form" style={{ padding: '8px 0', gap: 12 }}>
                                <label className="acm-label">
                                    Start Date
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type="date"
                                            className="acm-input"
                                            style={{ width: '100%' }}
                                            value={startDate}
                                            onChange={e => setStartDate(e.target.value)}
                                        />
                                        <Calendar size={18} style={{ position: 'absolute', right: 12, top: 14, color: '#9ca3af', pointerEvents: 'none' }} />
                                    </div>
                                </label>
                                <label className="acm-label">
                                    End Date
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type="date"
                                            className="acm-input"
                                            style={{ width: '100%' }}
                                            value={endDate}
                                            onChange={e => setEndDate(e.target.value)}
                                        />
                                        <Calendar size={18} style={{ position: 'absolute', right: 12, top: 14, color: '#9ca3af', pointerEvents: 'none' }} />
                                    </div>
                                </label>
                            </div>
                        )}
                    </div>
                </div>

                <div className="acm-footer">
                    <button className="acm-submit-btn" onClick={handleApply}>
                        Apply Filter
                    </button>
                </div>
            </div>
        </div>
    )
}
