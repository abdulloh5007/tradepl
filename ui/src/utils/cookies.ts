export function getCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"))
    return match ? decodeURIComponent(match[2]) : null
}

export function setCookie(name: string, value: string, days = 365): void {
    const d = new Date()
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000)
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`
}

export function storedLang(): "en" | "uz" | "ru" {
    const v = getCookie("lv_lang")
    if (v === "en" || v === "uz" || v === "ru") return v
    return "en"
}

export function storedTheme(): "dark" | "light" {
    const v = getCookie("lv_theme")
    if (v === "dark" || v === "light") return v
    return "dark"
}

export function storedBaseUrl(): string {
    return getCookie("lv_baseurl") || "http://localhost:8080"
}

export function storedToken(): string {
    return getCookie("lv_token") || ""
}

export function storedAccountId(): string {
    return getCookie("lv_account_id") || ""
}

export function storedTimeframe(): string {
    const v = getCookie("lv_timeframe")
    const allowed = new Set(["1m", "5m", "10m", "15m", "30m", "1h"])
    if (v && allowed.has(v)) return v
    return "1m"
}

export function storedTradePanelOpen(): boolean {
    return getCookie("lv_trade_panel") === "1"
}
