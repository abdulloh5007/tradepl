import type { Order, Quote, Lang, MarketConfig } from "../types"
import { t } from "../utils/i18n"
import { calcOrderProfit } from "../utils/trading"
import { formatNumber } from "../utils/format"

interface PositionsTableProps {
    orders: Order[]
    quote: Quote | null
    marketPair: string
    marketConfig: Record<string, MarketConfig>
    marketPrice: number
    onClose: (orderId: string) => void
    lang: Lang
}

export default function PositionsTable({ orders, quote, marketPair, marketConfig, marketPrice, onClose, lang }: PositionsTableProps) {
    const rawLast = quote?.last ? parseFloat(quote.last) : NaN
    const rawBid = quote?.bid ? parseFloat(quote.bid) : NaN
    const rawAsk = quote?.ask ? parseFloat(quote.ask) : NaN
    const priceDisplay = Number.isFinite(rawLast) && rawLast > 0
        ? rawLast
        : (Number.isFinite(rawBid) && rawBid > 0 ? rawBid : marketPrice)
    const bidDisplay = Number.isFinite(rawBid) && rawBid > 0 ? rawBid : priceDisplay
    const askDisplay = Number.isFinite(rawAsk) && rawAsk > 0 ? rawAsk : priceDisplay
    const cfg = marketConfig[marketPair] || (marketPair === "UZS-USD" ? { invertForApi: true, displayDecimals: 2 } : undefined)

    const safeProfit = (v: number) => {
        if (!Number.isFinite(v)) return 0
        return Math.abs(v) < 0.000000000001 ? 0 : v
    }

    const formatProfit = (v: number) => {
        return formatNumber(v, 2, 2)
    }

    return (
        <div style={{ background: "var(--card-bg)", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", fontWeight: 600, fontSize: 13 }}>
                {t("positions", lang)}
            </div>
            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                        <tr style={{ background: "var(--bg-subtle)", textAlign: "left" }}>
                            <th style={{ padding: 8 }}>{t("type", lang)}</th>
                            <th style={{ padding: 8 }}>{t("pair", lang)}</th>
                            <th style={{ padding: 8 }}>{t("volume", lang)}</th>
                            <th style={{ padding: 8 }}>{t("positions.openPrice", lang)}</th>
                            <th style={{ padding: 8 }}>{t("profit", lang)}</th>
                            <th style={{ padding: 8 }} />
                        </tr>
                    </thead>
                    <tbody>
                        {orders.length === 0 ? (
                            <tr>
                                <td colSpan={6} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
                                    {t("positions.noOpen", lang)}
                                </td>
                            </tr>
                        ) : (
                            orders.map(o => {
                                const isBuy = o.side === "buy"
                                const rawEntry = parseFloat(o.price || "0")
                                const qty = parseFloat(o.qty || "0")
                                const entryDisplay = cfg?.invertForApi && rawEntry > 0 ? 1 / rawEntry : rawEntry
                                const profit = calcOrderProfit(o, bidDisplay, askDisplay, marketPair, marketConfig, priceDisplay)

                                const shownProfit = safeProfit(profit)
                                const isPending = o.status === "open"

                                return (
                                    <tr key={o.id || Math.random()} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                                        <td style={{ padding: 8, color: isBuy ? "#2e6be4" : "#ef4444", fontWeight: 700 }}>
                                            {isBuy ? "BUY" : "SELL"}
                                        </td>
                                        <td style={{ padding: 8 }}>{marketPair}</td>
                                        <td style={{ padding: 8 }}>{Number.isFinite(qty) ? formatNumber(qty, 2, 2) : "0.00"}</td>
                                        <td style={{ padding: 8 }}>{Number.isFinite(entryDisplay) ? formatNumber(entryDisplay, cfg?.displayDecimals || 5, cfg?.displayDecimals || 5) : "—"}</td>
                                        <td style={{ padding: 8, color: shownProfit >= 0 ? "#16a34a" : "#ef4444", fontWeight: 600 }}>
                                            {isPending ? "—" : formatProfit(shownProfit)}
                                        </td>
                                        <td style={{ padding: 8, textAlign: "right" }}>
                                            <button
                                                onClick={() => onClose(o.id)}
                                                style={{
                                                    border: "none",
                                                    background: "rgba(239, 68, 68, 0.1)",
                                                    color: "#ef4444",
                                                    cursor: "pointer",
                                                    padding: "4px 8px",
                                                    borderRadius: 4,
                                                    fontSize: 11
                                                }}
                                            >
                                                {t("close", lang)}
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
