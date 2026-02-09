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
    timeframe: string
    onLoadMore?: (beforeTime: number) => void
    isLoadingMore?: boolean
    hasMoreData?: boolean
}

export default function TradingChart({ candles, quote, openOrders, marketPair, marketConfig, theme, timeframe, onLoadMore, isLoadingMore, hasMoreData = true }: TradingChartProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
    const priceLineRef = useRef<IPriceLine | null>(null)
    const askLineRef = useRef<IPriceLine | null>(null)
    const lastCandleCountRef = useRef(0)
    const resizeObserverRef = useRef<ResizeObserver | null>(null)
    // Track timeframe to detect changes
    const lastTimeframeRef = useRef(timeframe)

    // Refs for lazy loading (to avoid chart recreation)
    const onLoadMoreRef = useRef(onLoadMore)
    const isLoadingMoreRef = useRef(isLoadingMore)
    const hasMoreDataRef = useRef(hasMoreData)
    const candlesRef = useRef(candles)
    const initialRenderDoneRef = useRef(false) // Skip lazy load on first render
    const lastRangeFromRef = useRef<number | null>(null) // Track scroll direction

    // Keep refs in sync
    onLoadMoreRef.current = onLoadMore
    isLoadingMoreRef.current = isLoadingMore
    hasMoreDataRef.current = hasMoreData
    candlesRef.current = candles

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
            wickUpColor: "#16a34a",
            // Hide built-in last-price line to keep only custom 2 lines:
            // current price (gray) + ask (red)
            priceLineVisible: false,
            // Hide built-in last-price label on the right price scale
            lastValueVisible: false
        })

        // Initialize data immediately to avoid race condition
        if (candles.length > 0) {
            series.setData(candles)
            chart.timeScale().fitContent()
            lastCandleCountRef.current = candles.length
        }

        chartRef.current = chart
        seriesRef.current = series
        lastCandleCountRef.current = candles.length // Sync ref

        // Use ResizeObserver for better responsive handling
        resizeObserverRef.current = new ResizeObserver((entries) => {
            if (chartRef.current && entries[0]) {
                const { width, height } = entries[0].contentRect
                chartRef.current.applyOptions({ width, height })
            }
        })
        resizeObserverRef.current.observe(containerRef.current)

        // Subscribe to visible range changes for lazy loading
        // Use refs to avoid recreating chart on callback changes
        let loadMoreTimeout: ReturnType<typeof setTimeout> | null = null
        const rangeHandler = (range: { from: number; to: number } | null) => {
            if (!range) return

            // Skip first few renders until chart is stable
            if (!initialRenderDoneRef.current) {
                // Wait for initial data and first render
                setTimeout(() => { initialRenderDoneRef.current = true }, 1000)
                lastRangeFromRef.current = range.from
                return
            }

            // Only trigger lazy load when user scrolls LEFT (range.from decreases)
            const lastFrom = lastRangeFromRef.current
            lastRangeFromRef.current = range.from

            // If scrolling right or no change, skip
            if (lastFrom !== null && range.from >= lastFrom) return

            // Access current values via refs to avoid deps
            const loadMore = onLoadMoreRef.current
            const loading = isLoadingMoreRef.current
            const hasMore = hasMoreDataRef.current
            const currentCandles = candlesRef.current

            if (!loadMore || loading || !hasMore) return

            // Trigger load more when user scrolled near the beginning
            if (range.from < 10 && currentCandles.length > 0) {
                // Debounce: wait 300ms before loading more to avoid spam
                if (loadMoreTimeout) clearTimeout(loadMoreTimeout)
                loadMoreTimeout = setTimeout(() => {
                    const oldestTime = candlesRef.current[0]?.time
                    if (oldestTime && !isLoadingMoreRef.current && hasMoreDataRef.current) {
                        onLoadMoreRef.current?.(oldestTime)
                    }
                }, 300)
            }
        }
        chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler)

        return () => {
            resizeObserverRef.current?.disconnect()
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler)
            chart.remove()
        }
    }, [theme]) // Only recreate on theme change

    // Update candles - optimized to use update() for last candle
    useEffect(() => {
        const series = seriesRef.current
        const chart = chartRef.current
        if (!series || candles.length === 0) return

        const timeframeChanged = lastTimeframeRef.current !== timeframe
        const candlesDiff = candles.length - lastCandleCountRef.current

        // If timeframe changed OR initial load OR multiple candles added (lazy loading or reload)
        if (timeframeChanged || lastCandleCountRef.current === 0 || Math.abs(candlesDiff) > 1) {
            // Save current visible range before update
            const currentRange = chart?.timeScale().getVisibleLogicalRange()

            series.setData(candles)

            // Restore scroll position if this is a prepend (lazy loading adds older candles)
            if (candlesDiff > 1 && !timeframeChanged && lastCandleCountRef.current > 0 && currentRange) {
                // Shift visible range by the number of new candles added at the beginning
                const shift = candlesDiff
                chart?.timeScale().setVisibleLogicalRange({
                    from: currentRange.from + shift,
                    to: currentRange.to + shift
                })
            } else if (lastCandleCountRef.current === 0 || timeframeChanged) {
                chart?.timeScale().fitContent()
            }

            lastCandleCountRef.current = candles.length
            lastTimeframeRef.current = timeframe
        } else {
            // For single candle updates or real-time updates to current candle
            // candlesDiff === 1 means new candle, candlesDiff === 0 means update to current candle
            const lastCandle = candles[candles.length - 1]
            try {
                series.update(lastCandle)
            } catch (e) {
                // If update fails (e.g. timestamp mismatch), fallback to setData
                console.warn("[Chart] Update failed, falling back to setData", e)
                series.setData(candles)
            }
            lastCandleCountRef.current = candles.length
        }
    }, [candles, timeframe])

    // Update price lines - throttled
    const updatePriceLines = useCallback(() => {
        const series = seriesRef.current
        if (!series) return

        // Remove old lines
        if (priceLineRef.current) {
            try { series.removePriceLine(priceLineRef.current) } catch { /* ignore */ }
            priceLineRef.current = null
        }
        if (askLineRef.current) {
            try { series.removePriceLine(askLineRef.current) } catch { /* ignore */ }
            askLineRef.current = null
        }

        // Add current-price line
        if (quote && quote.last) {
            const currentPrice = parseFloat(quote.last)
            if (!isNaN(currentPrice) && currentPrice > 0) {
                priceLineRef.current = series.createPriceLine({
                    price: currentPrice,
                    color: "#4b5563",
                    lineWidth: 1,
                    lineStyle: 0,
                    axisLabelVisible: true,
                    title: ""
                })
            }
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
