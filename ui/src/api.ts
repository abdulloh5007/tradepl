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
    commission_per_lot: number
    swap_long_per_lot: number
    swap_short_per_lot: number
    is_swap_free: boolean
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
  telegram_write_access?: boolean
  telegram_notifications_enabled?: boolean
  display_name?: string
  avatar_url?: string
}

export type SignupBonusStatus = {
  amount: string
  currency: string
  claimed: boolean
  can_claim: boolean
  total_limit?: number
  claimed_total?: number
  remaining?: number
  standard_only?: boolean
  claimed_at?: string
  trading_account_id?: string
  trading_account_name?: string
  trading_account_mode?: "demo" | "real" | string
}

export type DepositVoucherStatus = {
  id: "gold" | "diamond" | string
  title: string
  percent: string
  available: boolean
  used: boolean
}

export type DepositPaymentMethod = {
  id: string
  title: string
  details: string
  enabled: boolean
}

export type DepositBonusStatus = {
  min_amount_usd: string
  max_amount_usd: string
  usd_to_uzs_rate: string
  review_minutes: number
  one_time_used: boolean
  pending_count: number
  next_review_due_at?: string
  eligible_account_id?: string
  vouchers: DepositVoucherStatus[]
  payment_methods: DepositPaymentMethod[]
}

export type RealDepositRequestPayload = {
  amount_usd: string
  voucher_kind?: "none" | "gold" | "diamond"
  method_id: string
  proof_file_name: string
  proof_mime_type: string
  proof_base64: string
}

export type RealDepositRequestResponse = {
  request_id: string
  ticket: string
  status: string
  review_due_at: string
  amount_usd: string
  bonus_amount_usd: string
  total_credit_usd: string
  voucher_kind: "none" | "gold" | "diamond" | string
  method_id: string
}

export type RealWithdrawRequestPayload = {
  amount_usd: string
  method_id: string
  payout_details: string
}

export type RealWithdrawRequestResponse = {
  status: string
  amount_usd: string
  method_id: string
  payout_details_masked: string
}

export type KYCStatus = {
  state: "available" | "pending" | "approved" | "blocked_temp" | "blocked_permanent" | "unavailable" | string
  can_submit: boolean
  message: string
  eligible_account_id?: string
  bonus_amount_usd: string
  review_eta_hours: number
  is_review_configured: boolean
  claimed: boolean
  failed_attempts: number
  pending_ticket?: string
  pending_since?: string
  pending_review_due_at?: string
  blocked_until?: string
  blocked_seconds?: number
  permanent_blocked?: boolean
  last_rejected_at?: string
}

export type KYCRequestPayload = {
  document_type: "passport" | "id_card" | "driver_license" | "other"
  full_name: string
  document_number: string
  residence_address: string
  notes?: string
  proof_file_name: string
  proof_mime_type: string
  proof_base64: string
}

export type KYCRequestResponse = {
  request_id: string
  ticket: string
  status: string
  review_due_at: string
  bonus_amount_usd: string
}

export type ReferralStatus = {
  referral_code: string
  share_url: string
  balance: string
  total_earned: string
  total_withdrawn: string
  referrals_total: number
  signup_reward_usd: string
  deposit_commission_percent: string
  min_withdraw_usd: string
  can_withdraw: boolean
  real_account_required: boolean
}

export type ReferralEvent = {
  id: string
  kind: "signup" | "deposit_commission" | "withdrawal" | string
  amount: string
  commission_percent: string
  related_user_id?: string
  trading_account_id?: string
  created_at: string
}

export type ProfitRewardStageStatus = {
  stage_no: number
  target_profit_usd: string
  reward_usd: string
  achieved: boolean
  claimed: boolean
  can_claim: boolean
  claimed_at?: string
  claimed_account_id?: string
}

export type ProfitRewardStatus = {
  track: string
  currency: string
  progress_usd: string
  total_stages: number
  claimed_stages: number
  available_claims: number
  stages: ProfitRewardStageStatus[]
}

export type ProfitRewardClaimPayload = {
  stage_no: number
  trading_account_id: string
}

