import type { Order, Quote, Lang, MarketConfig } from "../types"
import { t } from "../utils/i18n"

interface PositionsTableProps {
    orders: Order[]
    quote: Quote | null
    marketPair: string
    marketConfig: Record<string, MarketConfig>
    marketPrice: number
    onClose: (orderId: string) => void
    lang: Lang
}

export default function PositionsTable({ orders, quote, marketPrice, onClose, lang }: PositionsTableProps) {
    const askPrice = quote?.ask ? parseFloat(quote.ask) : marketPrice

    return (
        <div style={{ background: "var(--card-bg)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)", fontWeight: 600 }}>
                {t("positions", lang)}
            </div>
            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                        <tr style={{ background: "var(--bg-subtle)", textAlign: "left" }}>
                            <th style={{ padding: 8 }}>{t("ticket", lang)}</th>
                            <th style={{ padding: 8 }}>{t("time", lang)}</th>
                            <th style={{ padding: 8 }}>{t("type", lang)}</th>
                            <th style={{ padding: 8 }}>{t("volume", lang)}</th>
                            <th style={{ padding: 8 }}>{t("price", lang)}</th>
                            <th style={{ padding: 8 }}>{t("sl", lang)}</th>
                            <th style={{ padding: 8 }}>{t("tp", lang)}</th>
                            <th style={{ padding: 8 }}>{t("price", lang)}</th>
                            <th style={{ padding: 8 }}>{t("profit", lang)}</th>
                            <th style={{ padding: 8 }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.length === 0 ? (
                            <tr>
                                <td colSpan={10} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
                                    No open positions
                                </td>
                            </tr>
                        ) : (
                            orders.map(o => {
                                const isBuy = o.side === "buy"
                                const entryPrice = parseFloat(o.price || "0")
                                const currentPrice = marketPrice

                                let profit = 0
                                if (isBuy) {
                                    profit = (currentPrice - entryPrice) * parseFloat(o.qty || "0")
                                } else {
                                    profit = (entryPrice - askPrice) * parseFloat(o.qty || "0")
                                }

                                const isPending = o.status === "new"

                                return (
                                    <tr key={o.id || Math.random()} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                                        <td style={{ padding: 8 }}>{(o.id || "—").slice(0, 8)}</td>
                                        <td style={{ padding: 8 }}>{o.created_at ? new Date(o.created_at).toLocaleTimeString() : "—"}</td>
                                        <td style={{ padding: 8, color: isBuy ? "#16a34a" : "#ef4444", fontWeight: 600 }}>
                                            {(o.side || "—").toUpperCase()}
                                        </td>
                                        <td style={{ padding: 8 }}>{o.qty ? parseFloat(o.qty).toFixed(2) : "0.00"}</td>
                                        <td style={{ padding: 8 }}>{isNaN(entryPrice) ? "—" : entryPrice.toFixed(5)}</td>
                                        <td style={{ padding: 8 }}>0.00000</td>
                                        <td style={{ padding: 8 }}>0.00000</td>
                                        <td style={{ padding: 8 }}>{(isBuy ? currentPrice : askPrice).toFixed(5)}</td>
                                        <td style={{ padding: 8, color: profit >= 0 ? "#16a34a" : "#ef4444", fontWeight: 600 }}>
                                            {isPending ? "—" : profit.toFixed(2)}
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
