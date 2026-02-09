import React, { useState, useEffect } from "react"
import { AlertTriangle, Wifi, WifiOff } from "lucide-react"

interface ApiBackoffInfo {
    source: "metrics" | "orders"
    failures: number
    retryAt: number
}

interface ConnectionBannerProps {
    apiBackoff?: ApiBackoffInfo | null
}

export default function ConnectionBanner({ apiBackoff }: ConnectionBannerProps) {
    const [isOffline, setIsOffline] = useState(!navigator.onLine)
    const [justReconnected, setJustReconnected] = useState(false)
    const [isFading, setIsFading] = useState(false)
    const [nowTs, setNowTs] = useState(Date.now())

    useEffect(() => {
        const handleOffline = () => {
            setIsOffline(true)
            setJustReconnected(false)
            setIsFading(false)
        }

        const handleOnline = () => {
            setIsOffline(false)
            setJustReconnected(true)
            setIsFading(false)

            // Start fading out after 2.5s
            setTimeout(() => setIsFading(true), 2500)

            // Hide completely after 3s
            setTimeout(() => {
                setJustReconnected(false)
                setIsFading(false)
            }, 3000)
        }

        window.addEventListener("offline", handleOffline)
        window.addEventListener("online", handleOnline)

        return () => {
            window.removeEventListener("offline", handleOffline)
            window.removeEventListener("online", handleOnline)
        }
    }, [])

    useEffect(() => {
        const timer = setInterval(() => setNowTs(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [])

    const apiBackoffActive = !!apiBackoff && apiBackoff.retryAt > nowTs
    const retrySeconds = apiBackoffActive && apiBackoff
        ? Math.max(1, Math.ceil((apiBackoff.retryAt - nowTs) / 1000))
        : 0

    if (!isOffline && !justReconnected && !apiBackoffActive) return null

    // Determine banner styles and content based on state
    let bgColor = "#16a34a"
    let Icon: typeof Wifi | typeof WifiOff | typeof AlertTriangle = Wifi
    let message = "Connection Restored"

    if (isOffline) {
        bgColor = "#ef4444"
        Icon = WifiOff
        message = "No Internet Connection"
    } else if (apiBackoffActive && apiBackoff) {
        bgColor = apiBackoff.failures >= 2 ? "#b45309" : "#d97706"
        Icon = AlertTriangle
        message = `Server unstable. Retrying ${apiBackoff.source} in ${retrySeconds}s (${apiBackoff.failures} error${apiBackoff.failures > 1 ? "s" : ""})`
    }

    return (
        <div style={{
            background: bgColor,
            color: "white",
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontWeight: 500,
            fontSize: "14px",
            transition: "all 0.5s ease-in-out",
            opacity: isFading ? 0 : 1,
            height: isFading ? 0 : "auto", // Optional: also animate height to avoid jump
            overflow: "hidden",
            position: "relative",
            zIndex: 9999,
            width: "100%",
            boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
        }}>
            <Icon size={16} />
            <span>{message}</span>
        </div>
    )
}