export type MarketNewsEvent = {
  id: number
  pair: string
  title: string
  impact: "low" | "medium" | "high" | string
  rule_key: string
  source: "manual" | "auto" | string
  forecast_value: number
  actual_value?: number | null
  actual_auto: boolean
  pre_seconds: number
  event_seconds: number
  post_seconds: number
  scheduled_at: string
  live_started_at?: string
  post_started_at?: string
  completed_at?: string
  status: "pending" | "pre" | "live" | "post" | "completed" | "cancelled" | string
  created_by: string
  created_at: string
  updated_at: string
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
    authMode: () => request<{ mode: "development" | "production" }>("/v1/auth/mode", "GET"),
    register: (email: string, password: string) => request<{ user_id: string; access_token: string }>("/v1/auth/register", "POST", { email, password }),
    login: (email: string, password: string) => request<{ access_token: string }>("/v1/auth/login", "POST", { email, password }),
    telegramAuth: (initData: string) => request<{ access_token: string; user: UserProfile }>("/v1/auth/telegram", "POST", { init_data: initData }),
    setTelegramWriteAccess: (allowed: boolean) =>
      request<{ status: string; allowed: boolean }>("/v1/auth/telegram/write-access", "POST", { allowed }, true),
    setTelegramNotificationsEnabled: (enabled: boolean) =>
      request<{ status: string; enabled: boolean }>("/v1/auth/telegram/notifications", "POST", { enabled }, true),
    me: () => request<UserProfile>("/v1/me", "GET", undefined, true),
    accounts: () => request<TradingAccount[] | null>("/v1/accounts", "GET", undefined, true),
    createAccount: (payload: { plan_id: string; mode: "demo" | "real"; name?: string; is_active?: boolean }) =>
      request<TradingAccount>("/v1/accounts", "POST", payload, true),
    switchAccount: (accountID: string) => request<TradingAccount>("/v1/accounts/switch", "POST", { account_id: accountID }, true),
    updateAccountLeverage: (payload: { account_id: string; leverage: number }) =>
      request<TradingAccount>("/v1/accounts/leverage", "POST", payload, true),
    updateAccountName: (payload: { account_id: string; name: string }) =>
      request<TradingAccount>("/v1/accounts/name", "POST", payload, true),
    signupBonusStatus: () => request<SignupBonusStatus>("/v1/rewards/signup", "GET", undefined, true),
    claimSignupBonus: (payload: { accept_terms: boolean }) =>
      request<SignupBonusStatus>("/v1/rewards/signup/claim", "POST", payload, true),
    depositBonusStatus: () => request<DepositBonusStatus>("/v1/rewards/deposit", "GET", undefined, true),
    profitRewardStatus: () => request<ProfitRewardStatus>("/v1/rewards/profit", "GET", undefined, true),
    claimProfitReward: (payload: ProfitRewardClaimPayload) =>
      request<{ status: string; stage_no: number; reward_usd: string; trading_account_id: string; claimed_at: string; progress_usd: string }>(
        "/v1/rewards/profit/claim",
        "POST",
        payload,
        true
      ),
    requestRealDeposit: (payload: RealDepositRequestPayload) =>
      request<RealDepositRequestResponse>("/v1/deposits/real/request", "POST", payload, true),
    requestRealWithdraw: (payload: RealWithdrawRequestPayload) =>
      request<RealWithdrawRequestResponse>("/v1/withdraw/real/request", "POST", payload, true),
    kycStatus: () => request<KYCStatus>("/v1/kyc/status", "GET", undefined, true),
    requestKYC: (payload: KYCRequestPayload) =>
      request<KYCRequestResponse>("/v1/kyc/request", "POST", payload, true),
    referralStatus: () => request<ReferralStatus>("/v1/referrals/status", "GET", undefined, true),
    referralEvents: (params?: { limit?: number; before?: string }) => {
      let url = "/v1/referrals/events"
      const q: string[] = []
      if (params?.limit && params.limit > 0) q.push(`limit=${params.limit}`)
      if (params?.before) q.push(`before=${encodeURIComponent(params.before)}`)
      if (q.length > 0) url += `?${q.join("&")}`
      return request<{ items: ReferralEvent[] }>(url, "GET", undefined, true)
    },
    referralWithdraw: (payload?: { amount_usd?: string }) =>
      request<{ status: string; amount_usd: string; balance: string }>("/v1/referrals/withdraw", "POST", payload || {}, true),
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
    metrics: () => request<{
        balance: string
        equity: string
        margin: string
        free_margin: string
        margin_level: string
        pl: string
        system_notice?: string
        system_notice_details?: {
            kind?: string
            reason?: string
            triggered_at?: string
            threshold_percent?: string
            balance_before?: string
            balance_after?: string
            equity_before?: string
            equity_after?: string
            margin_before?: string
            margin_after?: string
            margin_level_before?: string
            margin_level_after?: string
            closed_orders?: number
            total_loss?: string
            total_loss_estimated?: boolean
        }
    }>("/v1/metrics", "GET", undefined, true),
    orders: () => request<Array<{
      id: string
      ticket?: string
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
      ticket?: string
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
    newsUpcoming: (params?: { pair?: string; limit?: number }) => {
      const pair = params?.pair ? String(params.pair) : "UZS-USD"
      const limit = params?.limit && params.limit > 0 ? params.limit : 3
      return request<MarketNewsEvent[] | null>(
        `/v1/news/upcoming?pair=${encodeURIComponent(pair)}&limit=${limit}`,
        "GET",
        undefined,
        true
      )
    },
    newsRecent: (params?: { pair?: string; limit?: number }) => {
      const pair = params?.pair ? String(params.pair) : "UZS-USD"
      const limit = params?.limit && params.limit > 0 ? params.limit : 20
      return request<MarketNewsEvent[] | null>(
        `/v1/news/recent?pair=${encodeURIComponent(pair)}&limit=${limit}`,
        "GET",
        undefined,
        true
      )
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
