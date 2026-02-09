import { useMemo, useState } from "react"
import type { TradingAccount } from "../types"

interface AccountsPageProps {
    accounts: TradingAccount[]
    activeAccountId: string
    onSwitch: (accountId: string) => Promise<void>
    onCreate: (payload: { plan_id: string; mode: "demo" | "real"; name?: string; is_active?: boolean }) => Promise<void>
    onTopUpDemo: (amount: string) => Promise<void>
}

const planOptions = [
    { id: "standard", label: "Standard" },
    { id: "pro", label: "Pro" },
    { id: "raw", label: "Raw Spread" },
    { id: "swapfree", label: "Swap Free" }
]

const modePillStyle = (mode: string) => ({
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.4,
    border: "1px solid var(--border-subtle)",
    color: mode === "demo" ? "#16a34a" : "#f59e0b",
    background: mode === "demo" ? "rgba(22, 163, 74, 0.12)" : "rgba(245, 158, 11, 0.12)"
})

export default function AccountsPage({ accounts, activeAccountId, onSwitch, onCreate, onTopUpDemo }: AccountsPageProps) {
    const [creating, setCreating] = useState(false)
    const [switchingId, setSwitchingId] = useState<string | null>(null)
    const [funding, setFunding] = useState(false)

    const [mode, setMode] = useState<"demo" | "real">("demo")
    const [planID, setPlanID] = useState("standard")
    const [name, setName] = useState("")
    const [topUpAmount, setTopUpAmount] = useState("10000")

    const activeAccount = useMemo(() => {
        return accounts.find(a => a.id === activeAccountId) || accounts.find(a => a.is_active) || null
    }, [accounts, activeAccountId])

    const formatUsd = (value: string) => {
        const num = Number(value || 0)
        if (Number.isNaN(num)) return "0.00"
        return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    return (
        <div style={{ maxWidth: 1200 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
                <div>
                    <h2 style={{ margin: 0 }}>Trading Accounts</h2>
                    <p style={{ margin: "6px 0 0 0", color: "var(--text-muted)", fontSize: 13 }}>
                        Create multiple demo/real accounts and switch instantly.
                    </p>
                </div>
                {activeAccount && (
                    <div style={{
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: "1px solid var(--border-subtle)",
                        background: "linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(59, 130, 246, 0.12))",
                        minWidth: 260
                    }}>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Active Account</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                            <div>
                                <div style={{ fontWeight: 700 }}>{activeAccount.name}</div>
                                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{activeAccount.plan?.name || activeAccount.plan_id}</div>
                            </div>
                            <div style={modePillStyle(activeAccount.mode)}>{activeAccount.mode.toUpperCase()}</div>
                        </div>
                    </div>
                )}
            </div>

            <div style={{
                display: "grid",
                gridTemplateColumns: "minmax(320px, 1fr) 2fr",
                gap: 16
            }}>
                <div style={{ background: "var(--card-bg)", borderRadius: 12, border: "1px solid var(--border-subtle)", padding: 16 }}>
                    <h3 style={{ marginTop: 0, marginBottom: 14 }}>Open New Account</h3>

                    <div style={{ display: "grid", gap: 10 }}>
                        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            Mode
                            <select value={mode} onChange={e => setMode(e.target.value as "demo" | "real")} style={{ width: "100%", marginTop: 6 }}>
                                <option value="demo">Demo</option>
                                <option value="real">Real</option>
                            </select>
                        </label>

                        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            Plan
                            <select value={planID} onChange={e => setPlanID(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
                                {planOptions.map(p => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                            </select>
                        </label>

                        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            Account Name (optional)
                            <input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="My Pro Demo"
                                style={{ width: "100%", marginTop: 6 }}
                            />
                        </label>

                        <button
                            onClick={async () => {
                                setCreating(true)
                                try {
                                    await onCreate({ plan_id: planID, mode, name: name.trim() || undefined, is_active: true })
                                    setName("")
                                } finally {
                                    setCreating(false)
                                }
                            }}
                            disabled={creating}
                            style={{
                                marginTop: 4,
                                border: "none",
                                borderRadius: 10,
                                padding: "10px 12px",
                                fontWeight: 700,
                                color: "#fff",
                                background: "linear-gradient(180deg, #1d4ed8 0%, #1e40af 100%)",
                                cursor: creating ? "wait" : "pointer"
                            }}
                        >
                            {creating ? "Creating..." : "Create & Activate"}
                        </button>
                    </div>

                    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
                        <h4 style={{ marginTop: 0, marginBottom: 10 }}>Quick Demo Top-Up</h4>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                            <input
                                type="number"
                                min="1"
                                value={topUpAmount}
                                onChange={e => setTopUpAmount(e.target.value)}
                                placeholder="10000"
                            />
                            <button
                                onClick={async () => {
                                    setFunding(true)
                                    try {
                                        await onTopUpDemo(topUpAmount)
                                    } finally {
                                        setFunding(false)
                                    }
                                }}
                                disabled={funding}
                                style={{
                                    border: "none",
                                    borderRadius: 10,
                                    padding: "0 14px",
                                    fontWeight: 700,
                                    color: "#fff",
                                    background: "linear-gradient(180deg, #16a34a 0%, #15803d 100%)",
                                    cursor: funding ? "wait" : "pointer"
                                }}
                            >
                                {funding ? "..." : "Top Up"}
                            </button>
                        </div>
                    </div>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                    {accounts.length === 0 ? (
                        <div style={{ background: "var(--card-bg)", borderRadius: 12, border: "1px solid var(--border-subtle)", padding: 20, color: "var(--text-muted)" }}>
                            No accounts yet
                        </div>
                    ) : accounts.map(account => (
                        <div
                            key={account.id}
                            style={{
                                background: "var(--card-bg)",
                                borderRadius: 12,
                                border: account.id === activeAccountId
                                    ? "1px solid rgba(59, 130, 246, 0.6)"
                                    : "1px solid var(--border-subtle)",
                                padding: 16
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                                <div>
                                    <div style={{ fontSize: 17, fontWeight: 700 }}>{account.name}</div>
                                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                                        {account.plan?.name || account.plan_id} • Leverage 1:{account.plan?.leverage || 100}
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <div style={modePillStyle(account.mode)}>{account.mode.toUpperCase()}</div>
                                    {account.id === activeAccountId && (
                                        <div style={{ ...modePillStyle("demo"), color: "#3b82f6", background: "rgba(59,130,246,0.12)" }}>ACTIVE</div>
                                    )}
                                </div>
                            </div>

                            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                                <div style={{ background: "var(--bg-subtle)", borderRadius: 10, padding: 10 }}>
                                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Balance</div>
                                    <div style={{ fontWeight: 700 }}>${formatUsd(account.balance)}</div>
                                </div>
                                <div style={{ background: "var(--bg-subtle)", borderRadius: 10, padding: 10 }}>
                                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Spread x</div>
                                    <div style={{ fontWeight: 700 }}>{account.plan?.spread_multiplier ?? "1.00"}</div>
                                </div>
                                <div style={{ background: "var(--bg-subtle)", borderRadius: 10, padding: 10 }}>
                                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Commission</div>
                                    <div style={{ fontWeight: 700 }}>{((account.plan?.commission_rate || 0) * 100).toFixed(2)}%</div>
                                </div>
                            </div>

                            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
                                <button
                                    disabled={account.id === activeAccountId || switchingId === account.id}
                                    onClick={async () => {
                                        setSwitchingId(account.id)
                                        try {
                                            await onSwitch(account.id)
                                        } finally {
                                            setSwitchingId(null)
                                        }
                                    }}
                                    style={{
                                        border: "1px solid var(--border-subtle)",
                                        borderRadius: 10,
                                        padding: "8px 12px",
                                        fontWeight: 700,
                                        background: account.id === activeAccountId ? "var(--bg-subtle)" : "var(--card-bg)",
                                        color: account.id === activeAccountId ? "var(--text-muted)" : "var(--text-base)",
                                        cursor: account.id === activeAccountId ? "default" : "pointer"
                                    }}
                                >
                                    {account.id === activeAccountId ? "Current" : (switchingId === account.id ? "Switching..." : "Switch To This")}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

