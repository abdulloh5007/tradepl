import { useEffect, useMemo, useRef, useState } from "react"
import * as Switch from "@radix-ui/react-switch"
import * as Tooltip from "@radix-ui/react-tooltip"
import { toast, Toaster } from "sonner"
import { Moon, Sun } from "lucide-react"
import { ColorType, CrosshairMode, UTCTimestamp, createChart } from "lightweight-charts"
import { createApiClient, createWsUrl, PlaceOrderPayload } from "./api"
import { languages, Lang, translate } from "./i18n"
import { PanelMotion } from "./types/ui"
import { Balance } from "./types/domain"
import ConnectionPanel from "./components/ConnectionPanel"
import MarketPanel from "./components/MarketPanel"
import AuthPanel from "./components/AuthPanel"
import AccountPanel from "./components/AccountPanel"
import OrderPanel from "./components/OrderPanel"
import RealtimePanel from "./components/RealtimePanel"
import ApiView from "./views/ApiView"
import FaucetView from "./views/FaucetView"

const panelMotion: PanelMotion = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4 } }

const sanitizeBaseUrl = (v: string) => {
  let value = v.trim()
  if (value.endsWith("/")) value = value.slice(0, -1)
  return value
}

const normalizeBaseUrl = (v: string) => {
  const value = sanitizeBaseUrl(v)
  if (!value) return ""
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return ""
    return value
  } catch {
    return ""
  }
}

const getCookie = (name: string) => {
  if (typeof document === "undefined") return ""
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ""
}

