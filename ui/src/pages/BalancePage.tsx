import AccountMetrics from "../components/AccountMetrics"
import type { Metrics, Lang } from "../types"

interface BalancePageProps {
    metrics: Metrics
    lang: Lang
}

export default function BalancePage({ metrics, lang }: BalancePageProps) {
    const formatValue = (v: string) => {
        const num = parseFloat(v)
        return isNaN(num) ? "0.00" : num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    return (
        <div style={{ maxWidth: 800 }}>
            <h2 style={{ marginBottom: 24 }}>Account Balance</h2>

            {/* Main Stats */}
            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 16,
                marginBottom: 24
            }}>
                <div style={{ background: "var(--card-bg)", padding: 24, borderRadius: 12 }}>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>Balance</div>
                    <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        ${formatValue(metrics.balance)}
                    </div>
                </div>
                <div style={{ background: "var(--card-bg)", padding: 24, borderRadius: 12 }}>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>Equity</div>
                    <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        ${formatValue(metrics.equity)}
                    </div>
                </div>
            </div>

            {/* Detailed Metrics */}
            <AccountMetrics metrics={metrics} lang={lang} />
        </div>
    )
}
