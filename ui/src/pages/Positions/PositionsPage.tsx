import { useEffect, useRef, useState } from "react"
import { Plus, ArrowRight } from "lucide-react"
import type { Order, Quote, Lang, MarketConfig, Metrics } from "../../types"
import { formatNumber } from "../../utils/format"
import { calcDisplayedOrderProfit, resolveOrderSymbol } from "../../utils/trading"
import "./PositionsPage.css"

interface PositionsPageProps {
    metrics: Metrics
    orders: Order[]
    quote: Quote | null
    marketPair: string
    marketConfig: Record<string, MarketConfig>
    marketPrice: number
    onClose: (orderId: string) => void
    onCloseAll: () => void
    onCloseProfit: () => void
    onCloseLoss: () => void
    bulkClosing: boolean
    lang: Lang
}

export default function PositionsPage({
    metrics,
    orders,
    quote,
    marketPair,
    marketConfig,
    marketPrice,
    onClose,
    onCloseAll,
    onCloseProfit,
    onCloseLoss,
    bulkClosing,
    lang
}: PositionsPageProps) {
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement | null>(null)

    // Close menu when clicking outside
    useEffect(() => {
        const onClickOutside = (e: MouseEvent) => {
            if (!menuRef.current) return
            if (!menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false)
            }
        }
        window.addEventListener("mousedown", onClickOutside)
        return () => window.removeEventListener("mousedown", onClickOutside)
    }, [])

    const formatValue = (v: string | number) => {
        const num = typeof v === 'string' ? parseFloat(v) : v
        if (isNaN(num)) return "0.00"
        return formatNumber(num, 2, 2)
    }

    const pl = parseFloat(metrics.pl || "0")
    // Keep 0 as 0, but handle small float errors
    const shownPl = Math.abs(pl) < 0.000000000001 ? 0 : pl
    const plClass = shownPl >= 0 ? "profit" : "loss"

    const bidDisplay = quote?.bid ? parseFloat(quote.bid) : marketPrice
    const askDisplay = quote?.ask ? parseFloat(quote.ask) : marketPrice

    return (
        <div className="pos-container">
            {/* Header Section */}
            <div className="pos-header">
                <div className="pos-top-row">
                    <div style={{ width: 36 }} /> {/* Spacer for centering */}
                    <div className={`pos-total-pl ${plClass}`}>
                        {formatValue(shownPl)} USD
                    </div>
                    <button className="pos-add-btn">
                        <Plus size={24} />
                    </button>
                </div>

                <div className="pos-stats">
                    <StatRow label="Balance:" value={formatValue(metrics.balance)} />
                    <StatRow label="Equity:" value={formatValue(metrics.equity)} />
                    <StatRow label="Margin:" value={formatValue(metrics.margin)} />
                    <StatRow label="Free Margin:" value={formatValue(metrics.free_margin)} />
                    <StatRow
                        label="Margin Level (%):"
                        value={metrics.margin_level ? formatNumber(parseFloat(metrics.margin_level), 2, 2) : "0.00"}
                    />
                </div>
            </div>

            {/* Options / Title Row */}
            <div className="pos-options-row">
                <h3 className="pos-section-title">Positions</h3>
                <div style={{ position: "relative" }} ref={menuRef}>
                    <button
                        className="pos-dots-btn"
                        onClick={() => setMenuOpen(v => !v)}
                        disabled={bulkClosing}
                    >
                        •••
                    </button>
                    {menuOpen && (
                        <div className="pos-menu-popup">
                            <button
                                className="pos-menu-item"
                                disabled={bulkClosing}
                                onClick={() => {
                                    setMenuOpen(false)
                                    onCloseAll()
                                }}
                            >
                                Close All
                            </button>
                            <button
                                className="pos-menu-item"
                                disabled={bulkClosing}
                                onClick={() => {
                                    setMenuOpen(false)
                                    onCloseProfit()
                                }}
                            >
                                Close Profit
                            </button>
                            <button
                                className="pos-menu-item"
                                disabled={bulkClosing}
                                onClick={() => {
                                    setMenuOpen(false)
                                    onCloseLoss()
                                }}
                            >
                                Close Loss
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Positions List */}
            <div className="pos-list">
                {orders.length === 0 ? (
                    <div className="pos-empty">No open positions</div>
                ) : (
                    orders.map(o => {
                        const displaySymbol = resolveOrderSymbol(o, marketPair)
                        const cfg = marketConfig[displaySymbol] || (displaySymbol === "UZS-USD" ? { invertForApi: true, displayDecimals: 2 } : undefined)
                        const profit = calcDisplayedOrderProfit(o, bidDisplay, askDisplay, marketPair, marketConfig)

                        // Entry price comes from backend order.price (raw API price). If missing/invalid, show placeholder.
                        const rawEntry = parseFloat(o.price || "0")
                        const qty = parseFloat(o.qty || "0")
                        const entryDisplay = cfg?.invertForApi && rawEntry > 0 ? 1 / rawEntry : rawEntry
                        const hasEntryPrice = Number.isFinite(entryDisplay) && entryDisplay > 0

                        // For current price, we use bid for buy (close sell), ask for sell (close buy)
                        const currentPrice = o.side === 'buy' ? bidDisplay : askDisplay
                        const hasCurrentPrice = Number.isFinite(currentPrice) && currentPrice > 0

                        const plClass = profit >= 0 ? "profit" : "loss"

                        return (
                            <div
                                key={o.id}
                                className="pos-item"
                                onClick={() => onClose(o.id)}
                            >
                                <div className="pos-item-left">
                                    <div className="pos-symbol-row">
                                        <span>{displaySymbol}</span>
                                        <span className={`pos-side ${o.side}`}>{o.side}</span>
                                        <span className="pos-size">{formatNumber(qty, 2, 2)}</span>
                                    </div>
                                    <div className="pos-price-row">
                                        <span>{hasEntryPrice ? formatNumber(entryDisplay, cfg?.displayDecimals || 2, cfg?.displayDecimals || 2) : "—"}</span>
                                        <ArrowRight size={12} className="pos-arrow" />
                                        <span>{hasCurrentPrice ? formatNumber(currentPrice, cfg?.displayDecimals || 2, cfg?.displayDecimals || 2) : "—"}</span>
                                    </div>
                                </div>
                                <div className="pos-item-right">
                                    <div className={`pos-pl ${plClass}`}>
                                        {formatNumber(profit, 2, 2)}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}

function StatRow({ label, value }: { label: string, value: string }) {
    return (
        <div className="pos-stat-row">
            <span className="pos-stat-label">{label}</span>
            <span className="pos-stat-value">{value}</span>
        </div>
    )
}
