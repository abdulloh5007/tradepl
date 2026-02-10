import type { TradingAccount } from "../../types"
import { formatNumber } from "../../utils/format"

export const leverageOptions = [0, 2, 5, 10, 20, 30, 40, 50, 100, 200, 500, 1000, 2000, 3000]

export const leverageLabel = (value: number) => {
  if (value === 0) return "Unlimited"
  return `1:${formatNumber(value, 0, 0)}`
}

export const getLeverage = (account: TradingAccount) => {
  if (Number.isFinite(account.leverage)) return account.leverage
  if (Number.isFinite(account.plan?.leverage)) return account.plan.leverage
  return 100
}

export const formatUsd = (value: number | string) => {
  const num = typeof value === "number" ? value : Number(value || 0)
  if (!Number.isFinite(num)) return "0.00"
  return formatNumber(num, 2, 2)
}

export const formatPercent = (value: number | string) => {
  const num = typeof value === "number" ? value : Number(value || 0)
  if (!Number.isFinite(num)) return "—"
  return `${formatNumber(num, 2, 2)}%`
}

export const accountShortNumericId = (rawID: string) => {
  const digits = (rawID || "").replace(/\D/g, "")
  if (digits.length >= 7) return digits.slice(-7)
  let hash = 0
  for (let i = 0; i < rawID.length; i += 1) {
    hash = (hash * 31 + rawID.charCodeAt(i)) % 10000000
  }
  const generated = String(Math.abs(hash)).padStart(7, "0")
  if (digits.length === 0) return generated
  return `${digits}${generated}`.slice(-7)
}

export const openCountLabel = (count: number) => {
  if (!Number.isFinite(count) || count <= 0) return "0"
  if (count > 99) return "99+"
  return String(Math.floor(count))
}
