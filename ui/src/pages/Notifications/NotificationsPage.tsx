import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { ArrowLeft, CheckCheck, Bell, ShieldAlert, Gift, Newspaper, X } from "lucide-react"
import type { AppNotification, Lang } from "../../types"
import { t } from "../../utils/i18n"
import "./NotificationsPage.css"

interface NotificationsPageProps {
  lang: Lang
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

const localeByLang = (lang: Lang) => {
  if (lang === "ru") return "ru-RU"
  if (lang === "uz") return "uz-UZ"
  return "en-US"
}

const formatMoney = (value: string | undefined, lang: Lang, fractionDigits = 2) => {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return "0.00"
  return new Intl.NumberFormat(localeByLang(lang), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(num)
}

const formatPercent = (value?: string) => {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return "0.00%"
  return `${num.toFixed(2)}%`
}

export default function NotificationsPage({ lang, items, onBack, onMarkAllRead, onItemClick }: NotificationsPageProps) {
  const hasUnread = items.some(item => !item.read)
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState<AppNotification | null>(null)

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

  useEffect(() => {
    if (!selected) return
    if (!items.some(item => item.id === selected.id)) {
      setSelected(null)
    }
  }, [items, selected])

  const handleItemClick = useCallback((item: AppNotification) => {
    if (!item.read) onItemClick(item.id)
    setSelected(item)
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
          aria-label={t("notifications.backToAccounts", lang)}
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="notifications-title">{t("notifications.title", lang)}</h2>
        <button
          type="button"
          className="notifications-read-btn"
          onClick={onMarkAllRead}
          disabled={!hasUnread}
          aria-label={t("notifications.markAllRead", lang)}
        >
          <CheckCheck size={18} />
        </button>
      </div>

      <div className="notifications-list">
        {items.length === 0 ? (
          <div className="notifications-empty">{t("notifications.empty", lang)}</div>
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
            <span className="notifications-loading">{t("notifications.loadingMore", lang)}</span>
          </div>
        )}
      </div>
      {selected ? (
        <div className="notifications-detail-overlay" role="dialog" aria-modal="true">
          <div className="notifications-detail-backdrop" onClick={() => setSelected(null)} />
          <div className="notifications-detail-sheet">
            <div className="notifications-detail-head">
              <h3 className="notifications-detail-title">{selected.title}</h3>
              <button
                type="button"
                className="notifications-detail-close"
                onClick={() => setSelected(null)}
                aria-label={t("notifications.closeDetails", lang)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="notifications-detail-body">
              <div className="notifications-detail-message">{selected.message}</div>
              {selected.details?.kind === "margin_call" || selected.details?.kind === "stop_out" ? (
                <>
                  <div className="notifications-detail-grid">
                    <div className="notifications-detail-row">
                      <span className="notifications-detail-label">{t("time", lang)}</span>
                      <span className="notifications-detail-value">{formatDate(selected.details.triggered_at || selected.created_at)}</span>
                    </div>
                    <div className="notifications-detail-row">
                      <span className="notifications-detail-label">{t("notifications.reason", lang)}</span>
                      <span className="notifications-detail-value">{selected.details.reason || t("notifications.riskRuleTriggered", lang)}</span>
                    </div>
                    <div className="notifications-detail-row">
                      <span className="notifications-detail-label">{t("notifications.closedOrders", lang)}</span>
                      <span className="notifications-detail-value">{selected.details.closed_orders || 0}</span>
                    </div>
                    <div className="notifications-detail-row">
                      <span className="notifications-detail-label">{t("notifications.totalLoss", lang)}</span>
                      <span className="notifications-detail-value">
                        {formatMoney(selected.details.total_loss, lang)} USD
                        {selected.details.total_loss_estimated ? ` (${t("notifications.estimated", lang)})` : ""}
                      </span>
                    </div>
                    <div className="notifications-detail-row">
                      <span className="notifications-detail-label">{t("balance", lang)}</span>
                      <span className="notifications-detail-value">
                        {formatMoney(selected.details.balance_before, lang)}{" -> "}{formatMoney(selected.details.balance_after || selected.details.balance_before, lang)} USD
                      </span>
                    </div>
                    <div className="notifications-detail-row">
                      <span className="notifications-detail-label">{t("equity", lang)}</span>
                      <span className="notifications-detail-value">
                        {formatMoney(selected.details.equity_before, lang)}{" -> "}{formatMoney(selected.details.equity_after || selected.details.equity_before, lang)} USD
                      </span>
                    </div>
                    <div className="notifications-detail-row">
                      <span className="notifications-detail-label">{t("marginLevel", lang)}</span>
                      <span className="notifications-detail-value">
                        {formatPercent(selected.details.margin_level_before)}{" -> "}{formatPercent(selected.details.margin_level_after || selected.details.margin_level_before)}
                      </span>
                    </div>
                    <div className="notifications-detail-row">
                      <span className="notifications-detail-label">{t("notifications.stopOutLevel", lang)}</span>
                      <span className="notifications-detail-value">{formatPercent(selected.details.threshold_percent)}</span>
                    </div>
                  </div>
                  <div className="notifications-detail-tip">
                    {t("notifications.stopOutTip", lang)}
                  </div>
                </>
              ) : (
                <div className="notifications-detail-grid">
                  <div className="notifications-detail-row">
                    <span className="notifications-detail-label">{t("time", lang)}</span>
                    <span className="notifications-detail-value">{formatDate(selected.created_at)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
