import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { ArrowLeft, CheckCheck, Bell, ShieldAlert, Gift, Newspaper } from "lucide-react"
import type { AppNotification } from "../../types"
import "./NotificationsPage.css"

interface NotificationsPageProps {
  items: AppNotification[]
  onBack: () => void
  onMarkAllRead: () => void
  onItemClick: (notificationID: string) => void
}

const pageSize = 30

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

export default function NotificationsPage({ items, onBack, onMarkAllRead, onItemClick }: NotificationsPageProps) {
  const hasUnread = items.some(item => !item.read)
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setVisibleCount(prev => {
      const base = prev > pageSize ? prev : pageSize
      return Math.min(base, Math.max(items.length, pageSize))
    })
  }, [items.length])

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount])
  const hasMore = visibleCount < items.length

  const loadMore = useCallback(() => {
    setVisibleCount(prev => {
      if (prev >= items.length) return prev
      return Math.min(prev + pageSize, items.length)
    })
  }, [items.length])

  useEffect(() => {
    if (!hasMore) return
    const target = sentinelRef.current
    if (!target) return
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadMore()
          break
        }
      }
    }, {
      root: null,
      rootMargin: "160px 0px",
      threshold: 0,
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loadMore, visibleItems.length])

  const handleItemClick = useCallback((item: AppNotification) => {
    if (!item.read) onItemClick(item.id)
  }, [onItemClick])

  const handleItemKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>, item: AppNotification) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    if (!item.read) onItemClick(item.id)
  }, [onItemClick])

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
          visibleItems.map(item => {
            const Icon = iconForKind(item.kind)
            return (
              <article
                key={item.id}
                className={`notification-item ${item.read ? "read" : "unread"}`}
                role="button"
                tabIndex={0}
                onClick={() => handleItemClick(item)}
                onKeyDown={(event) => handleItemKeyDown(event, item)}
              >
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
        {hasMore && (
          <div className="notifications-sentinel" ref={sentinelRef}>
            <span className="notifications-loading">Loading more...</span>
          </div>
        )}
      </div>
    </div>
  )
}
