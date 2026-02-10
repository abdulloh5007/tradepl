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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
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
  }

  const setFixedQty = (val: number) => {
    setQuickQty(val.toFixed(2))
    // Do not close menu as requested
  }

  const quickSteps = [0.01, 0.05, 0.1, 0.2, 0.5, 1.0]

  return (
    <div className="market-panel">
      {/* Quantity Input Row */}
      <div className="lot-control">
        <div className="lot-row-new">
          <button
            type="button"
            onClick={() => applyDelta(0.01)}
            className="lot-step-btn-new"
          >
            +0.01
          </button>

          <div className="lot-input-wrap-new">
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
              className="lot-input-new"
            />
          </div>

          <div className="lot-menu-wrap-new" ref={menuRef}>
            <button
              type="button"
              className={`lot-menu-toggle-new ${menuOpen ? "active" : ""}`}
              onClick={() => setMenuOpen(v => !v)}
            >
              Presets
            </button>
            {menuOpen && (
              <div className="lot-menu-new">
                {quickSteps.map(step => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => setFixedQty(step)}
                    className="lot-preset-btn"
                  >
                    {step}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Buy/Sell Buttons */}
      <div className="trade-buttons-row">
        <button
          onClick={onSell}
          className="market-order-btn sell"
        >
          <div className="btn-content">
            <span className="btn-label">{t("sell", lang)}</span>
            <span className="btn-price">{bid}</span>
          </div>
        </button>
        <button
          onClick={onBuy}
          className="market-order-btn buy"
        >
          <div className="btn-content">
            <span className="btn-label">{t("buy", lang)}</span>
            <span className="btn-price">{ask}</span>
          </div>
        </button>
      </div>
    </div>
  )
}

