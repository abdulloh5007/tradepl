import { useEffect, useMemo, useRef, useState } from "react"
import { Filter, X } from "lucide-react"
import type { Lang, Order } from "../../types"
import { formatNumber } from "../../utils/format"
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

const isMarketSymbol = (value?: string) => /^[A-Z0-9]{2,12}-[A-Z0-9]{2,12}$/.test(String(value || "").trim().toUpperCase())

const resolveOrderSymbol = (order: Order, fallback = "UZS-USD") => {
    const bySymbol = String(order.symbol || "").trim().toUpperCase()
    if (isMarketSymbol(bySymbol)) return bySymbol
    const byPairID = String(order.pair_id || "").trim().toUpperCase()
    if (isMarketSymbol(byPairID)) return byPairID
    return fallback
}

const toNumber = (value: unknown, fallback = 0) => {
    if (value === null || value === undefined) return fallback
    if (typeof value === "string" && value.trim() === "") return fallback
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
}

const resolvePrice = (primary: unknown, secondary?: unknown) => {
    const first = toNumber(primary, Number.NaN)
    if (Number.isFinite(first) && first > 0) return first
    const second = toNumber(secondary, Number.NaN)
    if (Number.isFinite(second) && second > 0) return second
    return Number.NaN
}

const formatPriceOrDash = (value: number) => {
    if (!Number.isFinite(value)) return "—"
    return formatNumber(value, 2, 2)
}

const eventTimeMs = (order: Order) => {
    const raw = order.close_time || order.created_at
    const ms = Date.parse(raw || "")
    return Number.isFinite(ms) ? ms : 0
}

const formatDate = (ts?: string) => {
    if (!ts) return "—"
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return "—"
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    const hh = String(d.getHours()).padStart(2, "0")
    const min = String(d.getMinutes()).padStart(2, "0")
    const ss = String(d.getSeconds()).padStart(2, "0")
    return `${yyyy}.${mm}.${dd} ${hh}:${min}:${ss}`
}

const getSymbolDesc = (symbol: string) => {
    if (symbol.includes("BTC")) return "Bitcoin vs US Dollar"
    if (symbol.includes("ETH")) return "Ethereum vs US Dollar"
    if (symbol.includes("XAU")) return "Gold vs US Dollar"
    if (symbol.includes("EUR")) return "Euro vs US Dollar"
    if (symbol.includes("UZS")) return "Uzbek Som vs US Dollar"
    return "Spot Market"
}

const hashTicketFromID = (id: string) => {
    let hash = 0
    for (let i = 0; i < id.length; i += 1) {
        hash = (hash * 31 + id.charCodeAt(i)) % 9000000
    }
    return 1000000 + hash
}

const formatTicket = (order: Order) => {
    const fromServer = Number(order.ticket_no)
    const value = Number.isFinite(fromServer) && fromServer > 0 ? Math.trunc(fromServer) : hashTicketFromID(order.id || "")
    return `#bx-${String(value).padStart(7, "0")}`
}

