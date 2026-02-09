import { useEffect, useRef, useState } from "react"
import PositionsTable from "../components/PositionsTable"
import AccountMetrics from "../components/AccountMetrics"
import type { Order, Quote, Lang, MarketConfig, Metrics } from "../types"

interface PositionsPageProps {
    metrics: Metrics
    orders: Order[]
    quote: Quote | null
    marketPair: string
    marketConfig: Record<string, MarketConfig>
    marketPrice: number
    onClose: (orderId: string) => void
    onCloseAll: () => void
    onCloseProfit: () => void
    onCloseLoss: () => void
    bulkClosing: boolean
    lang: Lang
}

export default function PositionsPage({
    metrics,
    orders,
    quote,
    marketPair,
    marketConfig,
    marketPrice,
    onClose,
    onCloseAll,
    onCloseProfit,
    onCloseLoss,
    bulkClosing,
    lang
}: PositionsPageProps) {
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const onClickOutside = (e: MouseEvent) => {
            if (!menuRef.current) return
            if (!menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false)
            }
        }
        window.addEventListener("mousedown", onClickOutside)
        return () => window.removeEventListener("mousedown", onClickOutside)
    }, [])

    return (
        <div style={{ maxWidth: 1200 }}>
            <h2 style={{ marginBottom: 16 }}>Trade</h2>
            <AccountMetrics metrics={metrics} lang={lang} />
            <div style={{ height: 16 }} />
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>Open Positions</h2>
                <div style={{ position: "relative" }} ref={menuRef}>
                    <button
                        onClick={() => setMenuOpen(v => !v)}
                        disabled={bulkClosing}
                        style={{
                            border: "1px solid var(--border-subtle)",
                            background: "var(--card-bg)",
                            color: "var(--text-base)",
                            borderRadius: 8,
                            width: 36,
                            height: 32,
                            cursor: bulkClosing ? "not-allowed" : "pointer",
                            fontSize: 18,
                            lineHeight: 1
                        }}
                        aria-label="Open close menu"
                    >
                        ⋯
                    </button>
                    {menuOpen && (
                        <div
                            style={{
                                position: "absolute",
                                right: 0,
                                top: 36,
                                minWidth: 220,
                                background: "var(--card-bg)",
                                border: "1px solid var(--border-subtle)",
                                borderRadius: 8,
                                boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
                                padding: 6,
                                zIndex: 20
                            }}
                        >
                            <MenuItem
                                label="Close All"
                                disabled={bulkClosing}
                                onClick={() => {
                                    setMenuOpen(false)
                                    onCloseAll()
                                }}
                            />
                            <MenuItem
                                label="Close Profit"
                                disabled={bulkClosing}
                                onClick={() => {
                                    setMenuOpen(false)
                                    onCloseProfit()
                                }}
                            />
                            <MenuItem
                                label="Close Loss"
                                disabled={bulkClosing}
                                onClick={() => {
                                    setMenuOpen(false)
                                    onCloseLoss()
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
            <PositionsTable
                orders={orders}
                quote={quote}
                marketPair={marketPair}
                marketConfig={marketConfig}
                marketPrice={marketPrice}
                onClose={onClose}
                lang={lang}
            />
        </div>
    )
}

function MenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            style={{
                width: "100%",
                textAlign: "left",
                border: "none",
                background: "transparent",
                color: "var(--text-base)",
                padding: "8px 10px",
                borderRadius: 6,
                cursor: disabled ? "not-allowed" : "pointer"
            }}
        >
            {label}
        </button>
    )
}
