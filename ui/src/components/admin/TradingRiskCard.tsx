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

const DEFAULT_RISK: TradingRiskConfig = {
    max_open_positions: 200,
    max_order_lots: "100",
    max_order_notional_usd: "50000",
    margin_call_level_pct: "60",
    stop_out_level_pct: "20",
    unlimited_effective_leverage: 3000,
    signup_bonus_total_limit: 700,
    signup_bonus_amount: "10",
    real_deposit_min_usd: "10",
    real_deposit_max_usd: "1000",
    usd_to_uzs_rate: "13000",
    real_deposit_review_minutes: 120,
    telegram_deposit_chat_id: "",
    kyc_bonus_amount: "50",
    kyc_review_eta_hours: 8,
    telegram_kyc_chat_id: "",
    spread_calm_max_add: "0.12",
    spread_spike_threshold: "0.60",
    spread_spike_max_add: "0.20",
    spread_news_pre_mult: "1.08",
    spread_news_post_mult: "1.12",
    spread_news_live_low_mult: "1.20",
    spread_news_live_medium_mult: "1.35",
    spread_news_live_high_mult: "1.55",
    spread_dynamic_cap_mult: "1.75",
    spread_smoothing_alpha: "0.18",
}

const asPositiveNumberString = (value: unknown, fallback: string) => {
    const raw = String(value ?? "").trim()
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return fallback
    return raw
}

const asNonNegativeNumberString = (value: unknown, fallback: string) => {
    const raw = String(value ?? "").trim()
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return fallback
    return raw
}

const normalizeRisk = (value: TradingRiskConfig | null | undefined): TradingRiskConfig => ({
    max_open_positions: Number(value?.max_open_positions) > 0 ? Number(value?.max_open_positions) : DEFAULT_RISK.max_open_positions,
    max_order_lots: asPositiveNumberString(value?.max_order_lots, DEFAULT_RISK.max_order_lots),
    max_order_notional_usd: asPositiveNumberString(value?.max_order_notional_usd, DEFAULT_RISK.max_order_notional_usd),
    margin_call_level_pct: asPositiveNumberString(value?.margin_call_level_pct, DEFAULT_RISK.margin_call_level_pct),
    stop_out_level_pct: asPositiveNumberString(value?.stop_out_level_pct, DEFAULT_RISK.stop_out_level_pct),
    unlimited_effective_leverage: Number(value?.unlimited_effective_leverage) > 0 ? Number(value?.unlimited_effective_leverage) : DEFAULT_RISK.unlimited_effective_leverage,
    signup_bonus_total_limit: Number(value?.signup_bonus_total_limit) > 0 ? Number(value?.signup_bonus_total_limit) : DEFAULT_RISK.signup_bonus_total_limit,
    signup_bonus_amount: asPositiveNumberString(value?.signup_bonus_amount, DEFAULT_RISK.signup_bonus_amount),
    real_deposit_min_usd: asPositiveNumberString(value?.real_deposit_min_usd, DEFAULT_RISK.real_deposit_min_usd),
    real_deposit_max_usd: asPositiveNumberString(value?.real_deposit_max_usd, DEFAULT_RISK.real_deposit_max_usd),
    usd_to_uzs_rate: asPositiveNumberString(value?.usd_to_uzs_rate, DEFAULT_RISK.usd_to_uzs_rate),
    real_deposit_review_minutes: Number(value?.real_deposit_review_minutes) > 0 ? Number(value?.real_deposit_review_minutes) : DEFAULT_RISK.real_deposit_review_minutes,
    telegram_deposit_chat_id: String(value?.telegram_deposit_chat_id || DEFAULT_RISK.telegram_deposit_chat_id).trim(),
    kyc_bonus_amount: asPositiveNumberString(value?.kyc_bonus_amount, DEFAULT_RISK.kyc_bonus_amount),
    kyc_review_eta_hours: Number(value?.kyc_review_eta_hours) > 0 ? Number(value?.kyc_review_eta_hours) : DEFAULT_RISK.kyc_review_eta_hours,
    telegram_kyc_chat_id: String(value?.telegram_kyc_chat_id || DEFAULT_RISK.telegram_kyc_chat_id).trim(),
    spread_calm_max_add: asNonNegativeNumberString(value?.spread_calm_max_add, DEFAULT_RISK.spread_calm_max_add),
    spread_spike_threshold: asNonNegativeNumberString(value?.spread_spike_threshold, DEFAULT_RISK.spread_spike_threshold),
    spread_spike_max_add: asNonNegativeNumberString(value?.spread_spike_max_add, DEFAULT_RISK.spread_spike_max_add),
    spread_news_pre_mult: asPositiveNumberString(value?.spread_news_pre_mult, DEFAULT_RISK.spread_news_pre_mult),
    spread_news_post_mult: asPositiveNumberString(value?.spread_news_post_mult, DEFAULT_RISK.spread_news_post_mult),
    spread_news_live_low_mult: asPositiveNumberString(value?.spread_news_live_low_mult, DEFAULT_RISK.spread_news_live_low_mult),
    spread_news_live_medium_mult: asPositiveNumberString(value?.spread_news_live_medium_mult, DEFAULT_RISK.spread_news_live_medium_mult),
    spread_news_live_high_mult: asPositiveNumberString(value?.spread_news_live_high_mult, DEFAULT_RISK.spread_news_live_high_mult),
    spread_dynamic_cap_mult: asPositiveNumberString(value?.spread_dynamic_cap_mult, DEFAULT_RISK.spread_dynamic_cap_mult),
    spread_smoothing_alpha: asPositiveNumberString(value?.spread_smoothing_alpha, DEFAULT_RISK.spread_smoothing_alpha),
})

