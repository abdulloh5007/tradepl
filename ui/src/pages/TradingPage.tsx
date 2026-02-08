import { useMemo } from "react"
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
    onLoadMore?: (beforeTime: number) => void
    isLoadingMore?: boolean
    hasMoreData?: boolean
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
    lang,
    onLoadMore,
    isLoadingMore,
    hasMoreData
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
                            onClick={() => {
                                if (timeframe !== tf) {
                                    setTimeframe(tf)
                                    fetchCandles(tf)
                                }
                            }}
                            disabled={timeframe === tf}
                            style={{
                                padding: "6px 12px",
                                border: timeframe === tf ? "1px solid #3b82f6" : "1px solid rgba(128,128,128,0.3)",
                                borderRadius: 4,
                                background: timeframe === tf ? "rgba(59, 130, 246, 0.1)" : "transparent",
                                color: timeframe === tf ? "#3b82f6" : "var(--text-base)",
                                fontSize: 13,
                                fontWeight: timeframe === tf ? 600 : 400,
                                cursor: timeframe === tf ? "default" : "pointer",
                                transition: "all 0.2s"
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
                        timeframe={timeframe}
                        onLoadMore={onLoadMore}
                        isLoadingMore={isLoadingMore}
                        hasMoreData={hasMoreData}
                    />
                </div>
            </div>

            {/* Right: Market Panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
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
