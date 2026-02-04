import { useEffect, useRef } from "react"
import { createChart, ColorType, ISeriesApi, IPriceLine } from "lightweight-charts"
import type { Candle, Quote, Order, MarketConfig } from "../types"

interface TradingChartProps {
    candles: Candle[]
    quote: Quote | null
    openOrders: Order[]
    marketPair: string
    marketConfig: Record<string, MarketConfig>
    theme: "dark" | "light"
}

export default function TradingChart({ candles, quote, openOrders, marketPair, marketConfig, theme }: TradingChartProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
    const askLineRef = useRef<IPriceLine | null>(null)
    const orderLinesRef = useRef<IPriceLine[]>([])

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current) return

        const chart = createChart(containerRef.current, {
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
            layout: {
                background: { type: ColorType.Solid, color: theme === "dark" ? "#0a0a0f" : "#ffffff" },
                textColor: theme === "dark" ? "#d1d5db" : "#374151"
            },
            grid: {
                vertLines: { color: theme === "dark" ? "#1f2937" : "#e5e7eb" },
                horzLines: { color: theme === "dark" ? "#1f2937" : "#e5e7eb" }
            },
            timeScale: { timeVisible: true, secondsVisible: false },
            rightPriceScale: { borderColor: theme === "dark" ? "#374151" : "#d1d5db" },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
            handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true }
        })

        const series = chart.addCandlestickSeries({
            upColor: "#16a34a",
            downColor: "#ef4444",
            borderDownColor: "#ef4444",
            borderUpColor: "#16a34a",
            wickDownColor: "#ef4444",
            wickUpColor: "#16a34a"
        })

        chartRef.current = chart
        seriesRef.current = series

        const handleResize = () => {
            if (containerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                })
            }
        }

        window.addEventListener("resize", handleResize)

        return () => {
            window.removeEventListener("resize", handleResize)
            chart.remove()
        }
    }, [theme])

    // Update candles
    useEffect(() => {
        if (seriesRef.current && candles.length > 0) {
            seriesRef.current.setData(candles)
            chartRef.current?.timeScale().fitContent()
        }
    }, [candles])

    // Update price lines
    useEffect(() => {
        const series = seriesRef.current
        if (!series) return

        // Remove old ask line
        if (askLineRef.current) {
            series.removePriceLine(askLineRef.current)
            askLineRef.current = null
        }

        // Add ask line
        if (quote && quote.ask) {
            const askPrice = parseFloat(quote.ask)
            if (!isNaN(askPrice)) {
                askLineRef.current = series.createPriceLine({
                    price: askPrice,
                    color: "#ef4444",
                    lineWidth: 1,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: ""
                })
            }
        }

        // Remove old order lines
        orderLinesRef.current.forEach(line => {
            try { series.removePriceLine(line) } catch { /* ignore */ }
        })
        orderLinesRef.current = []

        // Add order lines
        const cfg = marketConfig[marketPair]
        openOrders.forEach(o => {
            if (!o.price) return
            let price = parseFloat(o.price)
            if (cfg?.invertForApi && price > 0) {
                price = 1 / price
            }
            if (isNaN(price)) return

            const line = series.createPriceLine({
                price,
                color: o.side === "buy" ? "#16a34a" : "#ef4444",
                lineWidth: 1,
                lineStyle: 1,
                axisLabelVisible: true,
                title: o.side === "buy" ? "BUY" : "SELL"
            })
            orderLinesRef.current.push(line)
        })
    }, [quote, openOrders, marketPair, marketConfig])

    return (
        <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 400 }} />
    )
}