const setCookie = (name: string, value: string, days = 365) => {
  if (typeof document === "undefined") return
  const maxAge = days * 24 * 60 * 60
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`
}

const storedLang = () => {
  const value = getCookie("lv_lang")
  if (value === "ru" || value === "uz" || value === "en") return value
  return "en"
}

const storedTheme = () => {
  const value = getCookie("lv_theme")
  if (value === "dark" || value === "light") return value
  return "light"
}

const storedBaseUrl = () => (typeof window !== "undefined" ? localStorage.getItem("lv_base_url") || "" : "")
const storedToken = () => (typeof window !== "undefined" ? sessionStorage.getItem("lv_token") || "" : "")

const marketPairs = ["UZS-USD"]
const marketConfig: Record<string, { displayBase: number; displayDecimals: number; apiDecimals: number; invertForApi: boolean }> = {
  "UZS-USD": { displayBase: 12300, displayDecimals: 2, apiDecimals: 8, invertForApi: true }
}
const timeframes = ["1m", "5m", "10m", "15m", "30m", "1h"]

const resolveView = () => {
  if (typeof window === "undefined") return "console"
  const hash = window.location.hash
  if (hash === "#api") return "api"
  if (hash === "#faucet") return "faucet"
  const path = window.location.pathname
  if (path === "/api") return "api"
  if (path === "/faucet") return "faucet"
  return "console"
}

export default function App() {
  const initialLang = storedLang() as Lang
  const initialTheme = storedTheme() as "light" | "dark"
  const [lang, setLang] = useState<Lang>(initialLang)
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme)
  const [baseUrl, setBaseUrl] = useState(normalizeBaseUrl(storedBaseUrl()))
  const [token, setToken] = useState(storedToken())
  const [profile, setProfile] = useState<string>("")
  const [balancesData, setBalancesData] = useState<Balance[]>([])
  const [orderResult, setOrderResult] = useState<string>("")
  const [faucetAsset, setFaucetAsset] = useState("USD")
  const [faucetAmount, setFaucetAmount] = useState("100")
  const [faucetReference, setFaucetReference] = useState("")
  const [faucetResult, setFaucetResult] = useState<string>("")
  const [faucetBusy, setFaucetBusy] = useState(false)
  const [marketPair, setMarketPair] = useState("UZS-USD")
  const [marketPrice, setMarketPrice] = useState(marketConfig["UZS-USD"].displayBase)
  const [timeframe, setTimeframe] = useState("1m")
  const [quickQty, setQuickQty] = useState("12300")
  const [quote, setQuote] = useState<{ bid: string; ask: string; spread: string; ts: number } | null>(null)
  const candlesCacheRef = useRef<Record<string, { time: UTCTimestamp; open: number; high: number; low: number; close: number }[]>>({})
  const [wsMessages, setWsMessages] = useState<string[]>([])
  const [wsStatus, setWsStatus] = useState("idle")
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [view, setView] = useState<"console" | "api" | "faucet">(resolveView)
  const chartEl = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const seriesRef = useRef<any>(null)
  const dataRef = useRef<{ time: UTCTimestamp; open: number; high: number; low: number; close: number }[]>([])
  const timeRef = useRef<UTCTimestamp>(Math.floor(Date.now() / 1000) as UTCTimestamp)
  const priceRef = useRef<number>(marketConfig["UZS-USD"].displayBase)
  const chartAnimRef = useRef<number | null>(null)
  const spreadRef = useRef<number>(0)

  useEffect(() => {
    document.documentElement.lang = lang
    setCookie("lv_lang", lang)
  }, [lang])

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    setCookie("lv_theme", theme)
  }, [theme])

  useEffect(() => {
    if (quote?.spread) {
      const value = Number(quote.spread)
      spreadRef.current = Number.isFinite(value) ? value : 0
      return
    }
    spreadRef.current = 0
  }, [quote])

  useEffect(() => {
    let active = true
    const tick = (now: number) => {
      if (!active) return
      const series = seriesRef.current
      const data = dataRef.current
      if (series && data.length > 0) {
        const last = data[data.length - 1]
        const cfg = marketConfig[marketPair] || { invertForApi: false }
        const spreadRaw = spreadRef.current
        const basePrice = cfg.invertForApi && last.close > 0 ? 1 / last.close : last.close
        const displaySpread = cfg.invertForApi && basePrice > 0 ? spreadRaw / (basePrice * basePrice) : spreadRaw
        const baseAmp = Number.isFinite(displaySpread) && displaySpread > 0 ? displaySpread * 0.003 : last.close * 0.00001
        const amp = Math.max(0.2, Math.min(1, baseAmp))
        const micro = Math.sin(now / 280) * amp
        const close = Math.max(0, last.close + micro)
        const high = Math.max(last.high, close)
        const low = Math.min(last.low, close)
        series.update({ time: last.time, open: last.open, high, low, close })
      }
      chartAnimRef.current = requestAnimationFrame(tick)
    }
    chartAnimRef.current = requestAnimationFrame(tick)
    return () => {
      active = false
      if (chartAnimRef.current != null) {
        cancelAnimationFrame(chartAnimRef.current)
        chartAnimRef.current = null
      }
    }
  }, [marketPair])

  useEffect(() => {
    const normalized = normalizeBaseUrl(baseUrl)
    if (normalized) {
      localStorage.setItem("lv_base_url", normalized)
    } else {
      localStorage.removeItem("lv_base_url")
    }
  }, [baseUrl])

  useEffect(() => {
    if (token) {
      sessionStorage.setItem("lv_token", token)
    } else {
      sessionStorage.removeItem("lv_token")
    }
  }, [token])

  useEffect(() => {
    if (typeof window === "undefined") return
    const update = () => setView(resolveView())
    window.addEventListener("hashchange", update)
    window.addEventListener("popstate", update)
    return () => {
      window.removeEventListener("hashchange", update)
      window.removeEventListener("popstate", update)
    }
  }, [])

  const t = (key: string) => translate(lang, key)
  const numberFormat = useMemo(() => new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [lang])
  const formatAmount = (value: number) => numberFormat.format(value)
  const formatPrice = (pair: string, value: number) => {
    const cfg = marketConfig[pair] || { displayBase: 1, displayDecimals: 4, apiDecimals: 6, invertForApi: false }
    return value.toFixed(cfg.displayDecimals)
  }
  const apiPriceFromDisplay = (pair: string, value: number) => {
    const cfg = marketConfig[pair] || { displayBase: 1, displayDecimals: 4, apiDecimals: 6, invertForApi: false }
    const raw = cfg.invertForApi && value !== 0 ? 1 / value : value
    return raw.toFixed(cfg.apiDecimals)
  }
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const api = useMemo(() => createApiClient({ baseUrl: normalizedBaseUrl, token }), [normalizedBaseUrl, token])
  const apiBase = normalizedBaseUrl || (typeof window !== "undefined" ? window.location.origin : "")
  const wsBase = apiBase.replace(/^http/, "ws")

  const withBaseUrl = () => true

  useEffect(() => {
    if (!token) return
    let active = true
    api.balances()
      .then(res => {
        if (active) setBalancesData(res)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [api, token])

  useEffect(() => {
    if (!wsBase) return
    const url = `${wsBase}/v1/market/ws?pair=${encodeURIComponent(marketPair)}`
    const socket = new WebSocket(url)
    socket.addEventListener("message", evt => {
      try {
        const data = JSON.parse(String(evt.data))
        if (data && data.type === "quote") {
          setQuote({ bid: String(data.bid), ask: String(data.ask), spread: String(data.spread), ts: Number(data.ts) })
        }
      } catch {
      }
    })
    return () => {
      socket.close()
    }
  }, [wsBase, marketPair])

  const handleBaseUrlBlur = () => {
    const normalized = normalizeBaseUrl(baseUrl)
    if (baseUrl && !normalized) {
      setBaseUrl("")
      toast.message(t("statusBaseUrlInvalid"))
      return
    }
    if (normalized && normalized !== baseUrl) {
      setBaseUrl(normalized)
    }
  }

  const handleRegister = async (form: HTMLFormElement) => {
    const data = new FormData(form)
    const email = String(data.get("email") || "")
    const password = String(data.get("password") || "")
    if (!withBaseUrl()) return
    const res = await api.register(email, password)
    setToken(res.access_token)
    toast.success(t("statusRegistered"))
  }

  const handleLogin = async (form: HTMLFormElement) => {
    const data = new FormData(form)
    const email = String(data.get("email") || "")
    const password = String(data.get("password") || "")
    if (!withBaseUrl()) return
    const res = await api.login(email, password)
    setToken(res.access_token)
    toast.success(t("statusLoggedIn"))
  }

  const handleProfile = async () => {
    if (!withBaseUrl()) return
    const res = await api.me()
    setProfile(JSON.stringify(res, null, 2))
    toast.message(t("statusOk"))
  }

  const handleBalances = async () => {
    if (!withBaseUrl()) return
    const res = await api.balances()
    setBalancesData(res)
    toast.message(t("statusOk"))
  }

  const handleOrder = async (form: HTMLFormElement) => {
    const data = new FormData(form)
    const payload: PlaceOrderPayload = {
      pair: String(data.get("pair") || ""),
      side: String(data.get("side") || ""),
      type: String(data.get("type") || ""),
      time_in_force: String(data.get("time_in_force") || "")
    }
    const price = String(data.get("price") || "")
    const qty = String(data.get("qty") || "")
    const quote = String(data.get("quote_amount") || "")
    const ref = String(data.get("client_ref") || "")
    if (price) {
      const parsed = Number(price)
      if (Number.isFinite(parsed) && parsed > 0) {
        payload.price = apiPriceFromDisplay(payload.pair, parsed)
      } else {
        payload.price = price
      }
    }
    if (qty) payload.qty = qty
    if (quote) payload.quote_amount = quote
    if (ref) payload.client_ref = ref
    if (!withBaseUrl()) return
    const res = await api.placeOrder(payload)
    setOrderResult(JSON.stringify(res, null, 2))
    toast.success(t("statusOrderPlaced"))
  }

  const connectWs = () => {
    if (!withBaseUrl()) return
    if (ws) return
    const url = createWsUrl(normalizedBaseUrl)
    if (!url) return
    const socket = new WebSocket(url)
    setWs(socket)
    setWsStatus("connecting")
    socket.addEventListener("open", () => {
      setWsStatus("connected")
      toast.success(t("statusWsConnected"))
    })
    socket.addEventListener("close", () => {
      setWs(null)
      setWsStatus("closed")
      toast.message(t("statusWsClosed"))
    })
    socket.addEventListener("error", () => {
      setWsStatus("error")
      toast.error(t("statusWsError"))
    })
    socket.addEventListener("message", evt => {
      setWsMessages(prev => [String(evt.data), ...prev].slice(0, 50))
    })
  }

  const disconnectWs = () => {
    ws?.close()
  }

  const toDisplayCandle = (pair: string, c: { time: number; open: string; high: string; low: string; close: string }) => {
    const cfg = marketConfig[pair] || { displayBase: 1, displayDecimals: 4, apiDecimals: 6, invertForApi: false }
    const o = Number(c.open)
    const h = Number(c.high)
    const l = Number(c.low)
    const cl = Number(c.close)
    const round = (v: number) => Number(v.toFixed(cfg.displayDecimals))
    if (!cfg.invertForApi) {
      return { time: c.time as UTCTimestamp, open: round(o), high: round(h), low: round(l), close: round(cl) }
    }
    const open = o > 0 ? 1 / o : 0
    const close = cl > 0 ? 1 / cl : 0
    const high = l > 0 ? 1 / l : 0
    const low = h > 0 ? 1 / h : 0
    return { time: c.time as UTCTimestamp, open: round(open), high: round(high), low: round(low), close: round(close) }
  }

  useEffect(() => {
    const el = chartEl.current
    if (!el) return
    const chart = createChart(el, {
      height: 260,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: theme === "dark" ? "#f5f7fb" : "#10121a" },
      grid: { vertLines: { color: theme === "dark" ? "#1f2a3a" : "#e6e9f0" }, horzLines: { color: theme === "dark" ? "#1f2a3a" : "#e6e9f0" } },
      rightPriceScale: { borderColor: theme === "dark" ? "#1f2a3a" : "#d7dbe3" },
      timeScale: { borderColor: theme === "dark" ? "#1f2a3a" : "#d7dbe3" },
      crosshair: { mode: CrosshairMode.Normal }
    })
    const series = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#ef4444",
      borderUpColor: "#16a34a",
      borderDownColor: "#ef4444",
      wickUpColor: "#16a34a",
      wickDownColor: "#ef4444"
    })
    chartRef.current = chart
    seriesRef.current = series
    if (dataRef.current.length > 0) {
      series.setData(dataRef.current)
    }
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [theme])

  useEffect(() => {
    if (!wsBase) return
    const url = `${wsBase}/v1/market/candles/ws?pair=${encodeURIComponent(marketPair)}&timeframe=${encodeURIComponent(timeframe)}&limit=200&fresh=0`
    const socket = new WebSocket(url)
    const cached = candlesCacheRef.current[timeframe]
    if (cached && cached.length > 0 && seriesRef.current) {
      dataRef.current = cached
      seriesRef.current.setData(cached)
      const last = cached[cached.length - 1]
      priceRef.current = last.close
      timeRef.current = last.time
      setMarketPrice(last.close)
    } else if (seriesRef.current) {
      seriesRef.current.setData([])
      dataRef.current = []
    }
    socket.addEventListener("message", evt => {
      try {
        const data = JSON.parse(String(evt.data))
        if (!data || !data.type) return
        if (data.type === "snapshot" && Array.isArray(data.candles)) {
          const mapped = data.candles.map((c: any) => toDisplayCandle(marketPair, c))
          candlesCacheRef.current[timeframe] = mapped
          dataRef.current = mapped
          if (seriesRef.current) {
            seriesRef.current.setData(mapped)
          }
          const last = mapped[mapped.length - 1]
          if (last) {
            priceRef.current = last.close
            timeRef.current = last.time
            setMarketPrice(last.close)
          }
          return
        }
        if (data.type === "candle" && data.candle) {
          const next = toDisplayCandle(marketPair, data.candle)
          const current = candlesCacheRef.current[timeframe] || dataRef.current
          const last = current[current.length - 1]
          if (!last || next.time > last.time) {
            const merged = current.concat(next).slice(-200)
            candlesCacheRef.current[timeframe] = merged
            dataRef.current = merged
            if (seriesRef.current) {
              seriesRef.current.setData(merged)
            }
          } else if (next.time === last.time) {
            current[current.length - 1] = next
            candlesCacheRef.current[timeframe] = current
            dataRef.current = current
            if (seriesRef.current) {
              seriesRef.current.update(next)
            }
          }
          priceRef.current = next.close
          timeRef.current = next.time
          setMarketPrice(next.close)
        }
      } catch {
      }
    })
    return () => {
      socket.close()
    }
  }, [wsBase, marketPair, timeframe])

  const handleQuickOrder = async (side: "buy" | "sell") => {
    if (!quickQty || Number(quickQty) <= 0) {
      toast.message(t("qty"))
      return
    }
    const payload: PlaceOrderPayload = {
      pair: marketPair,
      side,
      type: "limit",
      price: apiPriceFromDisplay(marketPair, marketPrice),
      qty: quickQty,
      time_in_force: "gtc"
    }
    try {
      const res = await api.placeOrder(payload)
      setOrderResult(JSON.stringify(res, null, 2))
      toast.success(t("statusOrderPlaced"))
    } catch (err: any) {
      const msg = err?.message || "error"
      setOrderResult(JSON.stringify({ error: msg }, null, 2))
      toast.error(msg)
    }
  }

  const handleFaucet = async (form: HTMLFormElement) => {
    const data = new FormData(form)
    const asset = "USD"
    const amount = String(data.get("amount") || "").trim()
    const reference = String(data.get("reference") || "").trim()
    if (!withBaseUrl()) return
    setFaucetBusy(true)
    try {
      const res = await api.faucet({ asset, amount, reference: reference || undefined })
      setFaucetResult(JSON.stringify(res, null, 2))
      try {
        const nextBalances = await api.balances()
        setBalancesData(nextBalances)
      } catch {
        setBalancesData([])
      }
      toast.success(t("statusFaucetOk"))
    } catch (err: any) {
      const msg = err?.message || "error"
      setFaucetResult(JSON.stringify({ error: msg }, null, 2))
      toast.error(msg)
    } finally {
      setFaucetBusy(false)
    }
  }

  const handleFaucetBalances = async () => {
    if (!withBaseUrl()) return
    const res = await api.balances()
    setBalancesData(res)
    toast.message(t("statusOk"))
  }

  const sdkSnippets = {
    curl: `curl -X POST ${apiBase}/v1/orders \\\n  -H \"Authorization: Bearer $TOKEN\" \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"pair\":\"UZS-USD\",\"side\":\"buy\",\"type\":\"limit\",\"price\":\"0.000080\",\"qty\":\"1000\",\"time_in_force\":\"gtc\"}'`,
    js: `const res = await fetch(\"${apiBase}/v1/orders\", {\n  method: \"POST\",\n  headers: {\"Content-Type\": \"application/json\",\"Authorization\": \"Bearer \" + token},\n  body: JSON.stringify({pair: \"UZS-USD\", side: \"buy\", type: \"limit\", price: \"0.000080\", qty: \"1000\", time_in_force: \"gtc\"})\n})\nconst data = await res.json()`,
    go: `payload := []byte(\"{\\\\\"pair\\\\\":\\\\\"UZS-USD\\\\\",\\\\\"side\\\\\":\\\\\"buy\\\\\",\\\\\"type\\\\\":\\\\\"limit\\\\\",\\\\\"price\\\\\":\\\\\"0.000080\\\\\",\\\\\"qty\\\\\":\\\\\"1000\\\\\",\\\\\"time_in_force\\\\\":\\\\\"gtc\\\\\"}\")\nreq, _ := http.NewRequest(\"POST\", \"${apiBase}/v1/orders\", bytes.NewReader(payload))\nreq.Header.Set(\"Content-Type\", \"application/json\")\nreq.Header.Set(\"Authorization\", \"Bearer \"+token)\nres, _ := http.DefaultClient.Do(req)`
  }

  const balanceSummary = useMemo(() => {
    const parseAmount = (value: string) => {
      const n = Number(value)
      return Number.isFinite(n) ? n : 0
    }
    const usdBalances = balancesData.filter(item => item.symbol === "USD")
    const available = usdBalances
      .filter(item => item.kind === "available")
      .reduce((sum, item) => sum + parseAmount(item.amount), 0)
    const reserved = usdBalances
      .filter(item => item.kind === "reserved")
      .reduce((sum, item) => sum + parseAmount(item.amount), 0)
    const balance = available + reserved
    const equity = balance
    const marginUsed = reserved
    const freeMargin = equity - marginUsed
    const marginLevel = marginUsed > 0 ? `${(equity / marginUsed * 100).toFixed(0)}%` : "—"
    return {
      balance: formatAmount(balance),
      equity: formatAmount(equity),
      marginUsed: formatAmount(marginUsed),
      freeMargin: formatAmount(freeMargin),
      marginLevel,
      floatingPnL: formatAmount(0),
      currency: "USD"
    }
  }, [balancesData, formatAmount])

  const onRegister = (form: HTMLFormElement) => handleRegister(form).catch(err => toast.error(err.message))
  const onLogin = (form: HTMLFormElement) => handleLogin(form).catch(err => toast.error(err.message))
  const onProfile = () => handleProfile().catch(err => toast.error(err.message))
  const onBalances = () => handleBalances().catch(err => toast.error(err.message))
  const onOrder = (form: HTMLFormElement) => handleOrder(form).catch(err => toast.error(err.message))
  const onFaucet = (form: HTMLFormElement) => handleFaucet(form).catch(err => toast.error(err.message))
  const onFaucetBalances = () => handleFaucetBalances().catch(err => toast.error(err.message))

  return (
    <div className="app">
      <div className="bg" />
      <div className="surface">
        <header className="top">
          <div className="brand">
            <div className="logo">LV</div>
            <div className="meta">
              <div className="title">{t("title")}</div>
              <div className="subtitle">{t("subtitle")}</div>
            </div>
          </div>
          <div className="controls">
            <div className="segmented" role="group" aria-label="Language">
              {languages.map(code => (
                <button key={code} className={code === lang ? "active" : ""} onClick={() => setLang(code)}>
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="switcher">
              {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
              <span>{t("theme")}</span>
              <Switch.Root className="switch-root" checked={theme === "dark"} onCheckedChange={value => setTheme(value ? "dark" : "light")}>
                <Switch.Thumb className="switch-thumb" />
              </Switch.Root>
            </div>
          </div>
        </header>

        <Tooltip.Provider>
          {view === "console" ? (
            <div className="stack">
              <ConnectionPanel
                t={t}
                panelMotion={panelMotion}
                baseUrl={baseUrl}
                token={token}
                wsStatus={wsStatus}
                onBaseUrlChange={setBaseUrl}
                onTokenChange={setToken}
                onBaseUrlBlur={handleBaseUrlBlur}
                onUseToken={() => toast.message(t("statusTokenSet"))}
              />
              <MarketPanel
                t={t}
                panelMotion={panelMotion}
                marketPair={marketPair}
                marketPairs={marketPairs}
                marketPrice={marketPrice}
                marketPriceLabel={formatPrice(marketPair, marketPrice)}
                timeframe={timeframe}
                timeframes={timeframes}
                onTimeframeChange={setTimeframe}
                bid={quote?.bid}
                ask={quote?.ask}
                spread={quote?.spread}
                quickQty={quickQty}
                onMarketPairChange={setMarketPair}
                onQuickQtyChange={setQuickQty}
                onBuy={() => handleQuickOrder("buy")}
                onSell={() => handleQuickOrder("sell")}
                chartEl={chartEl}
              />
              <AuthPanel t={t} panelMotion={panelMotion} onRegister={onRegister} onLogin={onLogin} />
              <AccountPanel
                t={t}
                panelMotion={panelMotion}
                profile={profile}
                onLoadProfile={onProfile}
                balances={balancesData}
                onLoadBalances={onBalances}
                balanceLabel={balanceSummary.balance}
                equity={balanceSummary.equity}
                marginUsed={balanceSummary.marginUsed}
                freeMargin={balanceSummary.freeMargin}
                marginLevel={balanceSummary.marginLevel}
                floatingPnL={balanceSummary.floatingPnL}
                currency={balanceSummary.currency}
              />
              <OrderPanel t={t} panelMotion={panelMotion} onSubmit={onOrder} result={orderResult} />
              <RealtimePanel
                t={t}
                panelMotion={panelMotion}
                onConnect={connectWs}
                onDisconnect={disconnectWs}
                onClear={() => setWsMessages([])}
                wsMessages={wsMessages}
                wsStatus={wsStatus}
                baseUrl={baseUrl}
              />
            </div>
          ) : view === "api" ? (
            <ApiView t={t} panelMotion={panelMotion} sdkSnippets={sdkSnippets} />
          ) : (
            <FaucetView
              t={t}
              panelMotion={panelMotion}
              apiBase={apiBase}
              balances={balancesData}
              onLoadBalances={onFaucetBalances}
              faucetAsset={faucetAsset}
              faucetAmount={faucetAmount}
              faucetReference={faucetReference}
              onFaucetAssetChange={setFaucetAsset}
              onFaucetAmountChange={setFaucetAmount}
              onFaucetReferenceChange={setFaucetReference}
              onFaucetSubmit={onFaucet}
              faucetBusy={faucetBusy}
              faucetResult={faucetResult}
            />
          )}
        </Tooltip.Provider>
      </div>
      <Toaster richColors theme={theme} />
    </div>
  )
}
