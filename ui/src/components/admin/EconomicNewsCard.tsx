import { useState } from "react"
import { CalendarClock, Loader2, Plus, Radio, X } from "lucide-react"
import type { EconomicNewsEvent } from "./types"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

interface EconomicNewsCardProps {
  lang: Lang
  canAccess: boolean
  events: EconomicNewsEvent[]
  total: number
  loading: boolean
  onRefresh: () => void
  onLoadMore: () => void
  onCreate: (payload: {
    title: string
    impact: "low" | "medium" | "high"
    forecastValue: number
    scheduledAt: string
    preSeconds: number
    eventSeconds: number
    postSeconds: number
  }) => Promise<void>
  onCancel: (id: number) => Promise<void>
}

const toLocalInputValue = (date: Date) => {
  const d = new Date(date)
  d.setSeconds(0, 0)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const defaultSchedule = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() + 20)
  return toLocalInputValue(d)
}

const formatAt = (raw: string) => {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return "—"
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fmtNum = (v?: number | null) => {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return "0.00"
  return n.toFixed(2)
}

export default function EconomicNewsCard({
  lang,
  canAccess,
  events,
  total,
  loading,
  onRefresh,
  onLoadMore,
  onCreate,
  onCancel,
}: EconomicNewsCardProps) {
  const [title, setTitle] = useState("")
  const [impact, setImpact] = useState<"low" | "medium" | "high">("medium")
  const [forecast, setForecast] = useState("100")
  const [scheduledAt, setScheduledAt] = useState(defaultSchedule)
  const [preSeconds, setPreSeconds] = useState("900")
  const [eventSeconds, setEventSeconds] = useState("300")
  const [postSeconds, setPostSeconds] = useState("3600")
  const [busy, setBusy] = useState(false)

  if (!canAccess) return null

  const hasMore = events.length < total
  const impactText = (impact: string) => {
    const value = String(impact || "").toLowerCase()
    if (value === "low" || value === "medium" || value === "high") return t(`manage.news.impact.${value}`, lang)
    return String(impact || "—")
  }
  const statusText = (status: string) => {
    const value = String(status || "").toLowerCase()
    if (value === "pending") return t("manage.events.status.pending", lang)
    if (value === "pre") return t("manage.events.status.pre", lang)
    if (value === "live") return t("manage.events.status.live", lang)
    if (value === "post") return t("manage.events.status.post", lang)
    if (value === "completed") return t("manage.events.status.completed", lang)
    if (value === "cancelled") return t("manage.events.status.cancelled", lang)
    return status
  }

  const handleCreate = async () => {
    const eventForecast = Number(forecast)
    const p = Number(preSeconds)
    const e = Number(eventSeconds)
    const post = Number(postSeconds)
    if (!title.trim()) return
    if (!Number.isFinite(eventForecast)) return
    setBusy(true)
    try {
      await onCreate({
        title: title.trim(),
        impact,
        forecastValue: eventForecast,
        scheduledAt: new Date(scheduledAt).toISOString(),
        preSeconds: Number.isFinite(p) ? p : 900,
        eventSeconds: Number.isFinite(e) ? e : 300,
        postSeconds: Number.isFinite(post) ? post : 3600,
      })
      setTitle("")
      setScheduledAt(defaultSchedule())
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-card full-width">
      <div className="admin-card-header">
        <Radio size={20} />
        <h2>{t("manage.news.title", lang)}</h2>
      </div>

      <div className="event-form">
        <div className="event-form-row">
          <div className="event-field">
            <label>{t("manage.news.form.title", lang)}</label>
            <input
              value={title}
              maxLength={120}
              onChange={e => setTitle(e.target.value)}
              placeholder={t("manage.news.form.titlePlaceholder", lang)}
            />
          </div>
          <div className="event-field">
            <label>{t("manage.news.form.impact", lang)}</label>
            <select value={impact} onChange={e => setImpact(e.target.value as "low" | "medium" | "high")}>
              <option value="low">{t("manage.news.impact.low", lang)}</option>
              <option value="medium">{t("manage.news.impact.medium", lang)}</option>
              <option value="high">{t("manage.news.impact.high", lang)}</option>
            </select>
          </div>
          <div className="event-field">
            <label>{t("manage.news.form.forecast", lang)}</label>
            <input value={forecast} onChange={e => setForecast(e.target.value)} placeholder="100.00" />
          </div>
          <div className="event-field">
            <label>{t("manage.news.form.startTime", lang)}</label>
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          </div>
          <div className="event-field">
            <label>{t("manage.news.form.preSec", lang)}</label>
            <input value={preSeconds} onChange={e => setPreSeconds(e.target.value)} />
          </div>
          <div className="event-field">
            <label>{t("manage.news.form.liveSec", lang)}</label>
            <input value={eventSeconds} onChange={e => setEventSeconds(e.target.value)} />
          </div>
          <div className="event-field">
            <label>{t("manage.news.form.postSec", lang)}</label>
            <input value={postSeconds} onChange={e => setPostSeconds(e.target.value)} />
          </div>
          <button className="add-event-btn" onClick={handleCreate} disabled={busy || loading}>
            {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            <span>{t("manage.news.form.create", lang)}</span>
          </button>
        </div>
      </div>

      <div className="events-list">
        {events.length === 0 ? (
          <div className="no-events">
            <CalendarClock size={20} />
            <span>{t("manage.news.empty", lang)}</span>
          </div>
        ) : events.map(item => {
          const canCancel = (item.status === "pending" || item.status === "pre") && item.source !== "auto"
          return (
            <div key={item.id} className={`event-item ${item.status}`}>
              <div className="event-info">
                <span className={`event-status ${item.status}`}>{statusText(item.status)}</span>
                <span className="event-duration">{item.title}</span>
                <span className="event-duration event-scheduled">{formatAt(item.scheduled_at)}</span>
                <span className="event-duration">{t("manage.news.item.impact", lang)}: {impactText(item.impact)}</span>
                <span className="event-duration">{t("accounts.news.valueForecast", lang)}: {fmtNum(item.forecast_value)} / {t("accounts.news.valueActual", lang)}: {item.actual_value == null ? "—" : fmtNum(item.actual_value)}</span>
                <span className="event-duration">{item.source}/{item.rule_key}</span>
              </div>
              {canCancel && (
                <button className="cancel-event-btn" onClick={() => onCancel(item.id)} disabled={busy || loading}>
                  <X size={16} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="risk-actions">
        <button className="add-event-btn" onClick={onRefresh} disabled={loading || busy}>
          {loading ? <Loader2 className="spin" size={16} /> : <CalendarClock size={16} />}
          <span>{t("manage.news.refresh", lang)}</span>
        </button>
        {hasMore && (
          <button className="add-event-btn" onClick={onLoadMore} disabled={loading || busy}>
            <Plus size={16} />
            <span>{t("manage.news.loadMoreCounter", lang).replace("{loaded}", String(events.length)).replace("{total}", String(total))}</span>
          </button>
        )}
      </div>
    </div>
  )
}
