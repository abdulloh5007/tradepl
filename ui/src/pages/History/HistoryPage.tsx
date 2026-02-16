import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Filter, X } from "lucide-react"
import type { Lang, Order } from "../../types"
import { formatNumber } from "../../utils/format"
import { t } from "../../utils/i18n"
import { useAnimatedPresence } from "../../hooks/useAnimatedPresence"
import TelegramBackButton from "../../components/telegram/TelegramBackButton"
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
    onBack: () => void
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

const toDisplayPrice = (symbol: string, rawPrice: number) => {
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) return Number.NaN
    // UZS-USD is stored in API-inverted form, display must be normal price space.
    if (symbol === "UZS-USD" && rawPrice < 1) {
        return 1 / rawPrice
    }
    return rawPrice
}

const deriveRawPriceFromSpent = (order: Order) => {
    const qty = toNumber(order.qty, Number.NaN)
    const spent = toNumber(order.spent_amount, Number.NaN)
    if (!Number.isFinite(qty) || !Number.isFinite(spent) || qty <= 0 || spent <= 0) return Number.NaN
    return spent / qty
}

const resolveDisplayPrice = (symbol: string, primary: unknown, secondary?: unknown) => {
    const first = toDisplayPrice(symbol, toNumber(primary, Number.NaN))
    if (Number.isFinite(first) && first > 0) return first
    const second = toDisplayPrice(symbol, toNumber(secondary, Number.NaN))
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

const getSymbolDesc = (symbol: string, lang: Lang) => {
    if (symbol.includes("BTC")) return t("history.symbolDesc.btc", lang)
    if (symbol.includes("ETH")) return t("history.symbolDesc.eth", lang)
    if (symbol.includes("XAU")) return t("history.symbolDesc.xau", lang)
    if (symbol.includes("EUR")) return t("history.symbolDesc.eur", lang)
    if (symbol.includes("UZS")) return t("history.symbolDesc.uzs", lang)
    return t("history.symbolDesc.spot", lang)
}

const hashTicketFromID = (id: string) => {
    let hash = 0
    for (let i = 0; i < id.length; i += 1) {
        hash = (hash * 31 + id.charCodeAt(i)) % 9000000
    }
    return 1000000 + hash
}

const isCashFlowOrder = (order: Order) => {
    const side = String(order.side || "").toLowerCase()
    const type = String(order.type || "").toLowerCase()
    return side === "deposit" || side === "withdraw" || type === "balance"
}

const isSwapOrder = (order: Order) => String(order.type || "").toLowerCase() === "swap"

const cashFlowLabel = (order: Order, lang: Lang) => (
    String(order.side || "").toLowerCase() === "withdraw" ? t("history.withdraw", lang) : t("history.deposit", lang)
)

const formatTicket = (order: Order) => {
    const direct = String(order.ticket || "").trim()
    if (direct) return `#${direct}`
    const fromServer = Number(order.ticket_no)
    const value = Number.isFinite(fromServer) && fromServer > 0 ? Math.trunc(fromServer) : hashTicketFromID(order.id || "")
    return `#BX-${String(value).padStart(7, "0")}`
}

export default function HistoryPage({ orders, lang, loading, hasMore, onRefresh: _onRefresh, onLoadMore, onBack }: HistoryPageProps) {
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
    const [selectedOrderCache, setSelectedOrderCache] = useState<Order | null>(null)
    const [showFilter, setShowFilter] = useState(false)
    const [dateRange, setDateRange] = useState<DateRange>({ type: "month" })
    const listRef = useRef<HTMLDivElement | null>(null)
    const loadSentinelTopRef = useRef<HTMLDivElement | null>(null)
    const loadLockRef = useRef(false)
    const initialBottomPinnedRef = useRef(false)
    const shouldStickToBottomRef = useRef(true)
    const { shouldRender: detailsRender, isVisible: detailsVisible } = useAnimatedPresence(Boolean(selectedOrder), 220)
    const selectedOrderView = selectedOrder || selectedOrderCache

    const sortedOrders = useMemo(() => {
        // History grows downward: oldest at top, newest at bottom.
        return [...orders].sort((a, b) => eventTimeMs(a) - eventTimeMs(b))
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
            const orderType = String(order.type || "").toLowerCase()
            if (isCashFlowOrder(order)) {
                const amount = toNumber(order.profit)
                if (String(order.side || "").toLowerCase() === "withdraw") {
                    acc.withdraw += amount
                } else {
                    acc.deposit += amount
                }
            } else if (orderType === "swap") {
                acc.swap += toNumber(order.swap, toNumber(order.profit))
            } else {
                acc.profit += toNumber(order.profit)
                acc.commission += toNumber(order.commission)
                acc.swap += toNumber(order.swap)
            }
            return acc
        }, { profit: 0, commission: 0, swap: 0, deposit: 0, withdraw: 0 })
    }, [filteredOrders])

    const balance = totals.deposit + totals.withdraw + totals.profit + totals.swap + totals.commission

    const selectedSymbol = selectedOrderView ? resolveOrderSymbol(selectedOrderView) : ""
    const selectedDerivedRawPrice = selectedOrderView ? deriveRawPriceFromSpent(selectedOrderView) : Number.NaN
    const selectedOpenPrice = selectedOrderView
        ? resolveDisplayPrice(selectedSymbol, selectedOrderView.price, Number.isFinite(selectedDerivedRawPrice) ? selectedDerivedRawPrice : selectedOrderView.close_price)
        : Number.NaN
    const selectedClosePrice = selectedOrderView
        ? resolveDisplayPrice(selectedSymbol, selectedOrderView.close_price, selectedOrderView.price || selectedDerivedRawPrice)
        : Number.NaN
    const selectedProfit = selectedOrderView ? toNumber(selectedOrderView.profit) : 0
    const selectedSpent = selectedOrderView ? toNumber(selectedOrderView.spent_amount) : 0
    const selectedPercent = selectedSpent > 0 ? (selectedProfit / selectedSpent) * 100 : 0
    const selectedDiff = Number.isFinite(selectedClosePrice) && Number.isFinite(selectedOpenPrice)
        ? selectedClosePrice - selectedOpenPrice
        : 0
    const selectedIsCashFlow = selectedOrderView ? isCashFlowOrder(selectedOrderView) : false
    const selectedIsSwap = selectedOrderView ? isSwapOrder(selectedOrderView) : false
    const selectedCashFlowLabel = selectedOrderView ? cashFlowLabel(selectedOrderView, lang) : t("history.deposit", lang)

    useEffect(() => {
        if (selectedOrder) {
            setSelectedOrderCache(selectedOrder)
        }
    }, [selectedOrder])

    useEffect(() => {
        if (!detailsRender) {
            setSelectedOrderCache(null)
        }
    }, [detailsRender])

    useEffect(() => {
        if (!loading) {
            loadLockRef.current = false
        }
    }, [loading])

    useEffect(() => {
        const list = listRef.current
        if (!list) return

        const updateStickState = () => {
            const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
            shouldStickToBottomRef.current = distanceFromBottom <= 80
        }

        updateStickState()
        list.addEventListener("scroll", updateStickState, { passive: true })
        return () => list.removeEventListener("scroll", updateStickState)
    }, [])

    useEffect(() => {
        const list = listRef.current
        if (!list) return

        if (!initialBottomPinnedRef.current) {
            list.scrollTop = list.scrollHeight
            initialBottomPinnedRef.current = true
            return
        }
        if (shouldStickToBottomRef.current) {
            list.scrollTop = list.scrollHeight
        }
    }, [filteredOrders.length])

    useEffect(() => {
        const root = listRef.current
        const sentinel = loadSentinelTopRef.current
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
                rootMargin: "220px 0px 0px 0px",
                threshold: 0.01,
            }
        )

        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [hasMore, loading, onLoadMore, filteredOrders.length])

    return (
        <div className="history-container">
            <div className="history-header">
                <TelegramBackButton
                    onBack={onBack}
                    fallbackClassName="history-back-btn"
                    fallbackAriaLabel={t("notifications.backToAccounts", lang)}
                    fallbackChildren={<ArrowLeft size={18} />}
                />
                <h3 className="history-title">{t("history", lang)}</h3>
                <button className="history-filter-btn" onClick={() => setShowFilter(true)} aria-label={t("history.openFilters", lang)}>
                    <Filter size={20} />
                </button>
            </div>

            <div className="history-content">
                <div className="history-list" ref={listRef}>
                    {hasMore && <div ref={loadSentinelTopRef} className="history-sentinel history-sentinel-top" aria-hidden="true" />}
                    {filteredOrders.length === 0 ? (
                        <div className="history-empty">{t("history.emptyForPeriod", lang)}</div>
                    ) : (
                        filteredOrders.map(order => {
                            const profit = toNumber(order.profit)
                            const isProfit = profit >= 0
                            const isCashFlow = isCashFlowOrder(order)
                            const isSwap = isSwapOrder(order)
                            const cashLabel = cashFlowLabel(order, lang)
                            const displaySymbol = resolveOrderSymbol(order)
                            const derivedRawPrice = deriveRawPriceFromSpent(order)
                            const openPrice = resolveDisplayPrice(displaySymbol, order.price, Number.isFinite(derivedRawPrice) ? derivedRawPrice : order.close_price)
                            const closePrice = resolveDisplayPrice(displaySymbol, order.close_price, order.price || derivedRawPrice)
                            return (
                                <div key={order.id} className="history-item" onClick={() => setSelectedOrder(order)}>
                                    <div className="h-row">
                                        <div className="h-symbol-group">
                                            <span className="h-symbol">{isCashFlow ? "USD" : displaySymbol}</span>
                                            <span className={`h-side ${order.side}`}>{order.side === "buy" ? t("buy", lang) : order.side === "sell" ? t("sell", lang) : order.side}</span>
                                            <span className={`h-qty h-side ${order.side}`}>{order.qty}</span>
                                        </div>
                                        <div className={`h-pl ${isProfit ? "profit" : "loss"}`}>
                                            {formatNumber(profit, 2, 2)}
                                        </div>
                                    </div>
                                    <div className="h-row">
                                        {isCashFlow ? (
                                            <div className="h-price-row">
                                                <span>{cashLabel}</span>
                                            </div>
                                        ) : isSwap ? (
                                            <div className="h-price-row">
                                                <span>{t("history.swap", lang)}</span>
                                            </div>
                                        ) : (
                                            <div className="h-price-row">
                                                <span>{formatPriceOrDash(openPrice)}</span>
                                                <span>→</span>
                                                <span>{formatPriceOrDash(closePrice)}</span>
                                            </div>
                                        )}
                                        <div className="h-date">{formatDate(order.close_time || order.created_at)}</div>
                                    </div>
                                </div>
                            )
                        })
                    )}

                    {loading && <div className="history-loading">{t("history.loading", lang)}</div>}
                </div>

                <div className="history-footer">
                    <div className="summary-row">
                        <span>{t("history.deposit", lang)}</span>
                        <span className="summary-val">{formatNumber(totals.deposit, 2, 2)}</span>
                    </div>
                    <div className="summary-row">
                        <span>{t("history.withdraw", lang)}</span>
                        <span className="summary-val">{formatNumber(totals.withdraw, 2, 2)}</span>
                    </div>
                    <div className="summary-row">
                        <span>{t("profit", lang)}</span>
                        <span className="summary-val">{formatNumber(totals.profit, 2, 2)}</span>
                    </div>
                    <div className="summary-row">
                        <span>{t("history.swap", lang)}</span>
                        <span className="summary-val">{formatNumber(totals.swap, 2, 2)}</span>
                    </div>
                    <div className="summary-row">
                        <span>{t("history.commission", lang)}</span>
                        <span className="summary-val">{formatNumber(totals.commission, 2, 2)}</span>
                    </div>
                    <div className="summary-split" />
                    <div className="summary-row balance-total">
                        <span>{t("balance", lang)}</span>
                        <span className="summary-val">{formatNumber(balance, 2, 2)}</span>
                    </div>
                </div>
            </div>

            {detailsRender && selectedOrderView && (
                <div className={`acm-overlay ${detailsVisible ? "is-open" : "is-closing"}`} onClick={() => setSelectedOrder(null)}>
                    <div className="acm-backdrop" />
                    <div className="acm-sheet" onClick={e => e.stopPropagation()}>
                        <div className="acm-header">
                            <button onClick={() => setSelectedOrder(null)} className="acm-close-btn">
                                <X size={24} />
                            </button>
                            <h2 className="acm-title">{selectedIsCashFlow ? selectedCashFlowLabel : formatTicket(selectedOrderView)}</h2>
                            <div className="acm-spacer" />
                        </div>

                        <div className="acm-content">
                            {selectedIsCashFlow ? (
                                <div className="hm-cash-body">
                                    <div className="hm-cash-top-row">
                                        <div className="hm-cash-balance">{t("balance", lang)}</div>
                                        <div className="hm-cash-ticket">{formatTicket(selectedOrderView)}</div>
                                    </div>
                                    <div className="hm-cash-bottom-row">
                                        <div className="hm-cash-date">{formatDate(selectedOrderView.close_time || selectedOrderView.created_at)}</div>
                                        <div className={`hm-cash-amount ${selectedProfit >= 0 ? "profit" : "loss"}`}>
                                            {formatNumber(selectedProfit, 2, 2)}
                                        </div>
                                    </div>
                                </div>
                            ) : selectedIsSwap ? (
                                <div className="hm-cash-body">
                                    <div className="hm-cash-top-row">
                                        <div className="hm-cash-balance">{t("history.swap", lang)}</div>
                                        <div className="hm-cash-ticket">{selectedSymbol}</div>
                                    </div>
                                    <div className="hm-cash-bottom-row">
                                        <div className="hm-cash-date">{formatDate(selectedOrderView.close_time || selectedOrderView.created_at)}</div>
                                        <div className={`hm-cash-amount ${toNumber(selectedOrderView.swap, selectedProfit) >= 0 ? "profit" : "loss"}`}>
                                            {formatNumber(toNumber(selectedOrderView.swap, selectedProfit), 2, 2)}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="hm-body">
                                    <div className="hm-desc" style={{ textAlign: "center", paddingBottom: 12 }}>
                                        {getSymbolDesc(selectedSymbol, lang)}
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
                                                <span className="hm-label">{t("type", lang)}:</span>
                                            <span className={`hm-side ${selectedOrderView.side}`}>{selectedOrderView.side === "buy" ? t("buy", lang).toUpperCase() : selectedOrderView.side === "sell" ? t("sell", lang).toUpperCase() : selectedOrderView.side.toUpperCase()}</span>
                                            </div>
                                            <div className="hm-grid-item">
                                                <span className="hm-label">{t("volume", lang)}:</span>
                                            <span className="hm-val">{selectedOrderView.qty}</span>
                                            </div>
                                            <div className="hm-grid-item hm-grid-item-time">
                                                <span className="hm-label">{t("history.openTime", lang)}:</span>
                                            <span className="hm-val">{formatDate(selectedOrderView.created_at)}</span>
                                            </div>
                                            <div className="hm-grid-item hm-grid-item-time">
                                                <span className="hm-label">{t("history.closeTime", lang)}:</span>
                                            <span className="hm-val">{formatDate(selectedOrderView.close_time || selectedOrderView.created_at)}</span>
                                            </div>
                                            <div className="hm-grid-item">
                                                <span className="hm-label">{t("history.swap", lang)}:</span>
                                            <span className="hm-val">{formatNumber(toNumber(selectedOrderView.swap), 2, 2)}</span>
                                            </div>
                                            <div className="hm-grid-item">
                                                <span className="hm-label">{t("history.commission", lang)}:</span>
                                            <span className="hm-val">{formatNumber(toNumber(selectedOrderView.commission), 2, 2)}</span>
                                            </div>
                                        </div>
                                    </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <HistoryFilterModal
                open={showFilter}
                lang={lang}
                currentRange={dateRange}
                onClose={() => setShowFilter(false)}
                onApply={setDateRange}
            />
        </div>
    )
}
