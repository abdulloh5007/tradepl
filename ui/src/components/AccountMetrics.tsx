import type { Metrics, Lang } from "../types"
import { t } from "../utils/i18n"
import { formatNumber } from "../utils/format"

interface AccountMetricsProps {
  metrics: Metrics
  lang: Lang
}

export default function AccountMetrics({ metrics, lang }: AccountMetricsProps) {
  const formatValue = (v: string) => {
    const num = parseFloat(v)
    if (isNaN(num)) return "0.00"
    return formatNumber(num, 2, 2)
  }

  const formatMarginLevel = (v: string) => {
    const num = parseFloat(v || "0")
    if (!Number.isFinite(num) || num <= 0) return "—"
    if (num >= 1_000_000) return "∞"
    return `${formatNumber(num, 2, 2)}%`
  }

  const pl = parseFloat(metrics.pl || "0")
  const shownPl = Math.abs(pl) < 0.000000000001 ? 0 : pl
  const plColor = shownPl >= 0 ? "#16a34a" : "#ef4444"

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 12,
      padding: 16,
      background: "var(--card-bg)",
      borderRadius: 8
    }}>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("balance", lang)}</div>
        <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {formatValue(metrics.balance)} USD
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("equity", lang)}</div>
        <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {formatValue(metrics.equity)} USD
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("margin", lang)}</div>
        <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {formatValue(metrics.margin)} USD
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("freeMargin", lang)}</div>
        <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {formatValue(metrics.free_margin)} USD
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("marginLevel", lang)}</div>
        <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {formatMarginLevel(metrics.margin_level)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("profit", lang)}</div>
        <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: plColor }}>
          {shownPl >= 0 ? "+" : ""}{formatValue(String(shownPl))} USD
        </div>
      </div>
    </div>
  )
}
