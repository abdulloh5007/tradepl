import { useEffect, useRef, useState } from "react"
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
  const bid = quote?.bid || "—"
  const ask = quote?.ask || "—"
  const qtyHint = "0.01 - 999.99"
  const [minusMenuOpen, setMinusMenuOpen] = useState(false)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const minusMenuRef = useRef<HTMLDivElement | null>(null)
  const plusMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (minusMenuRef.current && !minusMenuRef.current.contains(target)) {
        setMinusMenuOpen(false)
      }
      if (plusMenuRef.current && !plusMenuRef.current.contains(target)) {
        setPlusMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  const clampQty = (value: number) => {
    if (!Number.isFinite(value)) return 0.01
    if (value < 0.01) return 0.01
    if (value > 999.99) return 999.99
    return Math.round(value * 100) / 100
  }

  const normalizeRawQtyInput = (value: string): string | null => {
    const cleaned = value.replace(/,/g, ".").replace(/[^\d.]/g, "")
    if (!cleaned) return ""
    const firstDot = cleaned.indexOf(".")
    const raw = firstDot === -1
      ? cleaned
      : `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, "")}`
    if (raw === ".") return "0."
    const [rawInt, rawFrac = ""] = raw.split(".")
    const intPart = rawInt.slice(0, 3)
    const fracPart = rawFrac.slice(0, 2)
    if (rawInt.length > 3) return null
    if (rawFrac.length > 2) return null
    const normalizedInt = intPart === "" ? "0" : intPart
    if (raw.endsWith(".") && fracPart.length === 0) {
      return `${normalizedInt}.`
    }
    const normalized = fracPart.length > 0 ? `${normalizedInt}.${fracPart}` : normalizedInt
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed)) return null
    if (parsed > 999.99) return null
    return normalized
  }

  const applyDelta = (delta: number) => {
    const current = Number(quickQty)
    const base = Number.isFinite(current) ? current : 0.01
    const next = clampQty(base + delta)
    setQuickQty(next.toFixed(2))
    setMinusMenuOpen(false)
    setPlusMenuOpen(false)
  }

  const quickSteps = [1, 10, 20]

  return (
    <div className="market-panel">
      {/* Quantity Input */}
      <div className="lot-control">
        <div className="lot-row">
          <div className="lot-side left">
            <button
              type="button"
              onClick={() => applyDelta(-0.01)}
              className="lot-step-btn"
            >
              -0.01
            </button>
            <button
              type="button"
              onClick={() => applyDelta(-0.05)}
              className="lot-step-btn"
            >
              -0.05
            </button>
            <div ref={minusMenuRef} className="lot-menu-wrap left">
              <button type="button" className="lot-menu-toggle" onClick={() => setMinusMenuOpen(v => !v)}>-⋯</button>
              {minusMenuOpen && (
                <div className="lot-menu">
                {quickSteps.map(step => (
                  <button key={`minus-${step}`} type="button" onClick={() => applyDelta(-step)} className="lot-menu-item">
                    -{step}
                  </button>
                ))}
                </div>
              )}
            </div>
          </div>

          <div className="lot-input-wrap">
            <input
              inputMode="decimal"
              value={quickQty}
              onChange={e => {
                const next = normalizeRawQtyInput(e.target.value)
                if (next !== null) setQuickQty(next)
              }}
              onBlur={() => {
                const parsed = Number(quickQty)
                if (!Number.isFinite(parsed)) {
                  setQuickQty("0.01")
                  return
                }
                setQuickQty(clampQty(parsed).toFixed(2))
              }}
              placeholder={t("qty", lang)}
              className="lot-input"
            />
          </div>

          <div className="lot-side right">
            <button
              type="button"
              onClick={() => applyDelta(0.01)}
              className="lot-step-btn"
            >
              +0.01
            </button>
            <button
              type="button"
              onClick={() => applyDelta(0.05)}
              className="lot-step-btn"
            >
              +0.05
            </button>
            <div ref={plusMenuRef} className="lot-menu-wrap right">
              <button type="button" className="lot-menu-toggle" onClick={() => setPlusMenuOpen(v => !v)}>+⋯</button>
              {plusMenuOpen && (
                <div className="lot-menu">
                {quickSteps.map(step => (
                  <button key={`plus-${step}`} type="button" onClick={() => applyDelta(step)} className="lot-menu-item">
                    +{step}
                  </button>
                ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="lot-hint">
          Lot: {qtyHint}
        </div>
      </div>

      {/* Buy/Sell Buttons */}
      <button
        onClick={onSell}
        className="market-order-btn sell"
      >
        <div style={{ display: "grid", gap: 2 }}>
          <span>{t("sell", lang)}</span>
          <span style={{ fontSize: 12, opacity: 0.9 }}>{t("bid", lang)} {bid}</span>
        </div>
      </button>
      <button
        onClick={onBuy}
        className="market-order-btn buy"
      >
        <div style={{ display: "grid", gap: 2 }}>
          <span>{t("buy", lang)}</span>
          <span style={{ fontSize: 12, opacity: 0.9 }}>{t("ask", lang)} {ask}</span>
        </div>
      </button>
    </div>
  )
}
