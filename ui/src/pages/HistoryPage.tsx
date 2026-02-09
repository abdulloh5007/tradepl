import OrderHistoryTable from "../components/OrderHistoryTable"
import type { Lang, Order } from "../types"

interface HistoryPageProps {
    orders: Order[]
    lang: Lang
    loading: boolean
    hasMore: boolean
    onRefresh: () => Promise<void> | void
    onLoadMore: () => Promise<void> | void
}

export default function HistoryPage({ orders, lang, loading, hasMore, onRefresh, onLoadMore }: HistoryPageProps) {
    return (
        <div style={{ maxWidth: 1200 }}>
            <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <h2 style={{ margin: 0 }}>Order History</h2>
                <button
                    onClick={() => onRefresh()}
                    disabled={loading}
                    style={{
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 10,
                        padding: "8px 12px",
                        background: "var(--card-bg)",
                        color: "var(--text-base)",
                        cursor: loading ? "wait" : "pointer",
                        fontWeight: 700
                    }}
                >
                    {loading ? "Refreshing..." : "Refresh"}
                </button>
            </div>
            <OrderHistoryTable orders={orders} lang={lang} />
            <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                <button
                    onClick={() => onLoadMore()}
                    disabled={loading || !hasMore}
                    style={{
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 10,
                        padding: "8px 12px",
                        background: "var(--card-bg)",
                        color: "var(--text-base)",
                        cursor: loading || !hasMore ? "not-allowed" : "pointer",
                        fontWeight: 700
                    }}
                >
                    {!hasMore ? "No More History" : (loading ? "Loading..." : "Load More")}
                </button>
            </div>
        </div>
    )
}
