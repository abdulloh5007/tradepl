import { useEffect, useMemo, useState } from "react"
import type { Order, Lang } from "../types"
import { t } from "../utils/i18n"

interface OrderHistoryTableProps {
    orders: Order[]
    lang: Lang
}

const money = (v?: string) => {
    const n = Number(v || "0")
    if (!Number.isFinite(n)) return "0.00"
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const qtyFmt = (v?: string) => {
    const n = Number(v || "0")
    if (!Number.isFinite(n)) return "0.00"
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const priceFmt = (v?: string) => {
    const n = Number(v || "0")
    if (!Number.isFinite(n) || n <= 0) return "—"
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })
}

const localTime = (v?: string) => {
    if (!v) return "—"
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return "—"
    return d.toLocaleString()
}

export default function OrderHistoryTable({ orders, lang }: OrderHistoryTableProps) {
    const [selected, setSelected] = useState<Order | null>(null)

    useEffect(() => {
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSelected(null)
        }
        window.addEventListener("keydown", onEsc)
        return () => window.removeEventListener("keydown", onEsc)
    }, [])

    const cards = useMemo(() => orders.map(o => {
        const isBuy = o.side === "buy"
        const symbol = o.pair_id && o.pair_id.includes("-") ? o.pair_id : "UZS-USD"
        return (
            <button
                key={o.id}
                onClick={() => setSelected(o)}
                style={{
                    border: "1px solid var(--border-subtle)",
                    background: "var(--card-bg)",
                    borderRadius: 10,
                    padding: 12,
                    textAlign: "left",
                    cursor: "pointer"
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{
                            fontSize: 11,
                            fontWeight: 700,
                            borderRadius: 999,
                            padding: "2px 8px",
                            color: isBuy ? "#2e6be4" : "#ef4444",
                            background: isBuy ? "rgba(46,107,228,0.12)" : "rgba(239,68,68,0.12)"
                        }}>
                            {isBuy ? "BUY" : "SELL"}
                        </span>
                        <strong style={{ fontSize: 13 }}>{symbol}</strong>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>{o.status || "—"}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
                    <div>
                        <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>{t("volume", lang)}</div>
                        <div style={{ fontWeight: 600 }}>{qtyFmt(o.qty)}</div>
                    </div>
                    <div>
                        <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>Price</div>
                        <div style={{ fontWeight: 600 }}>{priceFmt(o.price)}</div>
                    </div>
                    <div>
                        <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>{t("time", lang)}</div>
                        <div style={{ fontWeight: 600 }}>{localTime(o.created_at)}</div>
                    </div>
                </div>
            </button>
        )
    }), [orders, lang])

    return (
        <>
            <div style={{ display: "grid", gap: 10 }}>
                {orders.length === 0 ? (
                    <div style={{
                        padding: 20,
                        background: "var(--card-bg)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 10,
                        color: "var(--text-muted)",
                        textAlign: "center"
                    }}>
                        No history yet
                    </div>
                ) : cards}
            </div>

            {selected && (
                <div
                    onClick={() => setSelected(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.45)",
                        display: "grid",
                        placeItems: "center",
                        zIndex: 1000,
                        padding: 16
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            width: "min(680px, 100%)",
                            borderRadius: 12,
                            background: "var(--card-bg)",
                            border: "1px solid var(--border-subtle)",
                            overflow: "hidden"
                        }}
                    >
                        <div style={{
                            padding: "12px 14px",
                            borderBottom: "1px solid var(--border-subtle)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center"
                        }}>
                            <strong>Order #{(selected.id || "—").slice(0, 8)}</strong>
                            <button
                                onClick={() => setSelected(null)}
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    cursor: "pointer",
                                    color: "var(--text-muted)",
                                    fontSize: 16
                                }}
                            >
                                ×
                            </button>
                        </div>

                        <div style={{ padding: 14, display: "grid", gap: 10 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
                                <Field label="Ticket" value={selected.id} mono />
                                <Field label="Account" value={selected.trading_account_id || "—"} mono />
                                <Field label="Symbol" value={selected.pair_id && selected.pair_id.includes("-") ? selected.pair_id : "UZS-USD"} />
                                <Field label="Status" value={selected.status || "—"} />
                                <Field label="Type" value={`${(selected.side || "—").toUpperCase()} ${(selected.type || "").toUpperCase()}`.trim()} />
                                <Field label="Time" value={localTime(selected.created_at)} />
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
                                <Field label="Volume" value={qtyFmt(selected.qty)} />
                                <Field label="Open Price" value={priceFmt(selected.price)} />
                                <Field label="Filled" value={qtyFmt(String(Number(selected.qty || "0") - Number(selected.remaining_qty || "0")))} />
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
                                <Field label="Remaining Qty" value={qtyFmt(selected.remaining_qty)} />
                                <Field label="Quote Amount" value={money(selected.quote_amount)} />
                                <Field label="Spent Amount" value={money(selected.spent_amount)} />
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
                                <Field label="Reserved" value={money(selected.reserved_amount)} />
                                <Field label="Remaining Quote" value={money(selected.remaining_quote)} />
                                <Field label="TIF" value={(selected.time_in_force || "—").toUpperCase()} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div style={{
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            padding: "8px 10px",
            background: "var(--bg-subtle)"
        }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, fontFamily: mono ? "monospace" : "inherit", overflowWrap: "anywhere" }}>{value || "—"}</div>
        </div>
    )
}
