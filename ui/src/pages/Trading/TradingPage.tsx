import { useEffect, useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import TradingChart from "../../components/TradingChart"
import MarketPanel from "../../components/MarketPanel"
import type { Quote, Lang, MarketConfig, Order } from "../../types"
import { setCookie, storedTradePanelOpen } from "../../utils/cookies"
import { t } from "../../utils/i18n"
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
    const [tradePanelOpen, setTradePanelOpen] = useState(storedTradePanelOpen)

    useEffect(() => {
        setCookie("lv_trade_panel", tradePanelOpen ? "1" : "0")
    }, [tradePanelOpen])

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
                            title={tradePanelOpen ? t("trading.hideTradePanel", lang) : t("trading.showTradePanel", lang)}
                            aria-label={tradePanelOpen ? t("trading.hideTradePanel", lang) : t("trading.showTradePanel", lang)}
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
