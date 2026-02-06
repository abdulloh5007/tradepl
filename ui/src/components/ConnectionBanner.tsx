import React, { useState, useEffect } from "react"
import { Wifi, WifiOff } from "lucide-react"

export default function ConnectionBanner() {
    const [isOffline, setIsOffline] = useState(!navigator.onLine)
    const [justReconnected, setJustReconnected] = useState(false)

    useEffect(() => {
        const handleOffline = () => {
            setIsOffline(true)
            setJustReconnected(false)
        }

        const handleOnline = () => {
            setIsOffline(false)
            setJustReconnected(true)
            // Hide "Connected" message after 3 seconds
            setTimeout(() => setJustReconnected(false), 3000)
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
            transition: "all 0.3s ease-in-out",
            position: "relative",
            zIndex: 9999, // Ensure it's above everything including header
            width: "100%",
            boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
        }}>
            <Icon size={16} />
            <span>{message}</span>
        </div>
    )
}
