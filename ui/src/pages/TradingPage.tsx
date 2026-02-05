import TradingChart from "../components/TradingChart"
import MarketPanel from "../components/MarketPanel"
import type { Quote, Lang, MarketConfig, Order } from "../types"

interface TradingPageProps {
    candles: Array<{ time: number; open: number; high: number; low: number; close: number }>
    quote: Quote | null
    openOrders: Order[]
    marketPair: string
    marketConfig: Record<string, MarketConfig>
    theme: "dark" | "light"
    timeframes: string[]
    timeframe: string
    setTimeframe: (tf: string) => void
    fetchCandles: (tf?: string) => void
    quickQty: string
    setQuickQty: (v: string) => void
    onBuy: () => void
    onSell: () => void
    lang: Lang
}

export default function TradingPage({
    candles,
    quote,
    openOrders,
    marketPair,
    marketConfig,
    theme,
    timeframes,
    timeframe,
    setTimeframe,
    fetchCandles,
    quickQty,
    setQuickQty,
    onBuy,
    onSell,
    lang
}: TradingPageProps) {
    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, height: "100%" }}>
            {/* Left: Chart */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
                {/* Timeframe Selector */}
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {timeframes.map(tf => (
                        <button
                            key={tf}
                            onClick={() => { setTimeframe(tf); fetchCandles(tf) }}
                            style={{
                                padding: "6px 12px",
                                border: timeframe === tf ? "1px solid var(--accent-border)" : "1px solid var(--border-subtle)",
                                borderRadius: 4,
                                background: timeframe === tf ? "var(--accent-bg)" : "transparent",
                                color: timeframe === tf ? "var(--accent-text)" : "var(--text-base)",
                                fontSize: 12,
                                cursor: "pointer"
                            }}
                        >
                            {tf}
                        </button>
                    ))}
                </div>

                {/* Chart */}
                <div style={{ flex: 1, minHeight: 400, position: "relative" }}>
                    <TradingChart
                        candles={candles as any}
                        quote={quote}
                        openOrders={openOrders}
                        marketPair={marketPair}
                        marketConfig={marketConfig}
                        theme={theme}
                    />
                </div>
            </div>

            {/* Right: Market Panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <MarketPanel
                    quote={quote}
                    quickQty={quickQty}
                    setQuickQty={setQuickQty}
                    onBuy={onBuy}
                    onSell={onSell}
                    lang={lang}
                />
            </div>
        </div>
    )
}
