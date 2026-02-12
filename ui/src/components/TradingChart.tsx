import { useEffect, useRef, useCallback } from "react"
import { createChart, ColorType, ISeriesApi, IPriceLine } from "lightweight-charts"
import type { Candle, Quote, Order, MarketConfig } from "../types"

const VIEWPORT_COOKIE_KEY = "lv_chart_viewport_v1"
const VIEWPORT_TTL_MS = 45 * 60 * 1000 // 45 minutes
const VIEWPORT_MAX_ENTRIES = 8

type SavedViewport = {
    key: string
    from: number
    to: number
    rightOffset: number
    barSpacing: number
    savedAt: number
}

function readCookie(name: string): string | null {
    if (typeof document === "undefined") return null
    const parts = document.cookie.split("; ")
    for (const part of parts) {
        if (part.startsWith(`${name}=`)) {
            return decodeURIComponent(part.slice(name.length + 1))
        }
    }
    return null
}

function writeCookie(name: string, value: string, maxAgeSec: number): void {
    if (typeof document === "undefined") return
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; samesite=lax`
}

function readSavedViewports(): SavedViewport[] {
    const raw = readCookie(VIEWPORT_COOKIE_KEY)
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter((item): item is SavedViewport =>
            item &&
            typeof item.key === "string" &&
            typeof item.from === "number" &&
            typeof item.to === "number" &&
            typeof item.rightOffset === "number" &&
            typeof item.barSpacing === "number" &&
            typeof item.savedAt === "number")
    } catch {
        return []
    }
}

function writeSavedViewports(entries: SavedViewport[]): void {
    writeCookie(VIEWPORT_COOKIE_KEY, JSON.stringify(entries), 60 * 60 * 24 * 7)
}

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
    const orderLinesRef = useRef<IPriceLine[]>([])
    const orderLabelsLayerRef = useRef<HTMLDivElement | null>(null)
    const orderLabelItemsRef = useRef<Array<{ price: number; node: HTMLDivElement }>>([])
    const lastCandleCountRef = useRef(0)
    const lastFirstTimeRef = useRef<number | null>(null)
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
    const saveViewportTimerRef = useRef<number | null>(null)
    const restoredViewportKeyRef = useRef<string>("")
    const viewportKeyRef = useRef("")
    const prevViewportKeyRef = useRef("")

    // Keep refs in sync
    onLoadMoreRef.current = onLoadMore
    isLoadingMoreRef.current = isLoadingMore
    hasMoreDataRef.current = hasMoreData
    candlesRef.current = candles

    const updateOrderLabelPositions = useCallback(() => {
        const series = seriesRef.current
        if (!series || orderLabelItemsRef.current.length === 0) return

        orderLabelItemsRef.current.forEach((item) => {
            const y = series.priceToCoordinate(item.price)
            if (typeof y !== "number" || !Number.isFinite(y)) {
                item.node.style.display = "none"
                return
            }
            item.node.style.display = "inline-flex"
            item.node.style.top = `${y}px`
        })
    }, [])

    const viewportKey = `${marketPair}|${timeframe}`
    viewportKeyRef.current = viewportKey

    const restoreViewport = useCallback((key: string): boolean => {
        const chart = chartRef.current
        if (!chart) return false

        const now = Date.now()
        const entries = readSavedViewports().filter((entry) => now-entry.savedAt <= VIEWPORT_TTL_MS)
        if (entries.length === 0) return false

        const entry = entries.find((item) => item.key === key)
        if (!entry) return false

        const barSpacing = Math.max(0.5, Math.min(80, entry.barSpacing))
        chart.timeScale().applyOptions({
            rightOffset: entry.rightOffset,
            barSpacing
        })
        chart.timeScale().setVisibleLogicalRange({ from: entry.from, to: entry.to })
        return true
    }, [])

    const persistViewport = useCallback((key: string) => {
        const chart = chartRef.current
        if (!chart) return
        const range = chart.timeScale().getVisibleLogicalRange()
        if (!range) return

        const tsOpts = chart.timeScale().options()
        const entry: SavedViewport = {
            key,
            from: range.from,
            to: range.to,
            rightOffset: tsOpts.rightOffset ?? 0,
            barSpacing: tsOpts.barSpacing ?? 6,
            savedAt: Date.now()
        }

        const active = readSavedViewports()
            .filter((item) => Date.now()-item.savedAt <= VIEWPORT_TTL_MS)
            .filter((item) => item.key !== key)
        active.unshift(entry)
        writeSavedViewports(active.slice(0, VIEWPORT_MAX_ENTRIES))
    }, [])

    const schedulePersistViewport = useCallback((key: string) => {
        if (saveViewportTimerRef.current !== null) {
            window.clearTimeout(saveViewportTimerRef.current)
        }
        saveViewportTimerRef.current = window.setTimeout(() => {
            persistViewport(key)
            saveViewportTimerRef.current = null
        }, 350)
    }, [persistViewport])

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current) return

        const resizeChartToContainer = () => {
            const chart = chartRef.current
            const container = containerRef.current
            if (!chart || !container) return
            const rect = container.getBoundingClientRect()
            const width = Math.floor(rect.width)
            const height = Math.floor(rect.height)
            if (width <= 0 || height <= 0) return
            chart.applyOptions({ width, height })
            updateOrderLabelPositions()
        }

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

        chartRef.current = chart
        seriesRef.current = series

        // Initialize data and restore viewport immediately when data already exists.
        // This is crucial when returning to chart from another page (component remount).
        if (candles.length > 0) {
            series.setData(candles)
            const key = viewportKeyRef.current
            const restored = restoreViewport(key)
            restoredViewportKeyRef.current = key
            if (!restored) {
                chart.timeScale().fitContent()
            }
            lastCandleCountRef.current = candles.length
            lastFirstTimeRef.current = candles[0]?.time ?? null
        }

        lastCandleCountRef.current = candles.length // Sync ref

        // Use ResizeObserver for better responsive handling
        resizeObserverRef.current = new ResizeObserver((entries) => {
            if (chartRef.current && entries[0]) {
                const { width, height } = entries[0].contentRect
                if (width > 0 && height > 0) {
                    chartRef.current.applyOptions({ width, height })
                    updateOrderLabelPositions()
                }
            }
        })
        resizeObserverRef.current.observe(containerRef.current)
        if (containerRef.current.parentElement) {
            resizeObserverRef.current.observe(containerRef.current.parentElement)
        }

        const onWindowResize = () => {
            // Delay to next frame so layout changes (e.g. devtools open/close) are applied.
            requestAnimationFrame(resizeChartToContainer)
        }
        window.addEventListener("resize", onWindowResize)
        window.addEventListener("orientationchange", onWindowResize)
        window.visualViewport?.addEventListener("resize", onWindowResize)
        // Fallback watchdog: catches edge-cases where browser skips resize/observer notifications.
        const resizeWatchdog = window.setInterval(() => {
            resizeChartToContainer()
        }, 250)
        const shell = containerRef.current.closest(".trading-chart-shell")
        shell?.addEventListener("transitionend", onWindowResize)
        shell?.addEventListener("animationend", onWindowResize)
        // Initial sync after first paint.
        requestAnimationFrame(resizeChartToContainer)

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

            // Persist viewport for both pan + zoom changes.
            schedulePersistViewport(viewportKeyRef.current)

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
            window.removeEventListener("resize", onWindowResize)
            window.removeEventListener("orientationchange", onWindowResize)
            window.visualViewport?.removeEventListener("resize", onWindowResize)
            window.clearInterval(resizeWatchdog)
            shell?.removeEventListener("transitionend", onWindowResize)
            shell?.removeEventListener("animationend", onWindowResize)
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler)
            persistViewport(viewportKeyRef.current)
            if (saveViewportTimerRef.current !== null) {
                window.clearTimeout(saveViewportTimerRef.current)
                saveViewportTimerRef.current = null
            }
            orderLabelItemsRef.current.forEach((item) => item.node.remove())
            orderLabelItemsRef.current = []
            chart.remove()
        }
    }, [updateOrderLabelPositions, persistViewport, schedulePersistViewport, restoreViewport]) // Keep chart mounted; avoid remount on pair/timeframe/theme changes

    // Apply visual theme without recreating chart (keeps viewport and zoom intact).
    useEffect(() => {
        const chart = chartRef.current
        const series = seriesRef.current
        if (!chart || !series) return

        chart.applyOptions({
            layout: {
                background: { type: ColorType.Solid, color: theme === "dark" ? "#0a0a0f" : "#ffffff" },
                textColor: theme === "dark" ? "#d1d5db" : "#374151"
            },
            grid: {
                vertLines: { color: theme === "dark" ? "#1f2937" : "#e5e7eb" },
                horzLines: { color: theme === "dark" ? "#1f2937" : "#e5e7eb" }
            },
            rightPriceScale: { borderColor: theme === "dark" ? "#374151" : "#d1d5db" }
        })
    }, [theme])

    // Update candles - optimized to use update() for last candle
    useEffect(() => {
        const series = seriesRef.current
        const chart = chartRef.current
        if (!series || candles.length === 0) return

        const timeframeChanged = lastTimeframeRef.current !== timeframe
        const candlesDiff = candles.length - lastCandleCountRef.current
        const firstTime = candles[0]?.time ?? null
        const datasetReplaced = firstTime !== null && lastFirstTimeRef.current !== null && firstTime !== lastFirstTimeRef.current

        // If timeframe changed OR initial load OR multiple candles added (lazy loading or reload)
        if (timeframeChanged || lastCandleCountRef.current === 0 || Math.abs(candlesDiff) > 1 || datasetReplaced) {
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
                if (restoredViewportKeyRef.current !== viewportKey) {
                    const restored = restoreViewport(viewportKey)
                    restoredViewportKeyRef.current = viewportKey
                    if (!restored) {
                        chart?.timeScale().fitContent()
                    }
                }
            }

            lastCandleCountRef.current = candles.length
            lastTimeframeRef.current = timeframe
            lastFirstTimeRef.current = firstTime
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
            lastFirstTimeRef.current = firstTime
        }
        updateOrderLabelPositions()
    }, [candles, timeframe, viewportKey, restoreViewport, updateOrderLabelPositions])

    // Save previous key state and allow restore when pair/timeframe key changes.
    useEffect(() => {
        const prev = prevViewportKeyRef.current
        if (prev && prev !== viewportKey) {
            persistViewport(prev)
            restoredViewportKeyRef.current = ""
        }
        prevViewportKeyRef.current = viewportKey
    }, [viewportKey, persistViewport])

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

        // Add current price line (main market price / last)
        if (quote && (quote.last || quote.bid)) {
            const currentPrice = parseFloat(quote.last || quote.bid)
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

    // Update order lines
    useEffect(() => {
        const series = seriesRef.current
        if (!series) return

        // Remove old order lines
        orderLinesRef.current.forEach(line => {
            try { series.removePriceLine(line) } catch { /* ignore */ }
        })
        orderLinesRef.current = []
        orderLabelItemsRef.current.forEach((item) => item.node.remove())
        orderLabelItemsRef.current = []

        const labelsLayer = orderLabelsLayerRef.current
        if (labelsLayer) {
            labelsLayer.replaceChildren()
        }

        const cfg = marketConfig[marketPair]
        openOrders.forEach(o => {
            if (!o.price) return
            let price = parseFloat(o.price)
            if (cfg?.invertForApi && price > 0) {
                price = 1 / price
            }
            if (isNaN(price) || price <= 0) return

            const qty = parseFloat(o.qty || "0")
            const lotTitle = !isNaN(qty) && qty > 0 ? qty.toFixed(2) : ""

            const line = series.createPriceLine({
                price,
                color: o.side === "buy" ? "rgba(59,130,246,0.75)" : "rgba(239,68,68,0.75)",
                lineWidth: 1,
                lineStyle: 2,
                axisLabelVisible: false,
                title: lotTitle
            })
            orderLinesRef.current.push(line)

            if (labelsLayer && lotTitle) {
                const labelNode = document.createElement("div")
                labelNode.className = `order-lot-label ${o.side === "buy" ? "buy" : "sell"}`
                labelNode.textContent = lotTitle
                labelsLayer.appendChild(labelNode)
                orderLabelItemsRef.current.push({ price, node: labelNode })
            }
        })
        updateOrderLabelPositions()
    }, [openOrders, marketPair, marketConfig, updateOrderLabelPositions])

    // Keep left-side lot labels synced with price scale/viewport changes
    useEffect(() => {
        const id = window.setInterval(() => {
            updateOrderLabelPositions()
        }, 120)
        return () => window.clearInterval(id)
    }, [updateOrderLabelPositions])

    return (
        <div
            ref={containerRef}
            className="trading-chart-container"
            style={{
                position: "relative",
                width: "100%",
                height: "100%"
            }}
        >
            <div ref={orderLabelsLayerRef} className="order-labels-layer" />
        </div>
    )
}
