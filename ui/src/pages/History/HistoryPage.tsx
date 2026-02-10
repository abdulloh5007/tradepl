import { useState, useMemo } from "react"
import { Calendar, ArrowUpDown, Filter, X } from "lucide-react"
import type { Lang, Order } from "../../types"
import { formatNumber } from "../../utils/format"
import { t } from "../../utils/i18n"
import "./HistoryPage.css"
import "../../components/accounts/SharedAccountSheet.css"
import HistoryFilterModal, { DateRange } from "./HistoryFilterModal"

interface HistoryPageProps {
    orders: Order[]
    lang: Lang
    loading: boolean
    hasMore: boolean
    onRefresh: () => Promise<void> | void
    onLoadMore: () => Promise<void> | void
}

export default function HistoryPage({ orders, lang, loading, hasMore, onRefresh, onLoadMore }: HistoryPageProps) {
    const [filter, setFilter] = useState("Positions")
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
    const [showFilter, setShowFilter] = useState(false)
    const [dateRange, setDateRange] = useState<DateRange>({ type: "month" })

    // Filter Logic
    const filteredOrders = useMemo(() => {
        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

        return orders.filter(o => {
            const time = new Date(o.close_time || o.created_at).getTime()
            if (isNaN(time)) return true

            if (dateRange.type === "today") {
                return time >= todayStart
            }
            if (dateRange.type === "week") {
                const weekAgo = todayStart - (7 * 24 * 60 * 60 * 1000)
                return time >= weekAgo
            }
            if (dateRange.type === "month") {
                const monthAgo = todayStart - (30 * 24 * 60 * 60 * 1000)
                return time >= monthAgo
            }
            if (dateRange.type === "custom") {
                if (!dateRange.startDate) return true
                const start = new Date(dateRange.startDate).getTime()
                const end = dateRange.endDate ? new Date(dateRange.endDate).getTime() + (24 * 60 * 60 * 1000) : now.getTime()
                return time >= start && time < end
            }
            return true
        })
    }, [orders, dateRange])

    // Helper: Date Format YYYY.MM.DD HH:mm:ss
    const formatDate = (ts?: string) => {
        if (!ts) return "—"
        const d = new Date(ts)
        if (isNaN(d.getTime())) return "—"
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const dd = String(d.getDate()).padStart(2, '0')
        const hh = String(d.getHours()).padStart(2, '0')
        const min = String(d.getMinutes()).padStart(2, '0')
        const ss = String(d.getSeconds()).padStart(2, '0')
        return `${yyyy}.${mm}.${dd} ${hh}:${min}:${ss}`
    }

    // Helper: Map symbol to description
    const getSymbolDesc = (sym: string) => {
        if (sym.includes("BTC")) return "Bitcoin vs US Dollar"
        if (sym.includes("ETH")) return "Ethereum vs US Dollar"
        if (sym.includes("XAU")) return "Gold vs US Dollar"
        if (sym.includes("EUR")) return "Euro vs US Dollar"
        return "Spot Market"
    }

    // Helper: Calculate Totals
    const totals = filteredOrders.reduce((acc, o) => {
        const profit = parseFloat(o.profit || "0")
        const commission = parseFloat(o.commission || "0")
        const swap = parseFloat(o.swap || "0")
        acc.profit += profit
        acc.commission += commission
        acc.swap += swap
        return acc
    }, { profit: 0, commission: 0, swap: 0, deposit: 1009374808.93 })

    // Mock balance calculation
    const balance = totals.deposit + totals.profit + totals.swap + totals.commission

    return (
        <div className="history-container">
            {/* Header */}
            <div className="history-header">
                <div style={{ width: 36 }} /> {/* Spacer for centering */}
                <h3 className="history-title">History</h3>
                <button className="history-filter-btn" onClick={() => setShowFilter(true)}>
                    <Filter size={20} />
                </button>
            </div>

            {/* List */}
            <div className="history-list">
                {filteredOrders.length === 0 ? (
                    <div style={{ padding: 40, textAlign: 'center', color: '#8e8e93' }}>
                        No history for this period
                    </div>
                ) : (
                    filteredOrders.map(o => {
                        const isBuy = o.side === "buy"
                        const profit = parseFloat(o.profit || "0")
                        const isProfit = profit >= 0
                        const displaySymbol = o.symbol || o.pair_id || "Unknown"
                        const openPrice = parseFloat(o.price || "0")
                        const closePrice = parseFloat(o.close_price || o.price || "0") // Fallback

                        return (
                            <div key={o.id} className="history-item" onClick={() => setSelectedOrder(o)}>
                                <div className="h-row">
                                    <div className="h-symbol-group">
                                        <span className="h-symbol">{displaySymbol}</span>
                                        <span className={`h-side ${o.side}`}>{o.side}</span>
                                        <span className={`h-qty h-side ${o.side}`}>{o.qty}</span>
                                    </div>
                                    <div className={`h-pl ${isProfit ? "profit" : "loss"}`}>
                                        {formatNumber(profit, 2, 2)}
                                    </div>
                                </div>
                                <div className="h-row">
                                    <div className="h-price-row">
                                        <span>{formatNumber(openPrice, 2, 2)}</span>
                                        <span>→</span>
                                        <span>{formatNumber(closePrice, 2, 2)}</span>
                                    </div>
                                    <div className="h-date">
                                        {formatDate(o.close_time || o.created_at)}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}

                {/* Mock Balance Item Example (matching screenshot) */}
                <div className="history-item balance-item">
                    <div className="h-row">
                        <span className="h-symbol">Balance</span>
                        <div className="h-pl profit">1 000 000 000.00</div>
                    </div>
                    <div className="h-row">
                        <div className="h-date" style={{ color: '#9ca3af' }}>D-trial-USD-9375e1c9138e42</div>
                        <div className="h-date">2026.02.10 13:51:08</div>
                    </div>
                </div>

                {/* Footer Summary - Now inside the scrolling flow at the bottom */}
                <div className="history-footer">
                    <div className="summary-row">
                        <span>Deposit</span>
                        <span className="summary-val">{formatNumber(totals.deposit, 2, 2)}</span>
                    </div>
                    <div className="summary-row">
                        <span>Profit</span>
                        <span className="summary-val">{formatNumber(totals.profit, 2, 2)}</span>
                    </div>
                    <div className="summary-row">
                        <span>Swap</span>
                        <span className="summary-val">{formatNumber(totals.swap, 2, 2)}</span>
                    </div>
                    <div className="summary-row">
                        <span>Commission</span>
                        <span className="summary-val">{formatNumber(totals.commission, 2, 2)}</span>
                    </div>
                    <div className="summary-split" />
                    <div className="summary-row balance-total">
                        <span>Balance</span>
                        <span className="summary-val">{formatNumber(balance, 2, 2)}</span>
                    </div>
                </div>

                {loading && <div style={{ padding: 20, textAlign: 'center', color: '#666' }}>Loading...</div>}

                {!loading && hasMore && (
                    <button onClick={() => onLoadMore()} style={{ padding: 16, width: '100%', background: 'transparent', color: '#3b82f6', border: 'none' }}>
                        Load More
                    </button>
                )}
            </div>

            {/* Details Sheet Modal */}
            {selectedOrder && (
                <div className="acm-overlay" onClick={() => setSelectedOrder(null)}>
                    {/* ... modal content ... */}
                    <div className="acm-backdrop" />
                    <div className="acm-sheet" onClick={e => e.stopPropagation()}>
                        {/* ... */}
                        {/* Reusing existing code structure, just ensuring this block is correct */}
                        <div className="acm-header">
                            <button onClick={() => setSelectedOrder(null)} className="acm-close-btn">
                                <X size={24} />
                            </button>
                            <h2 className="acm-title">Order #{selectedOrder.id.slice(0, 8)}</h2>
                            <div className="acm-spacer" />
                        </div>
                        {/* ... body ... */}
                        <div className="acm-content">
                            {/* ... Content ... */}
                            <div className="hm-body">
                                {/* ... Content ... */}
                                <div className="hm-desc" style={{ textAlign: 'center', paddingBottom: 16 }}>
                                    {getSymbolDesc(selectedOrder.symbol || selectedOrder.pair_id)}
                                </div>
                                {/* ... rest of details ... */}
                                <div className="hm-main-row">
                                    <div className="hm-prices">
                                        {formatNumber(parseFloat(selectedOrder.price || "0"), 2, 2)} &rarr; {formatNumber(parseFloat(selectedOrder.close_price || selectedOrder.price || "0"), 2, 2)}
                                    </div>
                                    <div className={`hm-profit ${parseFloat(selectedOrder.profit || "0") >= 0 ? "profit" : "loss"}`}>
                                        {formatNumber(parseFloat(selectedOrder.profit || "0"), 2, 2)}
                                    </div>
                                </div>

                                <div className="hm-delta-row">
                                    {(() => {
                                        const open = parseFloat(selectedOrder.price || "0")
                                        const close = parseFloat(selectedOrder.close_price || selectedOrder.price || "0")
                                        const diff = close - open
                                        const percent = open > 0 ? (diff / open) * 100 : 0
                                        const points = Math.round(diff * 10000)
                                        const isPos = diff >= 0
                                        const colorClass = isPos ? "profit" : "loss"
                                        return (
                                            <div className={`hm-delta ${colorClass}`}>
                                                Δ = {points} ({formatNumber(percent, 2, 2)}%) {isPos ? "▲" : "▼"}
                                            </div>
                                        )
                                    })()}
                                </div>
                                {/* ... times ... */}
                                <div className="hm-times-row">
                                    {formatDate(selectedOrder.created_at)} &rarr; {formatDate(selectedOrder.close_time || selectedOrder.created_at)}
                                </div>

                                {/* ... grid ... */}
                                <div className="hm-grid">
                                    <div className="hm-grid-item">
                                        <span className="hm-label">Type:</span>
                                        <span className={`hm-side ${selectedOrder.side}`}>{selectedOrder.side.toUpperCase()}</span>
                                    </div>
                                    <div className="hm-grid-item">
                                        <span className="hm-label">Volume:</span>
                                        <span className="hm-val">{selectedOrder.qty}</span>
                                    </div>
                                    <div className="hm-grid-item">
                                        <span className="hm-label">S/L:</span>
                                        <span className="hm-val">-</span>
                                    </div>
                                    <div className="hm-grid-item">
                                        <span className="hm-label">Swap:</span>
                                        <span className="hm-val">{formatNumber(parseFloat(selectedOrder.swap || "0"), 2, 2)}</span>
                                    </div>
                                    <div className="hm-grid-item">
                                        <span className="hm-label">T/P:</span>
                                        <span className="hm-val">-</span>
                                    </div>
                                    <div className="hm-grid-item">
                                        <span className="hm-label">Commission:</span>
                                        <span className="hm-val">{formatNumber(parseFloat(selectedOrder.commission || "0"), 2, 2)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Filter Modal */}
            <HistoryFilterModal
                open={showFilter}
                currentRange={dateRange}
                onClose={() => setShowFilter(false)}
                onApply={setDateRange}
            />
        </div>
    )
}
