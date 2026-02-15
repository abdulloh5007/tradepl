import type { Lang } from "../../types"
import { t } from "../../utils/i18n"
import "./ApiPage.css"

interface ApiPageProps {
    lang: Lang
}

export default function ApiPage({ lang }: ApiPageProps) {
    return (
        <div style={{ maxWidth: 1000 }}>
            <h2 style={{ marginBottom: 16 }}>{t("api.title", lang)}</h2>
            <div style={{ background: "var(--card-bg)", padding: 24, borderRadius: 12 }}>
                <h3 style={{ marginBottom: 12 }}>{t("api.restEndpoints", lang)}</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-subtle)" }}>
                            <th style={{ padding: 8 }}>{t("api.method", lang)}</th>
                            <th style={{ padding: 8 }}>{t("api.endpoint", lang)}</th>
                            <th style={{ padding: 8 }}>{t("api.description", lang)}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>POST</code></td>
                            <td style={{ padding: 8 }}><code>/v1/auth/register</code></td>
                            <td style={{ padding: 8 }}>{t("api.registerUser", lang)}</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>POST</code></td>
                            <td style={{ padding: 8 }}><code>/v1/auth/login</code></td>
                            <td style={{ padding: 8 }}>{t("api.loginAndGetToken", lang)}</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>GET</code></td>
                            <td style={{ padding: 8 }}><code>/v1/me</code></td>
                            <td style={{ padding: 8 }}>{t("api.getCurrentUser", lang)}</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>GET</code></td>
                            <td style={{ padding: 8 }}><code>/v1/balances</code></td>
                            <td style={{ padding: 8 }}>{t("api.getBalances", lang)}</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>POST</code></td>
                            <td style={{ padding: 8 }}><code>/v1/orders</code></td>
                            <td style={{ padding: 8 }}>{t("api.placeOrder", lang)}</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>GET</code></td>
                            <td style={{ padding: 8 }}><code>/v1/orders</code></td>
                            <td style={{ padding: 8 }}>{t("api.listOpenOrders", lang)}</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>DELETE</code></td>
                            <td style={{ padding: 8 }}><code>/v1/orders/:id</code></td>
                            <td style={{ padding: 8 }}>{t("api.cancelOrder", lang)}</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>GET</code></td>
                            <td style={{ padding: 8 }}><code>/v1/metrics</code></td>
                            <td style={{ padding: 8 }}>{t("api.getMetrics", lang)}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: 8 }}><code>POST</code></td>
                            <td style={{ padding: 8 }}><code>/v1/faucet</code></td>
                            <td style={{ padding: 8 }}>{t("api.getTestFunds", lang)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style={{ background: "var(--card-bg)", padding: 24, borderRadius: 12, marginTop: 16 }}>
                <h3 style={{ marginBottom: 12 }}>{t("api.websocket", lang)}</h3>
                <p style={{ marginBottom: 8 }}>{t("api.connectTo", lang)}: <code>ws://[host]/v1/ws</code></p>
                <p style={{ marginBottom: 8 }}>{t("api.subscribe", lang)}: <code>{`{"type":"subscribe","pairs":["UZS-USD"]}`}</code></p>
                <p>{t("api.receiveRealtime", lang)}</p>
            </div>
        </div>
    )
}
