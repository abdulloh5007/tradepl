import { useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import TradingChart from "../../components/TradingChart"
import MarketPanel from "../../components/MarketPanel"
import type { Quote, Lang, MarketConfig, Order } from "../../types"
import "./TradingPage.css"

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
    const [tradePanelOpen, setTradePanelOpen] = useState(false)

    return (
        <div className="trading-immersive">
            <div className="trading-chart-shell">
                <div className="chart-top-bar">
                    <div className="chart-tf-strip">
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
                                className={`chart-tf-btn ${timeframe === tf ? "active" : ""}`}
                            >
                                {tf}
                            </button>
                        ))}
                        <button
                            type="button"
                            className={`chart-trade-toggle ${tradePanelOpen ? "open" : ""}`}
                            onClick={() => setTradePanelOpen(v => !v)}
                            title={tradePanelOpen ? "Hide Trade Panel" : "Show Trade Panel"}
                            aria-label={tradePanelOpen ? "Hide Trade Panel" : "Show Trade Panel"}
                        >
                            <ChevronsUpDown size={14} />
                        </button>
                    </div>
                </div>

                <div className="chart-main-area">
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

                <div className={`chart-bottom-panel ${tradePanelOpen ? "open" : ""}`}>
                    <div className="chart-bottom-inner">
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
            </div>
        </div>
    )
}
