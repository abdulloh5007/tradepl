import { useEffect, useState } from "react"
import { ShieldAlert } from "lucide-react"
import type { TradingRiskConfig } from "./types"

interface TradingRiskCardProps {
    value: TradingRiskConfig | null
    loading: boolean
    initialLoad: boolean
    canAccess: boolean
    onSave: (next: TradingRiskConfig) => Promise<void>
}

export default function TradingRiskCard({ value, loading, initialLoad, canAccess, onSave }: TradingRiskCardProps) {
    const [draft, setDraft] = useState<TradingRiskConfig | null>(value)

    useEffect(() => {
        setDraft(value)
    }, [value])

    if (!canAccess) return null

    const update = (key: keyof TradingRiskConfig, val: string) => {
        setDraft(prev => {
            const base = prev || {
                max_open_positions: 200,
                max_order_lots: "100",
                max_order_notional_usd: "50000",
                margin_call_level_pct: "60",
                stop_out_level_pct: "20",
                unlimited_effective_leverage: 3000
            }
            if (key === "max_open_positions" || key === "unlimited_effective_leverage") {
                return { ...base, [key]: Number(val || 0) }
            }
            return { ...base, [key]: val }
        })
    }

    return (
        <div className="admin-card">
            <div className="admin-card-header">
                <ShieldAlert size={20} />
                <h2>Trading Risk</h2>
            </div>

            {initialLoad && !draft ? (
                <div className="no-events">Loading risk config...</div>
            ) : (
                <div className="risk-grid">
                    <label className="risk-field">
                        <span>Max Open Positions</span>
                        <input
                            type="number"
                            min="1"
                            value={String(draft?.max_open_positions ?? 0)}
                            onChange={e => update("max_open_positions", e.target.value)}
                        />
                    </label>

                    <label className="risk-field">
                        <span>Max Order Lots</span>
                        <input
                            type="text"
                            value={draft?.max_order_lots ?? ""}
                            onChange={e => update("max_order_lots", e.target.value)}
                        />
                    </label>

                    <label className="risk-field">
                        <span>Max Order Notional (USD)</span>
                        <input
                            type="text"
                            value={draft?.max_order_notional_usd ?? ""}
                            onChange={e => update("max_order_notional_usd", e.target.value)}
                        />
                    </label>

                    <label className="risk-field">
                        <span>Margin Call %</span>
                        <input
                            type="text"
                            value={draft?.margin_call_level_pct ?? ""}
                            onChange={e => update("margin_call_level_pct", e.target.value)}
                        />
                    </label>

                    <label className="risk-field">
                        <span>Stop Out %</span>
                        <input
                            type="text"
                            value={draft?.stop_out_level_pct ?? ""}
                            onChange={e => update("stop_out_level_pct", e.target.value)}
                        />
                    </label>

                    <label className="risk-field">
                        <span>Unlimited Effective Leverage</span>
                        <input
                            type="number"
                            min="1"
                            value={String(draft?.unlimited_effective_leverage ?? 0)}
                            onChange={e => update("unlimited_effective_leverage", e.target.value)}
                        />
                    </label>
                </div>
            )}

            <div className="risk-actions">
                <button
                    className="add-event-btn"
                    disabled={loading || !draft}
                    onClick={() => {
                        if (!draft) return
                        onSave(draft).catch(() => { })
                    }}
                >
                    {loading ? "Saving..." : "Save Risk Config"}
                </button>
            </div>
        </div>
    )
}
