import { toast } from "sonner"
import type { Lang } from "../types"

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

export default function FaucetPage({ api, onMetricsUpdate, token, onLoginRequired }: FaucetPageProps) {
    const handleFaucet = async (amount: string) => {
        // Check if user is logged in
        if (!token) {
            toast.error("Please login first!")
            onLoginRequired()
            return
        }

        try {
            await api.faucet({ asset: "USD", amount, reference: "dev" })
            toast.success(`Received $${amount}!`)
            const m = await api.metrics()
            onMetricsUpdate(m)
        } catch (err: any) {
            toast.error(err?.message || "Error")
        }
    }

    return (
        <div style={{ maxWidth: 600 }}>
            <h2 style={{ marginBottom: 16 }}>Test Faucet</h2>
            <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
                Get test funds to start trading. This is for development only.
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
                    ⚠️ Please login to use the faucet
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
                        +${parseInt(amount).toLocaleString()}
                    </button>
                ))}
            </div>
        </div>
    )
}
