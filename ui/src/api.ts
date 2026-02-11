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

export type MarketConfig = {
  invertForApi?: boolean
  displayDecimals?: number
}

type Json = Record<string, unknown>

type ClientState = {
  baseUrl: string
  token: string
  activeAccountId?: string
}

export type TradingAccount = {
  id: string
  user_id: string
  plan_id: string
  plan: {
    id: string
    name: string
    description: string
    spread_multiplier: number
    commission_rate: number
    leverage: number
  }
  leverage: number
  mode: "demo" | "real"
  name: string
  is_active: boolean
  balance: string
  created_at: string
  updated_at: string
}

export type UserProfile = {
  id: string
  email: string
  telegram_id?: number
  display_name?: string
  avatar_url?: string
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

export const createApiClient = (state: ClientState, onUnauthorized?: () => void) => {
  const request = async <T>(path: string, method: string, body?: Json, auth?: boolean): Promise<T> => {
    // Add cache buster to all requests to prevent browser from serving stale data
    const sep = path.includes("?") ? "&" : "?"
    const url = `${state.baseUrl}${path}${sep}_=${Date.now()}`
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (auth && state.token) headers.Authorization = `Bearer ${state.token}`
    if (auth && state.activeAccountId) headers["X-Account-ID"] = state.activeAccountId
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })
    const text = await res.text()
    const data = parseBody(text)
    if (!res.ok) {
      if (res.status === 401 && onUnauthorized) {
        onUnauthorized()
      }
      const msg = data && typeof data === "object" && "error" in data ? String((data as { error: string }).error) : String(res.status)
      throw new Error(msg)
    }
    return data as T
  }
  return {
    register: (email: string, password: string) => request<{ user_id: string; access_token: string }>("/v1/auth/register", "POST", { email, password }),
    login: (email: string, password: string) => request<{ access_token: string }>("/v1/auth/login", "POST", { email, password }),
    telegramAuth: (initData: string) => request<{ access_token: string; user: UserProfile }>("/v1/auth/telegram", "POST", { init_data: initData }),
    me: () => request<UserProfile>("/v1/me", "GET", undefined, true),
    accounts: () => request<TradingAccount[] | null>("/v1/accounts", "GET", undefined, true),
    createAccount: (payload: { plan_id: string; mode: "demo" | "real"; name?: string; is_active?: boolean }) =>
      request<TradingAccount>("/v1/accounts", "POST", payload, true),
    switchAccount: (accountID: string) => request<TradingAccount>("/v1/accounts/switch", "POST", { account_id: accountID }, true),
    updateAccountLeverage: (payload: { account_id: string; leverage: number }) =>
      request<TradingAccount>("/v1/accounts/leverage", "POST", payload, true),
    updateAccountName: (payload: { account_id: string; name: string }) =>
      request<TradingAccount>("/v1/accounts/name", "POST", payload, true),
    balances: async () => {
      const res = await request<Array<{ asset_id: string; symbol: string; kind: string; amount: string }> | null>("/v1/balances", "GET", undefined, true)
      return res || []
    },
    placeOrder: (payload: PlaceOrderPayload) => request<{ order_id: string; status: string }>("/v1/orders", "POST", payload, true),
    faucet: (payload: FaucetPayload) => request<{ status: string }>("/v1/faucet", "POST", payload, true),
    withdraw: (payload: FaucetPayload) => request<{ status: string }>("/v1/withdraw", "POST", payload, true),
    config: () => request<Record<string, MarketConfig>>("/v1/market/config", "GET"),
    candles: (pair: string, timeframe: string, limit = 200, fresh = false, before?: number) => {
      let url = `/v1/market/candles?pair=${encodeURIComponent(pair)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}&fresh=${fresh ? "1" : "0"}`
      if (before) url += `&before=${before}`
      return request<Candle[]>(url, "GET")
    },
    metrics: () => request<{ balance: string; equity: string; margin: string; free_margin: string; margin_level: string; pl: string }>("/v1/metrics", "GET", undefined, true),
    orders: () => request<Array<{
      id: string
      ticket_no?: number
      user_id?: string
      trading_account_id?: string
      pair_id: string
      symbol?: string
      side: string
      type?: string
      price: string
      qty: string
      remaining_qty?: string
      quote_amount?: string
      remaining_quote?: string
      reserved_amount?: string
      spent_amount?: string
      unrealized_pnl?: string
      profit?: string
      commission?: string
      swap?: string
      close_price?: string
      close_time?: string
      comment?: string
      time_in_force?: string
      status: string
      created_at: string
    }> | null>("/v1/orders", "GET", undefined, true),
    orderHistory: (params?: { limit?: number; before?: string }) => {
      let url = "/v1/orders/history"
      const q: string[] = []
      if (params?.limit && params.limit > 0) q.push(`limit=${params.limit}`)
      if (params?.before) q.push(`before=${encodeURIComponent(params.before)}`)
      if (q.length > 0) url += `?${q.join("&")}`
      return request<Array<{
      id: string
      ticket_no?: number
      user_id?: string
      trading_account_id?: string
      pair_id: string
      symbol?: string
      side: string
      type?: string
      price: string
      qty: string
      remaining_qty?: string
      quote_amount?: string
      remaining_quote?: string
      reserved_amount?: string
      spent_amount?: string
      unrealized_pnl?: string
      profit?: string
      commission?: string
      swap?: string
      close_price?: string
      close_time?: string
      comment?: string
      time_in_force?: string
      status: string
      created_at: string
      }> | null>(url, "GET", undefined, true)
    },
    closeOrders: (scope: "all" | "profit" | "loss") =>
      request<{ scope: string; total: number; closed: number; failed: number }>("/v1/orders/close", "POST", { scope }, true),
    cancelOrder: (id: string) => request<{ status: string }>(`/v1/orders/${id}`, "DELETE", undefined, true)
  }
}

export const createWsUrl = (baseUrl: string, token?: string) => {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const base = baseUrl || origin
  if (!base) return ""
  return base.replace(/^http/, "ws") + "/v1/ws" + (token ? `?token=${token}` : "")
}
