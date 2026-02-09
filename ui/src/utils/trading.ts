import type { MarketConfig, Order } from "../types"

export function calcOrderProfit(
  order: Order,
  bidDisplay: number,
  askDisplay: number,
  marketPair: string,
  marketConfig: Record<string, MarketConfig>
): number {
  const backendPnL = parseFloat(order.unrealized_pnl || "")
  if (Number.isFinite(backendPnL)) return backendPnL

  const cfg = marketConfig[marketPair] || (marketPair === "UZS-USD" ? { invertForApi: true, displayDecimals: 2 } : undefined)

  const qty = parseFloat(order.qty || "0")
  if (!Number.isFinite(qty) || qty <= 0) return 0

  const remainingQty = parseFloat(order.remaining_qty || "0")
  const filledQty = Number.isFinite(remainingQty) ? Math.max(0, qty - remainingQty) : qty
  if (filledQty <= 0) return 0

  const entryRaw = parseFloat(order.price || "0")
  if (!Number.isFinite(entryRaw) || entryRaw <= 0) return 0

  const contractSize = marketPair === "UZS-USD" ? 1 : 1
  const toRaw = (displayPrice: number) => {
    if (!Number.isFinite(displayPrice) || displayPrice <= 0) return 0
    if (cfg?.invertForApi) return 1 / displayPrice
    return displayPrice
  }

  const isBuy = order.side === "buy"
  if (cfg?.invertForApi) {
    const entryDisplay = 1 / entryRaw
    if (!Number.isFinite(entryDisplay) || entryDisplay <= 0) return 0
    if (isBuy) return (askDisplay - entryDisplay) * filledQty * contractSize
    return (entryDisplay - bidDisplay) * filledQty * contractSize
  }

  const rawBid = toRaw(bidDisplay)
  const rawAsk = toRaw(askDisplay)
  if (!Number.isFinite(rawBid) || !Number.isFinite(rawAsk) || rawBid <= 0 || rawAsk <= 0) return 0
  if (isBuy) return (rawBid - entryRaw) * filledQty * contractSize
  return (entryRaw - rawAsk) * filledQty * contractSize
}
