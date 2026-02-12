import type { FormEvent } from "react"
import { Toaster } from "sonner"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

function telegramInitData(): string {
  if (typeof window === "undefined") return ""
  return (window.Telegram?.WebApp?.initData || "").trim()
}

function isTelegramMiniApp(): boolean {
  return telegramInitData().length > 0
}

interface AppAuthGateProps {
  authFlowMode: "development" | "production" | null
  autoAuthChecked: boolean
  authLoading: boolean
  authMode: "login" | "register"
  email: string
  password: string
  lang: Lang
  telegramAuthError: string
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onAuthModeChange: (mode: "login" | "register") => void
  onSubmit: (e: FormEvent) => void
  onRetryTelegram: () => void
}

export default function AppAuthGate({
  authFlowMode,
  autoAuthChecked,
  authLoading,
  authMode,
  email,
  password,
  lang,
  telegramAuthError,
  onEmailChange,
  onPasswordChange,
  onAuthModeChange,
  onSubmit,
  onRetryTelegram,
}: AppAuthGateProps) {
  if (!authFlowMode || !autoAuthChecked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-base)", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <Toaster position="top-right" />
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-base)" }}>
          {authFlowMode === "production" && isTelegramMiniApp() ? "Connecting Telegram..." : "Loading..."}
        </div>
      </div>
    )
  }

  if (authFlowMode === "production") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-base)", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <Toaster position="top-right" />
        <div style={{ background: "var(--card-bg)", padding: 24, borderRadius: 12, width: 360, textAlign: "center" }}>
          <h2 style={{ marginBottom: 12 }}>LV Trade</h2>
          {!isTelegramMiniApp() ? (
            <p style={{ color: "var(--text-muted)", margin: 0 }}>
              Open this app from Telegram Mini App to continue.
            </p>
          ) : (
            <>
              <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
                Telegram authentication failed.
              </p>
              {telegramAuthError && (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  {telegramAuthError}
                </p>
              )}
              <button
                type="button"
                onClick={onRetryTelegram}
                style={{
                  marginTop: 10,
                  width: "100%",
                  padding: "12px 0",
                  background: "linear-gradient(180deg, #16a34a 0%, #15803d 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-base)", alignItems: "center", justifyContent: "center" }}>
      <Toaster position="top-right" />
      <div style={{ background: "var(--card-bg)", padding: 32, borderRadius: 12, width: 360 }}>
        <h2 style={{ marginBottom: 24, textAlign: "center" }}>LV Trade</h2>

        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => onEmailChange(e.target.value)}
              placeholder="user@example.com"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                background: "var(--input-bg)",
                color: "var(--text-base)",
                fontSize: 14,
              }}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => onPasswordChange(e.target.value)}
              placeholder="••••••••"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                background: "var(--input-bg)",
                color: "var(--text-base)",
                fontSize: 14,
              }}
            />
          </div>
          <button
            type="submit"
            disabled={authLoading}
            style={{
              width: "100%",
              padding: "12px 0",
              background: "linear-gradient(180deg, #16a34a 0%, #15803d 100%)",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 15,
              cursor: authLoading ? "wait" : "pointer",
              marginBottom: 12,
            }}
          >
            {authLoading ? "..." : authMode === "login" ? t("login", lang) : t("register", lang)}
          </button>
        </form>

        <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
          {authMode === "login" ? (
            <>No account? <button onClick={() => onAuthModeChange("register")} style={{ background: "none", border: "none", color: "var(--accent-text)", cursor: "pointer" }}>{t("register", lang)}</button></>
          ) : (
            <>Have account? <button onClick={() => onAuthModeChange("login")} style={{ background: "none", border: "none", color: "var(--accent-text)", cursor: "pointer" }}>{t("login", lang)}</button></>
          )}
        </div>
      </div>
    </div>
  )
}

