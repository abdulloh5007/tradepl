import { useState, useEffect, useCallback } from "react"
import type { Order, Metrics } from "../types"
import type { createApiClient, PlaceOrderPayload } from "../api"

type ApiClient = ReturnType<typeof createApiClient>

interface UseTradingOptions {
    api: ApiClient
    token: string
}

export function useTrading({ api, token }: UseTradingOptions) {
    const [openOrders, setOpenOrders] = useState<Order[]>([])
    const [metrics, setMetrics] = useState<Metrics>({
        balance: "0",
        equity: "0",
        margin: "0",
        free_margin: "0",
        margin_level: "0",
        pl: "0"
    })

    const fetchMetrics = useCallback(async () => {
        if (!token) return
        try {
            const m = await api.metrics()
            if (m) setMetrics(m)
        } catch {
            // ignore
        }
    }, [api, token])

    const fetchOrders = useCallback(async () => {
        if (!token) return
        try {
            const orders = await api.orders()
            setOpenOrders(orders || [])
        } catch {
            // ignore
        }
    }, [api, token])

    const placeOrder = useCallback(async (payload: PlaceOrderPayload) => {
        const res = await api.placeOrder(payload)
        await fetchOrders()
        await fetchMetrics()
        return res
    }, [api, fetchOrders, fetchMetrics])

    const cancelOrder = useCallback(async (orderId: string) => {
        const res = await api.cancelOrder(orderId)
        await fetchOrders()
        await fetchMetrics()
        return res
    }, [api, fetchOrders, fetchMetrics])

    // Polling for live updates
    useEffect(() => {
        if (!token) return
        let active = true

        const poll = () => {
            if (!active) return
            fetchMetrics()
            fetchOrders()
        }

        poll()
        const interval = setInterval(poll, 2000)

        return () => {
            active = false
            clearInterval(interval)
        }
    }, [token, fetchMetrics, fetchOrders])

    return {
        openOrders,
        metrics,
        placeOrder,
        cancelOrder,
        fetchOrders,
        fetchMetrics
    }
}
