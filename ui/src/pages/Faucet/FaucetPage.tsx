import { toast } from "sonner"
import type { Lang } from "../../types"
import { formatNumber } from "../../utils/format"
import { t } from "../../utils/i18n"
import "./FaucetPage.css"

interface FaucetPageProps {
    api: {
        faucet: (payload: { asset: string; amount: string; reference?: string }) => Promise<{ status: string }>
        metrics: () => Promise<{ balance: string; equity: string; margin: string; free_margin: string; margin_level: string; pl: string }>
    }
    onMetricsUpdate: (m: { balance: string; equity: string; margin: string; free_margin: string; margin_level: string; pl: string }) => void
    lang: Lang
    token: string
    onLoginRequired: () => void
}

export default function FaucetPage({ api, onMetricsUpdate, token, onLoginRequired, lang }: FaucetPageProps) {
    const handleFaucet = async (amount: string) => {
        // Check if user is logged in
        if (!token) {
            toast.error(t("faucet.loginFirst", lang))
            onLoginRequired()
            return
        }

        try {
            await api.faucet({ asset: "USD", amount, reference: "dev" })
            toast.success(t("faucet.received", lang).replace("{amount}", amount))
            const m = await api.metrics()
            onMetricsUpdate(m)
        } catch (err: any) {
            toast.error(err?.message || t("common.error", lang))
        }
    }

    return (
        <div style={{ maxWidth: 600 }}>
            <h2 style={{ marginBottom: 16 }}>{t("faucet.testFaucet", lang)}</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
                {t("faucet.description", lang)}
            </p>

            {!token && (
                <div style={{
                    padding: 16,
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: 8,
                    marginBottom: 16,
                    color: "#ef4444"
                }}>
                    ⚠️ {t("faucet.loginToUse", lang)}
                </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                {["10000", "50000", "100000"].map(amount => (
                    <button
                        key={amount}
                        onClick={() => handleFaucet(amount)}
                        disabled={!token}
                        style={{
                            padding: "16px 0",
                            background: token
                                ? "linear-gradient(180deg, #16a34a 0%, #15803d 100%)"
                                : "var(--card-bg)",
                            color: token ? "white" : "var(--text-muted)",
                            border: "1px solid var(--border-subtle)",
                            borderRadius: 8,
                            fontWeight: 600,
                            fontSize: 14,
                            cursor: token ? "pointer" : "not-allowed",
                            opacity: token ? 1 : 0.6
                        }}
                    >
                        +${formatNumber(parseInt(amount, 10), 0, 0)}
                    </button>
                ))}
            </div>
        </div>
    )
}
