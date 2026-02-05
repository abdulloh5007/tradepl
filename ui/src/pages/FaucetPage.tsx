import { toast } from "sonner"
import type { Lang } from "../types"

interface FaucetPageProps {
    api: {
        faucet: (payload: { asset: string; amount: string; reference?: string }) => Promise<{ status: string }>
        metrics: () => Promise<{ balance: string; equity: string; margin: string; free_margin: string; margin_level: string; pl: string }>
    }
    onMetricsUpdate: (m: { balance: string; equity: string; margin: string; free_margin: string; margin_level: string; pl: string }) => void
    lang: Lang
}

export default function FaucetPage({ api, onMetricsUpdate }: FaucetPageProps) {
    const handleFaucet = async (amount: string) => {
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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                {["1000", "10000", "100000"].map(amount => (
                    <button
                        key={amount}
                        onClick={() => handleFaucet(amount)}
                        style={{
                            padding: "16px 0",
                            background: "linear-gradient(180deg, #16a34a 0%, #15803d 100%)",
                            color: "white",
                            border: "none",
                            borderRadius: 8,
                            fontWeight: 600,
                            fontSize: 14,
                            cursor: "pointer"
                        }}
                    >
                        +${parseInt(amount).toLocaleString()}
                    </button>
                ))}
            </div>
        </div>
    )
}
