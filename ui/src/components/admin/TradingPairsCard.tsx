import { useEffect, useState } from "react"
import { CandlestickChart } from "lucide-react"
import type { TradingPairSpec } from "./types"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

interface TradingPairsCardProps {
    lang: Lang
    pairs: TradingPairSpec[]
    loading: boolean
    initialLoad: boolean
    canAccess: boolean
    onSave: (symbol: string, payload: Partial<TradingPairSpec>) => Promise<void>
}

type DraftMap = Record<string, TradingPairSpec>

export default function TradingPairsCard({ lang, pairs, loading, initialLoad, canAccess, onSave }: TradingPairsCardProps) {
    const [drafts, setDrafts] = useState<DraftMap>({})

    useEffect(() => {
        const next: DraftMap = {}
        for (const p of pairs) next[p.symbol] = { ...p }
        setDrafts(next)
    }, [pairs])

    if (!canAccess) return null
    if (!initialLoad && pairs.length === 0) return null

    const update = (symbol: string, key: keyof TradingPairSpec, val: string) => {
        setDrafts(prev => ({
            ...prev,
            [symbol]: {
                ...(prev[symbol] || { symbol, contract_size: "", lot_step: "0.01", min_lot: "", max_lot: "", status: "active" }),
                [key]: val
            }
        }))
    }

    return (
        <div className="admin-card full-width">
            <div className="admin-card-header">
                <CandlestickChart size={20} />
                <h2>{t("manage.pairs.title", lang)}</h2>
            </div>

            {initialLoad && pairs.length === 0 ? (
                <div className="no-events">{t("manage.pairs.loading", lang)}</div>
            ) : (
                <div className="pairs-list">
                    {pairs.map(pair => {
                        const d = drafts[pair.symbol] || pair
                        return (
                            <div key={pair.symbol} className="pair-item">
                                <div className="pair-header">
                                    <strong>{pair.symbol}</strong>
                                </div>

                                <div className="pair-grid">
                                    <label className="risk-field">
                                        <span>{t("manage.pairs.contractSize", lang)}</span>
                                        <input value={d.contract_size} onChange={e => update(pair.symbol, "contract_size", e.target.value)} />
                                    </label>
                                    <label className="risk-field">
                                        <span>{t("manage.pairs.minLot", lang)}</span>
                                        <input value={d.min_lot} onChange={e => update(pair.symbol, "min_lot", e.target.value)} />
                                    </label>
                                    <label className="risk-field">
                                        <span>{t("manage.pairs.maxLot", lang)}</span>
                                        <input value={d.max_lot} onChange={e => update(pair.symbol, "max_lot", e.target.value)} />
                                    </label>
                                </div>

                                <div className="risk-actions">
                                    <button
                                        className="add-event-btn"
                                        disabled={loading}
                                        onClick={() => {
                                            const payload: Partial<TradingPairSpec> = {
                                                contract_size: d.contract_size,
                                                min_lot: d.min_lot,
                                                max_lot: d.max_lot
                                            }
                                            onSave(pair.symbol, payload).catch(() => { })
                                        }}
                                    >
                                        {loading ? t("common.saving", lang) : t("manage.pairs.saveSymbol", lang).replace("{symbol}", pair.symbol)}
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
