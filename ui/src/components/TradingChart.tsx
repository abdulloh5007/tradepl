import { useEffect, useRef, useCallback } from "react"
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
    const lastCandleCountRef = useRef(0)
    const resizeObserverRef = useRef<ResizeObserver | null>(null)

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
            crosshair: {
                mode: 0, // Normal mode (no magnet)
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
        lastCandleCountRef.current = 0

        // Use ResizeObserver for better responsive handling
        resizeObserverRef.current = new ResizeObserver((entries) => {
            if (chartRef.current && entries[0]) {
                const { width, height } = entries[0].contentRect
                chartRef.current.applyOptions({ width, height })
            }
        })
        resizeObserverRef.current.observe(containerRef.current)

        return () => {
            resizeObserverRef.current?.disconnect()
            chart.remove()
        }
    }, [theme])

    // Update candles - optimized to use update() for last candle
    useEffect(() => {
        const series = seriesRef.current
        if (!series || candles.length === 0) return

        // If this is initial load or candle count changed significantly, use setData
        if (lastCandleCountRef.current === 0 || Math.abs(candles.length - lastCandleCountRef.current) > 1) {
            series.setData(candles)
            if (lastCandleCountRef.current === 0) {
                chartRef.current?.timeScale().fitContent()
            }
            lastCandleCountRef.current = candles.length
        } else {
            // For single candle updates, use update() which is much faster
            const lastCandle = candles[candles.length - 1]
            series.update(lastCandle)
            lastCandleCountRef.current = candles.length
        }
    }, [candles])

    // Update price lines - throttled
    const updatePriceLines = useCallback(() => {
        const series = seriesRef.current
        if (!series) return

        // Remove old ask line
        if (askLineRef.current) {
            try { series.removePriceLine(askLineRef.current) } catch { /* ignore */ }
            askLineRef.current = null
        }

        // Add ask line
        if (quote && quote.ask) {
            const askPrice = parseFloat(quote.ask)
            if (!isNaN(askPrice) && askPrice > 0) {
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
    }, [quote])

    useEffect(() => {
        updatePriceLines()
    }, [updatePriceLines])

    // Update order lines separately (less frequent)
    useEffect(() => {
        const series = seriesRef.current
        if (!series) return

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
            if (isNaN(price) || price <= 0) return

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
    }, [openOrders, marketPair, marketConfig])

    return (
        <div
            ref={containerRef}
            className="trading-chart-container"
            style={{
                width: "100%",
                height: "100%",
                minHeight: "300px",
                maxHeight: "calc(100vh - 200px)"
            }}
        />
    )
}
