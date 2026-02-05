export default function ApiPage() {
    return (
        <div style={{ maxWidth: 1000 }}>
            <h2 style={{ marginBottom: 16 }}>API Documentation</h2>
            <div style={{ background: "var(--card-bg)", padding: 24, borderRadius: 12 }}>
                <h3 style={{ marginBottom: 12 }}>REST API Endpoints</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-subtle)" }}>
                            <th style={{ padding: 8 }}>Method</th>
                            <th style={{ padding: 8 }}>Endpoint</th>
                            <th style={{ padding: 8 }}>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>POST</code></td>
                            <td style={{ padding: 8 }}><code>/v1/auth/register</code></td>
                            <td style={{ padding: 8 }}>Register new user</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>POST</code></td>
                            <td style={{ padding: 8 }}><code>/v1/auth/login</code></td>
                            <td style={{ padding: 8 }}>Login and get token</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>GET</code></td>
                            <td style={{ padding: 8 }}><code>/v1/me</code></td>
                            <td style={{ padding: 8 }}>Get current user profile</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>GET</code></td>
                            <td style={{ padding: 8 }}><code>/v1/balances</code></td>
                            <td style={{ padding: 8 }}>Get account balances</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>POST</code></td>
                            <td style={{ padding: 8 }}><code>/v1/orders</code></td>
                            <td style={{ padding: 8 }}>Place new order</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>GET</code></td>
                            <td style={{ padding: 8 }}><code>/v1/orders</code></td>
                            <td style={{ padding: 8 }}>List open orders</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>DELETE</code></td>
                            <td style={{ padding: 8 }}><code>/v1/orders/:id</code></td>
                            <td style={{ padding: 8 }}>Cancel order</td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: 8 }}><code>GET</code></td>
                            <td style={{ padding: 8 }}><code>/v1/metrics</code></td>
                            <td style={{ padding: 8 }}>Get account metrics</td>
                        </tr>
                        <tr>
                            <td style={{ padding: 8 }}><code>POST</code></td>
                            <td style={{ padding: 8 }}><code>/v1/faucet</code></td>
                            <td style={{ padding: 8 }}>Get test funds</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style={{ background: "var(--card-bg)", padding: 24, borderRadius: 12, marginTop: 16 }}>
                <h3 style={{ marginBottom: 12 }}>WebSocket</h3>
                <p style={{ marginBottom: 8 }}>Connect to: <code>ws://[host]/v1/ws</code></p>
                <p style={{ marginBottom: 8 }}>Subscribe: <code>{`{"type":"subscribe","pairs":["UZS-USD"]}`}</code></p>
                <p>Receive real-time quotes and candles.</p>
            </div>
        </div>
    )
}