export default function HistoryPage({ orders, lang: _lang, loading, hasMore, onRefresh: _onRefresh, onLoadMore }: HistoryPageProps) {
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
    const [showFilter, setShowFilter] = useState(false)
    const [dateRange, setDateRange] = useState<DateRange>({ type: "month" })
    const listRef = useRef<HTMLDivElement | null>(null)
    const loadSentinelRef = useRef<HTMLDivElement | null>(null)
    const loadLockRef = useRef(false)

    const sortedOrders = useMemo(() => {
        return [...orders].sort((a, b) => eventTimeMs(b) - eventTimeMs(a))
    }, [orders])

    const filteredOrders = useMemo(() => {
        const now = Date.now()
        const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()

        return sortedOrders.filter(order => {
            const time = eventTimeMs(order)
            if (!Number.isFinite(time) || time === 0) return true

            if (dateRange.type === "today") return time >= todayStart
            if (dateRange.type === "week") return time >= todayStart - 7 * 24 * 60 * 60 * 1000
            if (dateRange.type === "month") return time >= todayStart - 30 * 24 * 60 * 60 * 1000
            if (dateRange.type === "custom") {
                if (!dateRange.startDate) return true
                const start = new Date(dateRange.startDate).getTime()
                const end = dateRange.endDate
                    ? new Date(dateRange.endDate).getTime() + 24 * 60 * 60 * 1000
                    : now
                return time >= start && time < end
            }
            return true
        })
    }, [sortedOrders, dateRange])

    const totals = useMemo(() => {
        return filteredOrders.reduce((acc, order) => {
            acc.profit += toNumber(order.profit)
            acc.commission += toNumber(order.commission)
            acc.swap += toNumber(order.swap)
            return acc
        }, { profit: 0, commission: 0, swap: 0, deposit: 0 })
    }, [filteredOrders])

    const balance = totals.deposit + totals.profit + totals.swap + totals.commission

    const selectedSymbol = selectedOrder ? resolveOrderSymbol(selectedOrder) : ""
    const selectedOpenPrice = selectedOrder ? resolvePrice(selectedOrder.price, selectedOrder.close_price) : Number.NaN
    const selectedClosePrice = selectedOrder ? resolvePrice(selectedOrder.close_price, selectedOrder.price) : Number.NaN
    const selectedProfit = selectedOrder ? toNumber(selectedOrder.profit) : 0
    const selectedSpent = selectedOrder ? toNumber(selectedOrder.spent_amount) : 0
    const selectedPercent = selectedSpent > 0 ? (selectedProfit / selectedSpent) * 100 : 0
    const selectedDiff = Number.isFinite(selectedClosePrice) && Number.isFinite(selectedOpenPrice)
        ? selectedClosePrice - selectedOpenPrice
        : 0

    useEffect(() => {
        if (!loading) {
            loadLockRef.current = false
        }
    }, [loading])

    useEffect(() => {
        const root = listRef.current
        const sentinel = loadSentinelRef.current
        if (!root || !sentinel || !hasMore) return

        const observer = new IntersectionObserver(
            entries => {
                const entry = entries[0]
                if (!entry?.isIntersecting) return
                if (!hasMore || loading || loadLockRef.current) return

                loadLockRef.current = true
                Promise.resolve(onLoadMore())
                    .catch(() => { })
                    .finally(() => {
                        window.setTimeout(() => {
                            if (!loading) {
                                loadLockRef.current = false
                            }
                        }, 250)
                    })
            },
            {
                root,
                rootMargin: "0px 0px 220px 0px",
                threshold: 0.01,
            }
        )

        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [hasMore, loading, onLoadMore, filteredOrders.length])

    return (
        <div className="history-container">
            <div className="history-header">
                <div style={{ width: 36 }} />
                <h3 className="history-title">History</h3>
                <button className="history-filter-btn" onClick={() => setShowFilter(true)} aria-label="Open history filters">
                    <Filter size={20} />
                </button>
            </div>

            <div className="history-content">
                <div className="history-list" ref={listRef}>
                    {filteredOrders.length === 0 ? (
                        <div className="history-empty">No history for this period</div>
                    ) : (
                        filteredOrders.map(order => {
                            const profit = toNumber(order.profit)
                            const isProfit = profit >= 0
                            const displaySymbol = resolveOrderSymbol(order)
                            const openPrice = resolvePrice(order.price, order.close_price)
                            const closePrice = resolvePrice(order.close_price, order.price)
                            return (
                                <div key={order.id} className="history-item" onClick={() => setSelectedOrder(order)}>
                                    <div className="h-row">
                                        <div className="h-symbol-group">
                                            <span className="h-symbol">{displaySymbol}</span>
                                            <span className={`h-side ${order.side}`}>{order.side}</span>
                                            <span className={`h-qty h-side ${order.side}`}>{order.qty}</span>
                                        </div>
                                        <div className={`h-pl ${isProfit ? "profit" : "loss"}`}>
                                            {formatNumber(profit, 2, 2)}
                                        </div>
                                    </div>
                                    <div className="h-row">
                                        <div className="h-price-row">
                                            <span>{formatPriceOrDash(openPrice)}</span>
                                            <span>→</span>
                                            <span>{formatPriceOrDash(closePrice)}</span>
                                        </div>
                                        <div className="h-date">{formatDate(order.close_time || order.created_at)}</div>
                                    </div>
                                    <div className="h-row h-ticket-row">
                                        <span className="h-ticket">{formatTicket(order)}</span>
                                    </div>
                                </div>
                            )
                        })
                    )}

                    {loading && <div className="history-loading">Loading...</div>}
                    {hasMore && <div ref={loadSentinelRef} className="history-sentinel" aria-hidden="true" />}
                </div>

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
            </div>

            {selectedOrder && (
                <div className="acm-overlay" onClick={() => setSelectedOrder(null)}>
                    <div className="acm-backdrop" />
                    <div className="acm-sheet" onClick={e => e.stopPropagation()}>
                        <div className="acm-header">
                            <button onClick={() => setSelectedOrder(null)} className="acm-close-btn">
                                <X size={24} />
                            </button>
                            <h2 className="acm-title">{formatTicket(selectedOrder)}</h2>
                            <div className="acm-spacer" />
                        </div>

                        <div className="acm-content">
                            <div className="hm-body">
                                <div className="hm-desc" style={{ textAlign: "center", paddingBottom: 12 }}>
                                    {getSymbolDesc(selectedSymbol)}
                                </div>

                                <div className="hm-main-row">
                                    <div className="hm-prices">
                                        {formatPriceOrDash(selectedOpenPrice)} &rarr; {formatPriceOrDash(selectedClosePrice)}
                                    </div>
                                    <div className={`hm-profit ${selectedProfit >= 0 ? "profit" : "loss"}`}>
                                        {formatNumber(selectedProfit, 2, 2)}
                                    </div>
                                </div>

                                <div className="hm-delta-row">
                                    <div className={`hm-delta ${selectedPercent >= 0 ? "profit" : "loss"}`}>
                                        ROI {formatNumber(selectedPercent, 2, 2)}% {selectedPercent >= 0 ? "▲" : "▼"}
                                        {Number.isFinite(selectedOpenPrice) && Number.isFinite(selectedClosePrice) ? ` · Δ ${formatNumber(selectedDiff, 2, 2)}` : ""}
                                    </div>
                                </div>

                                <div className="hm-grid">
                                    <div className="hm-grid-item">
                                        <span className="hm-label">Type:</span>
                                        <span className={`hm-side ${selectedOrder.side}`}>{selectedOrder.side.toUpperCase()}</span>
                                    </div>
                                    <div className="hm-grid-item">
                                        <span className="hm-label">Volume:</span>
                                        <span className="hm-val">{selectedOrder.qty}</span>
                                    </div>
                                    <div className="hm-grid-item hm-grid-item-time">
                                        <span className="hm-label">Open:</span>
                                        <span className="hm-val">{formatDate(selectedOrder.created_at)}</span>
                                    </div>
                                    <div className="hm-grid-item hm-grid-item-time">
                                        <span className="hm-label">Close:</span>
                                        <span className="hm-val">{formatDate(selectedOrder.close_time || selectedOrder.created_at)}</span>
                                    </div>
                                    <div className="hm-grid-item">
                                        <span className="hm-label">Swap:</span>
                                        <span className="hm-val">{formatNumber(toNumber(selectedOrder.swap), 2, 2)}</span>
                                    </div>
                                    <div className="hm-grid-item">
                                        <span className="hm-label">Commission:</span>
                                        <span className="hm-val">{formatNumber(toNumber(selectedOrder.commission), 2, 2)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <HistoryFilterModal
                open={showFilter}
                currentRange={dateRange}
                onClose={() => setShowFilter(false)}
                onApply={setDateRange}
            />
        </div>
    )
}
