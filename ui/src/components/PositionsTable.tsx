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

export default function PositionsTable({ orders, quote, marketPair, marketConfig, marketPrice, onClose, lang }: PositionsTableProps) {
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
                                let entryPrice = parseFloat(o.price || "0")
                                let currentPrice = marketPrice

                                const cfg = marketConfig[marketPair] || (marketPair === "UZS-USD" ? { invertForApi: true, displayDecimals: 2 } : undefined)
                                let profit = 0
                                // Profit calc needs RAW prices or consistent logic.
                                // P/L in DB is calculated using RAW prices.
                                // Here we display P/L estimated.
                                // If we want to show P/L in Quote Asset (USD), we use RAW prices.
                                // (0.000076 - 0.000075) * 1000 = 0.001 USD.
                                // Correct.
                                // But USER wants to see PRICE as 12800.

                                // So we use RAW for profit, but INVERTED for display.
                                const rawEntryPrice = parseFloat(o.price || "0")
                                const rawCurrentPrice = cfg?.invertForApi ? (1 / currentPrice) : currentPrice

                                // Wait, currentPrice passed to props IS already inverted?
                                // In App.tsx: marketPrice={parseFloat(quote.last)}
                                // quote.last IS inverted in App.tsx line 237/243.
                                // So `currentPrice` inside PositionsTable IS 12800.

                                // So:
                                // Display Entry: 1 / rawEntry
                                // Display Current: currentPrice (already 12800)
                                // Profit: (1/currentPrice - rawEntry) ??? NO.
                                // Profit is in USD.
                                // Profit = (RawCurrent - RawEntry) * Qty
                                // RawCurrent = 1 / currentPrice (if inverted)

                                const rawCurrent = cfg?.invertForApi && currentPrice > 0 ? 1 / currentPrice : currentPrice

                                if (isBuy) {
                                    profit = (rawCurrent - rawEntryPrice) * parseFloat(o.qty || "0")
                                } else {
                                    profit = (rawEntryPrice - (cfg?.invertForApi && askPrice > 0 ? 1 / askPrice : askPrice)) * parseFloat(o.qty || "0")
                                    // askPrice passed is also inverted? 
                                    // quote passes {ask: ...} which IS inverted strings.
                                    // askPrice = parseFloat(quote.ask) -> Inverted (12805)
                                    // So RawAsk = 1 / askPrice
                                }

                                // Let's simplify. 
                                // 1. Calculate Profit using RAW values (re-derived from inverted props if needed)
                                // actually, askPrice is derived from quote.ask which is inverted string.

                                const valEntryDisplay = cfg?.invertForApi && entryPrice > 0 ? 1 / entryPrice : entryPrice
                                const valCurrentDisplay = isBuy ? currentPrice : askPrice

                                // Re-calculate raw for profit
                                const valCurrentRaw = cfg?.invertForApi && valCurrentDisplay > 0 ? 1 / valCurrentDisplay : valCurrentDisplay

                                if (isBuy) {
                                    profit = (valCurrentRaw - rawEntryPrice) * parseFloat(o.qty || "0")
                                } else {
                                    // For sell, we need Ask price (which is valCurrentDisplay for Sell?? No.
                                    // currentPrice passed is Last.
                                    // askPrice is passed or derived.
                                    // In table:
                                    // <td style={{ padding: 8 }}>{(isBuy ? currentPrice : askPrice).toFixed(5)}</td>
                                    // So for display we use askPrice.

                                    profit = (rawEntryPrice - valCurrentRaw) * parseFloat(o.qty || "0")
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
                                        <td style={{ padding: 8 }}>{isNaN(valEntryDisplay) ? "—" : valEntryDisplay.toFixed(cfg?.displayDecimals || 5)}</td>
                                        <td style={{ padding: 8 }}>0.00000</td>
                                        <td style={{ padding: 8 }}>0.00000</td>
                                        <td style={{ padding: 8 }}>{valCurrentDisplay.toFixed(cfg?.displayDecimals || 5)}</td>
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
