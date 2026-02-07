import React, { useState, useEffect } from "react"
import { Wifi, WifiOff } from "lucide-react"

export default function ConnectionBanner() {
    const [isOffline, setIsOffline] = useState(!navigator.onLine)
    const [justReconnected, setJustReconnected] = useState(false)
    const [isFading, setIsFading] = useState(false)

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

    if (!isOffline && !justReconnected) return null

    // Determine banner styles and content based on state
    const isError = isOffline
    const bgColor = isError ? "#ef4444" : "#16a34a"
    const Icon = isError ? WifiOff : Wifi
    const message = isError ? "No Internet Connection" : "Connection Restored"

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
