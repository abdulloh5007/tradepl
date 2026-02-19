import { useCallback, useEffect, useState } from "react"
import { RadioTower } from "lucide-react"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

type SignalChannelCardProps = {
  lang: Lang
  baseUrl: string
  headers: Record<string, string>
  canAccess: boolean
}

type SignalConfig = {
  enabled: boolean
  chat_id: string
  daily_digest_time: string
  pre_alert_minutes: number
  timezone: string
  pair: string
}

const DEFAULT_CONFIG: SignalConfig = {
  enabled: false,
  chat_id: "",
  daily_digest_time: "08:00",
  pre_alert_minutes: 2,
  timezone: "Asia/Tashkent",
  pair: "UZS-USD",
}

const normalize = (raw: any): SignalConfig => {
  const time = String(raw?.daily_digest_time || DEFAULT_CONFIG.daily_digest_time).trim()
  return {
    enabled: Boolean(raw?.enabled),
    chat_id: String(raw?.chat_id || "").trim(),
    daily_digest_time: /^\d{2}:\d{2}$/.test(time) ? time : DEFAULT_CONFIG.daily_digest_time,
    pre_alert_minutes: Number(raw?.pre_alert_minutes) > 0 ? Number(raw?.pre_alert_minutes) : DEFAULT_CONFIG.pre_alert_minutes,
    timezone: String(raw?.timezone || DEFAULT_CONFIG.timezone).trim() || DEFAULT_CONFIG.timezone,
    pair: String(raw?.pair || DEFAULT_CONFIG.pair).trim().toUpperCase() || DEFAULT_CONFIG.pair,
  }
}

export default function SignalChannelCard({ lang, baseUrl, headers, canAccess }: SignalChannelCardProps) {
  const [config, setConfig] = useState<SignalConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!canAccess) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${baseUrl}/v1/admin/news/signal-config`, { headers })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || t("manage.signal.errorLoad", lang))
      setConfig(normalize(body))
    } catch (e: any) {
      setError(e?.message || t("manage.signal.errorLoad", lang))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, headers, canAccess, lang])

  useEffect(() => {
    if (!canAccess) return
    load()
  }, [canAccess, load])

  if (!canAccess) return null

  return (
    <div className="admin-card full-width">
      <div className="admin-card-header">
        <RadioTower size={18} />
        <h2>{t("manage.signal.title", lang)}</h2>
      </div>

      {error ? <div className="system-health-error">{error}</div> : null}

      {loading ? (
        <div className="no-events">{t("common.loading", lang)}</div>
      ) : (
        <>
          <p className="deposit-methods-desc">{t("manage.signal.desc", lang)}</p>
          <div className="risk-grid">
            <label className="risk-field">
              <span>{t("manage.signal.chatId", lang)}</span>
              <input
                type="text"
                value={config.chat_id}
                onChange={(e) => setConfig((prev) => ({ ...prev, chat_id: e.target.value }))}
                placeholder="-1001234567890"
              />
            </label>
            <label className="risk-field">
              <span>{t("manage.signal.digestTime", lang)}</span>
              <input
                type="time"
                value={config.daily_digest_time}
                onChange={(e) => setConfig((prev) => ({ ...prev, daily_digest_time: e.target.value }))}
              />
            </label>
            <label className="risk-field">
              <span>{t("manage.signal.preAlertMinutes", lang)}</span>
              <input
                type="number"
                min={1}
                max={60}
                value={String(config.pre_alert_minutes)}
                onChange={(e) => setConfig((prev) => ({ ...prev, pre_alert_minutes: Number(e.target.value || 0) }))}
              />
            </label>
            <label className="risk-field">
              <span>{t("manage.signal.scope", lang)}</span>
              <div className="no-events signal-channel-meta">
                {config.pair} / {config.timezone}
              </div>
            </label>
          </div>
          <div className="signal-channel-enable-row">
            <div className="signal-channel-enable-text">
              <strong>{t("manage.signal.enabled", lang)}</strong>
              <small>{t("manage.signal.enabledHint", lang)}</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.enabled}
              className={`deposit-method-toggle ${config.enabled ? "enabled" : ""}`}
              onClick={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
            >
              <span className="deposit-method-toggle-thumb" />
            </button>
          </div>

          <div className="risk-actions">
            <button
              className="add-event-btn"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                setError(null)
                try {
                  const payload = {
                    enabled: Boolean(config.enabled),
                    chat_id: String(config.chat_id || "").trim(),
                    daily_digest_time: String(config.daily_digest_time || "").trim(),
                    pre_alert_minutes: Number(config.pre_alert_minutes || 0),
                    timezone: config.timezone,
                    pair: config.pair,
                  }
                  const res = await fetch(`${baseUrl}/v1/admin/news/signal-config`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload),
                  })
                  const body = await res.json().catch(() => null)
                  if (!res.ok) throw new Error(body?.error || t("manage.signal.errorSave", lang))
                  setConfig(normalize(body))
                } catch (e: any) {
                  setError(e?.message || t("manage.signal.errorSave", lang))
                } finally {
                  setSaving(false)
                }
              }}
            >
              {saving ? t("common.saving", lang) : t("manage.signal.save", lang)}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
