import type { Quote, Lang } from "../types"
import { t } from "../utils/i18n"

interface MarketPanelProps {
  quote: Quote | null
  quickQty: string
  setQuickQty: (v: string) => void
  onBuy: () => void
  onSell: () => void
  lang: Lang
}

export default function MarketPanel({ quote, quickQty, setQuickQty, onBuy, onSell, lang }: MarketPanelProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 16,
      padding: 16,
      background: "var(--card-bg)",
      borderRadius: 8
    }}>
      {/* Market Stats */}
      <div style={{
        gridColumn: "1 / -1",
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 8,
        marginBottom: 8
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("price", lang)}</div>
          <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {quote?.last || "—"}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("bid", lang)}</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>
            {quote?.bid || "—"}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("ask", lang)}</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#ef4444", fontVariantNumeric: "tabular-nums" }}>
            {quote?.ask || "—"}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("spread", lang)}</div>
          <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {quote?.spread || "—"}
          </div>
        </div>
      </div>

      {/* Quantity Input */}
      <div style={{ gridColumn: "1 / -1", marginBottom: 8 }}>
        <input
          type="number"
          value={quickQty}
          onChange={e => setQuickQty(e.target.value)}
          placeholder={t("qty", lang)}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
            background: "var(--input-bg)",
            color: "var(--text-base)",
            fontSize: 14
          }}
        />
      </div>

      {/* Buy/Sell Buttons */}
      <button
        onClick={onSell}
        style={{
          padding: "14px 0",
          background: "linear-gradient(180deg, #ef4444 0%, #dc2626 100%)",
          color: "white",
          border: "none",
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 15,
          cursor: "pointer"
        }}
      >
        {t("sell", lang)}
      </button>
      <button
        onClick={onBuy}
        style={{
          padding: "14px 0",
          background: "linear-gradient(180deg, #16a34a 0%, #15803d 100%)",
          color: "white",
          border: "none",
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 15,
          cursor: "pointer"
        }}
      >
        {t("buy", lang)}
      </button>
    </div>
  )
}