export default function TradingRiskCard({ value, loading, initialLoad, canAccess, onSave }: TradingRiskCardProps) {
    const [draft, setDraft] = useState<TradingRiskConfig>(normalizeRisk(value))

    useEffect(() => {
        setDraft(normalizeRisk(value))
    }, [value])

    if (!canAccess) return null

    const update = (key: keyof TradingRiskConfig, val: string) => {
        setDraft(prev => {
            if (
                key === "max_open_positions" ||
                key === "unlimited_effective_leverage" ||
                key === "signup_bonus_total_limit" ||
                key === "real_deposit_review_minutes" ||
                key === "kyc_review_eta_hours"
            ) {
                return { ...prev, [key]: Number(val || 0) }
            }
            return { ...prev, [key]: val }
        })
    }

    return (
        <div className="admin-card">
            <div className="admin-card-header">
                <ShieldAlert size={20} />
                <h2>Order Limits</h2>
            </div>

            {initialLoad && !draft ? (
                <div className="no-events">Loading risk config...</div>
            ) : (
                <div className="risk-grid">
                    <label className="risk-field">
                        <span>Max Orders</span>
                        <input
                            type="number"
                            min="1"
                            value={String(draft.max_open_positions)}
                            onChange={e => update("max_open_positions", e.target.value)}
                        />
                    </label>

                    <label className="risk-field">
                        <span>Max Lot Size Per Order</span>
                        <input
                            type="text"
                            value={draft.max_order_lots}
                            onChange={e => update("max_order_lots", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>Real Deposit Min (USD)</span>
                        <input
                            type="text"
                            value={draft.real_deposit_min_usd}
                            onChange={e => update("real_deposit_min_usd", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>Real Deposit Max (USD)</span>
                        <input
                            type="text"
                            value={draft.real_deposit_max_usd}
                            onChange={e => update("real_deposit_max_usd", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>USD to UZS Rate</span>
                        <input
                            type="text"
                            value={draft.usd_to_uzs_rate}
                            onChange={e => update("usd_to_uzs_rate", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>Telegram Deposit Review Chat ID</span>
                        <input
                            type="text"
                            value={draft.telegram_deposit_chat_id}
                            onChange={e => update("telegram_deposit_chat_id", e.target.value)}
                            placeholder="-1001234567890"
                        />
                    </label>
                    <label className="risk-field">
                        <span>KYC Bonus Amount (USD)</span>
                        <input
                            type="text"
                            value={draft.kyc_bonus_amount}
                            onChange={e => update("kyc_bonus_amount", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>KYC Review ETA (hours)</span>
                        <input
                            type="number"
                            min="1"
                            value={String(draft.kyc_review_eta_hours)}
                            onChange={e => update("kyc_review_eta_hours", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>Telegram KYC Review Chat ID</span>
                        <input
                            type="text"
                            value={draft.telegram_kyc_chat_id}
                            onChange={e => update("telegram_kyc_chat_id", e.target.value)}
                            placeholder="-1001234567890"
                        />
                    </label>
                    <label className="risk-field">
                        <span>Spread Calm Max Add</span>
                        <input
                            type="text"
                            value={draft.spread_calm_max_add}
                            onChange={e => update("spread_calm_max_add", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>Spread Spike Threshold</span>
                        <input
                            type="text"
                            value={draft.spread_spike_threshold}
                            onChange={e => update("spread_spike_threshold", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>Spread Spike Max Add</span>
                        <input
                            type="text"
                            value={draft.spread_spike_max_add}
                            onChange={e => update("spread_spike_max_add", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>News Pre Mult</span>
                        <input
                            type="text"
                            value={draft.spread_news_pre_mult}
                            onChange={e => update("spread_news_pre_mult", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>News Post Mult</span>
                        <input
                            type="text"
                            value={draft.spread_news_post_mult}
                            onChange={e => update("spread_news_post_mult", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>News Live Low Mult</span>
                        <input
                            type="text"
                            value={draft.spread_news_live_low_mult}
                            onChange={e => update("spread_news_live_low_mult", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>News Live Medium Mult</span>
                        <input
                            type="text"
                            value={draft.spread_news_live_medium_mult}
                            onChange={e => update("spread_news_live_medium_mult", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>News Live High Mult</span>
                        <input
                            type="text"
                            value={draft.spread_news_live_high_mult}
                            onChange={e => update("spread_news_live_high_mult", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>Spread Dynamic Cap Mult</span>
                        <input
                            type="text"
                            value={draft.spread_dynamic_cap_mult}
                            onChange={e => update("spread_dynamic_cap_mult", e.target.value)}
                        />
                    </label>
                    <label className="risk-field">
                        <span>Spread Smoothing Alpha</span>
                        <input
                            type="text"
                            value={draft.spread_smoothing_alpha}
                            onChange={e => update("spread_smoothing_alpha", e.target.value)}
                        />
                    </label>
                    <div className="risk-field">
                        <span>System</span>
                        <div className="no-events" style={{ margin: 0, padding: "11px 12px", textAlign: "left" }}>
                            Margin call, stop out, deposit and KYC bonus pools are auto-managed. Requests go to Telegram review chats when chat IDs are configured.
                        </div>
                    </div>
                </div>
            )}

            <div className="risk-actions">
                <button
                    className="add-event-btn"
                    disabled={loading}
                    onClick={() => {
                        onSave(normalizeRisk(draft)).catch(() => { })
                    }}
                >
                    {loading ? "Saving..." : "Save Risk Config"}
                </button>
            </div>
        </div>
    )
}
