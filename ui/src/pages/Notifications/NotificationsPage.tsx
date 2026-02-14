import { ArrowLeft, CheckCheck, Bell, ShieldAlert, Gift, Newspaper } from "lucide-react"
import type { AppNotification } from "../../types"
import "./NotificationsPage.css"

interface NotificationsPageProps {
  items: AppNotification[]
  onBack: () => void
  onMarkAllRead: () => void
}

const formatDate = (raw: string) => {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ""
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const min = String(d.getMinutes()).padStart(2, "0")
  return `${yyyy}.${mm}.${dd} ${hh}:${min}`
}

const iconForKind = (kind: AppNotification["kind"]) => {
  if (kind === "system") return ShieldAlert
  if (kind === "bonus") return Gift
  if (kind === "news") return Newspaper
  return Bell
}

export default function NotificationsPage({ items, onBack, onMarkAllRead }: NotificationsPageProps) {
  const hasUnread = items.some(item => !item.read)

  return (
    <div className="notifications-page">
      <div className="notifications-header">
        <button
          type="button"
          className="notifications-back-btn"
          onClick={onBack}
          aria-label="Back to accounts"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="notifications-title">Notifications</h2>
        <button
          type="button"
          className="notifications-read-btn"
          onClick={onMarkAllRead}
          disabled={!hasUnread}
          aria-label="Mark all as read"
        >
          <CheckCheck size={18} />
        </button>
      </div>

      <div className="notifications-list">
        {items.length === 0 ? (
          <div className="notifications-empty">No notifications yet</div>
        ) : (
          items.map(item => {
            const Icon = iconForKind(item.kind)
            return (
              <article key={item.id} className={`notification-item ${item.read ? "read" : "unread"}`}>
                <div className="notification-icon">
                  <Icon size={14} />
                </div>
                <div className="notification-content">
                  <div className="notification-top">
                    <h3 className="notification-title">{item.title}</h3>
                    <span className="notification-time">{formatDate(item.created_at)}</span>
                  </div>
                  <p className="notification-message">{item.message}</p>
                </div>
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
