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
