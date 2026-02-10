import { useEffect, useState } from "react"
import { CandlestickChart } from "lucide-react"
import type { TradingPairSpec } from "./types"

interface TradingPairsCardProps {
    pairs: TradingPairSpec[]
    loading: boolean
    initialLoad: boolean
    canAccess: boolean
    onSave: (symbol: string, payload: Partial<TradingPairSpec>) => Promise<void>
}

type DraftMap = Record<string, TradingPairSpec>

export default function TradingPairsCard({ pairs, loading, initialLoad, canAccess, onSave }: TradingPairsCardProps) {
    const [drafts, setDrafts] = useState<DraftMap>({})

    useEffect(() => {
        const next: DraftMap = {}
        for (const p of pairs) next[p.symbol] = { ...p }
        setDrafts(next)
    }, [pairs])

    if (!canAccess) return null

    const update = (symbol: string, key: keyof TradingPairSpec, val: string) => {
        setDrafts(prev => ({
            ...prev,
            [symbol]: {
                ...(prev[symbol] || { symbol, contract_size: "", lot_step: "", min_lot: "", max_lot: "", status: "" }),
                [key]: val
            }
        }))
    }

    return (
        <div className="admin-card full-width">
            <div className="admin-card-header">
                <CandlestickChart size={20} />
                <h2>Trading Pairs</h2>
            </div>

            {initialLoad && pairs.length === 0 ? (
                <div className="no-events">Loading pairs...</div>
            ) : (
                <div className="pairs-list">
                    {pairs.map(pair => {
                        const d = drafts[pair.symbol] || pair
                        return (
                            <div key={pair.symbol} className="pair-item">
                                <div className="pair-header">
                                    <strong>{pair.symbol}</strong>
                                    <span className={`pair-status ${String(d.status).toLowerCase() === "active" ? "active" : "disabled"}`}>
                                        {d.status || "unknown"}
                                    </span>
                                </div>

                                <div className="pair-grid">
                                    <label className="risk-field">
                                        <span>Contract Size</span>
                                        <input value={d.contract_size} onChange={e => update(pair.symbol, "contract_size", e.target.value)} />
                                    </label>
                                    <label className="risk-field">
                                        <span>Lot Step</span>
                                        <input value={d.lot_step} onChange={e => update(pair.symbol, "lot_step", e.target.value)} />
                                    </label>
                                    <label className="risk-field">
                                        <span>Min Lot</span>
                                        <input value={d.min_lot} onChange={e => update(pair.symbol, "min_lot", e.target.value)} />
                                    </label>
                                    <label className="risk-field">
                                        <span>Max Lot</span>
                                        <input value={d.max_lot} onChange={e => update(pair.symbol, "max_lot", e.target.value)} />
                                    </label>
                                    <label className="risk-field">
                                        <span>Status</span>
                                        <select value={d.status} onChange={e => update(pair.symbol, "status", e.target.value)}>
                                            <option value="active">active</option>
                                            <option value="paused">paused</option>
                                            <option value="disabled">disabled</option>
                                        </select>
                                    </label>
                                </div>

                                <div className="risk-actions">
                                    <button
                                        className="add-event-btn"
                                        disabled={loading}
                                        onClick={() => {
                                            const payload: Partial<TradingPairSpec> = {
                                                contract_size: d.contract_size,
                                                lot_step: d.lot_step,
                                                min_lot: d.min_lot,
                                                max_lot: d.max_lot,
                                                status: d.status
                                            }
                                            onSave(pair.symbol, payload).catch(() => { })
                                        }}
                                    >
                                        {loading ? "Saving..." : `Save ${pair.symbol}`}
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
