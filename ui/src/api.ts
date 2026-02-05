export type PlaceOrderPayload = {
  pair: string
  side: string
  type: string
  price?: string
  qty?: string
  quote_amount?: string
  time_in_force: string
  client_ref?: string
}

export type FaucetPayload = {
  asset: string
  amount: string
  reference?: string
}

export type Candle = {
  time: number
  open: string
  high: string
  low: string
  close: string
}

type Json = Record<string, unknown>

type ClientState = {
  baseUrl: string
  token: string
}

const parseBody = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    const firstLine = trimmed.split("\n")[0]
    try {
      return JSON.parse(firstLine)
    } catch {
      return trimmed
    }
  }
}

export const createApiClient = (state: ClientState) => {
  const request = async <T>(path: string, method: string, body?: Json, auth?: boolean): Promise<T> => {
    // Add cache buster to all requests to prevent browser from serving stale data
    const sep = path.includes("?") ? "&" : "?"
    const url = `${state.baseUrl}${path}${sep}_=${Date.now()}`
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (auth && state.token) headers.Authorization = `Bearer ${state.token}`
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })
    const text = await res.text()
    const data = parseBody(text)
    if (!res.ok) {
      const msg = data && typeof data === "object" && "error" in data ? String((data as { error: string }).error) : String(res.status)
      throw new Error(msg)
    }
    return data as T
  }
  return {
    register: (email: string, password: string) => request<{ user_id: string; access_token: string }>("/v1/auth/register", "POST", { email, password }),
    login: (email: string, password: string) => request<{ access_token: string }>("/v1/auth/login", "POST", { email, password }),
    me: () => request<{ id: string; email: string }>("/v1/me", "GET", undefined, true),
    balances: async () => {
      const res = await request<Array<{ asset_id: string; symbol: string; kind: string; amount: string }> | null>("/v1/balances", "GET", undefined, true)
      return res || []
    },
    placeOrder: (payload: PlaceOrderPayload) => request<{ order_id: string; status: string }>("/v1/orders", "POST", payload, true),
    faucet: (payload: FaucetPayload) => request<{ status: string }>("/v1/faucet", "POST", payload, true),
    candles: (pair: string, timeframe: string, limit = 200, fresh = false) => request<Candle[]>(`/v1/market/candles?pair=${encodeURIComponent(pair)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}&fresh=${fresh ? "1" : "0"}`, "GET"),
    metrics: () => request<{ balance: string; equity: string; margin: string; free_margin: string; margin_level: string; pl: string }>("/v1/metrics", "GET", undefined, true),
    orders: () => request<Array<{ id: string; pair_id: string; side: string; price: string; qty: string; status: string; created_at: string }> | null>("/v1/orders", "GET", undefined, true),
    cancelOrder: (id: string) => request<{ status: string }>(`/v1/orders/${id}`, "DELETE", undefined, true)
  }
}

export const createWsUrl = (baseUrl: string) => {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const base = baseUrl || origin
  if (!base) return ""
  return base.replace(/^http/, "ws") + "/v1/ws"
}
