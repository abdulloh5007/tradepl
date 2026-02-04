import type { Metrics, Lang } from "../types"
import { t } from "../utils/i18n"

interface AccountMetricsProps {
  metrics: Metrics
  lang: Lang
}

export default function AccountMetrics({ metrics, lang }: AccountMetricsProps) {
  const formatValue = (v: string) => {
    const num = parseFloat(v)
    return isNaN(num) ? "0.00" : num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const pl = parseFloat(metrics.pl || "0")
  const plColor = pl >= 0 ? "#16a34a" : "#ef4444"

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
          {metrics.margin_level || "—"}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("profit", lang)}</div>
        <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: plColor }}>
          {pl >= 0 ? "+" : ""}{formatValue(metrics.pl)} USD
        </div>
      </div>
    </div>
  )
}
