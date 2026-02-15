import { useCallback, useEffect, useState } from "react"
import { Activity, Database, RefreshCw } from "lucide-react"
import Skeleton from "../Skeleton"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

type SystemHealthCardProps = {
    lang: Lang
    baseUrl: string
    headers: Record<string, string>
    canAccess: boolean
}

type HealthResponse = {
    status: string
    timestamp: string
    uptime_sec: number
    uptime: string
    database?: {
        reachable: boolean
        ping_ms: number
    }
    runtime?: {
        goroutines: number
    }
    memory?: {
        alloc_bytes: number
    }
}

type MetricsResponse = {
    timestamp: string
    uptime_sec: number
    process_up: number
    db_up: number
    db_ping_ms: number
    runtime: {
        goroutines: number
        gomaxprocs: number
        cpu_count: number
        num_gc: number
    }
    memory: {
        alloc_bytes: number
        heap_alloc_bytes: number
        heap_inuse_bytes: number
        sys_bytes: number
    }
    db_pool: {
        total_conns: number
        idle_conns: number
        acquired_conns: number
        max_conns: number
    }
}

const bytesToHuman = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return "0 B"
    const units = ["B", "KB", "MB", "GB"]
    let idx = 0
    let n = value
    while (n >= 1024 && idx < units.length - 1) {
        n /= 1024
        idx += 1
    }
    return `${n.toFixed(n >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`
}

const fmtDateTime = (raw?: string) => {
    if (!raw) return "—"
    const t = new Date(raw)
    if (Number.isNaN(t.getTime())) return raw
    return t.toLocaleString()
}

const formatUptime = (rawSeconds?: number, units?: { day: string; hour: string; minute: string; second: string }) => {
    const total = Math.max(0, Math.floor(Number(rawSeconds) || 0))
    const days = Math.floor(total / 86400)
    const hours = Math.floor((total % 86400) / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    const labels = units || { day: "d", hour: "h", minute: "m", second: "s" }

    const parts: string[] = []
    if (days > 0) parts.push(`${days}${labels.day}`)
    if (hours > 0 || days > 0) parts.push(`${hours}${labels.hour}`)
    if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}${labels.minute}`)
    parts.push(`${seconds}${labels.second}`)
    return parts.join(" ")
}

export default function SystemHealthCard({ lang, baseUrl, headers, canAccess }: SystemHealthCardProps) {
    const [health, setHealth] = useState<HealthResponse | null>(null)
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const refresh = useCallback(async () => {
        if (!canAccess) return
        setLoading(true)
        setError(null)
        try {
            const [healthRes, metricsRes] = await Promise.all([
                fetch(`${baseUrl}/v1/admin/system/health`, { headers }),
                fetch(`${baseUrl}/v1/admin/system/metrics`, { headers }),
            ])
            if (!healthRes.ok) {
                const body = await healthRes.json().catch(() => null)
                throw new Error(body?.error || t("manage.system.error.fetchHealth", lang))
            }
            if (!metricsRes.ok) {
                const body = await metricsRes.json().catch(() => null)
                throw new Error(body?.error || t("manage.system.error.fetchMetrics", lang))
            }

            const healthJson = await healthRes.json()
            const metricsJson = await metricsRes.json()
            setHealth(healthJson || null)
            setMetrics(metricsJson || null)
        } catch (e: any) {
            setError(e?.message || t("manage.system.error.loadDiagnostics", lang))
        } finally {
            setLoading(false)
        }
    }, [baseUrl, headers, canAccess, lang])

    useEffect(() => {
        if (!canAccess) return
        refresh()
    }, [canAccess, refresh])

    useEffect(() => {
        if (!canAccess) return
        const timer = setInterval(() => {
            refresh()
        }, 10000)
        return () => clearInterval(timer)
    }, [canAccess, refresh])

    if (!canAccess) return null

    const overallOk = health?.status === "ok"
    const dbOk = (health?.database?.reachable ?? false) || (metrics?.db_up ?? 0) === 1

    return (
        <div className="admin-card full-width">
            <div className="admin-card-header">
                <Activity size={18} />
                <h2>{t("manage.system.title", lang)}</h2>
                <button className="system-health-refresh" onClick={refresh} disabled={loading}>
                    <RefreshCw size={14} className={loading ? "spin" : ""} />
                    {t("manage.system.refresh", lang)}
                </button>
            </div>

            {error && <div className="system-health-error">{error}</div>}

            {!health || !metrics ? (
                <div className="system-health-skeleton">
                    <Skeleton width="100%" height={72} radius={12} />
                    <Skeleton width="100%" height={72} radius={12} />
                </div>
            ) : (
                <>
                    <div className="system-health-grid">
                        <div className={`system-health-stat ${overallOk ? "ok" : "warn"}`}>
                            <span>{t("manage.system.api", lang)}</span>
                            <strong>{overallOk ? t("manage.system.status.ok", lang) : t("manage.system.status.degraded", lang)}</strong>
                        </div>
                        <div className={`system-health-stat ${dbOk ? "ok" : "warn"}`}>
                            <span><Database size={14} /> {t("manage.system.db", lang)}</span>
                            <strong>{dbOk ? t("manage.system.status.up", lang) : t("manage.system.status.down", lang)}</strong>
                        </div>
                        <div className="system-health-stat">
                            <span>{t("manage.system.ping", lang)}</span>
                            <strong>{metrics.db_ping_ms} ms</strong>
                        </div>
                        <div className="system-health-stat">
                            <span>{t("manage.system.uptime", lang)}</span>
                            <strong>{formatUptime(health.uptime_sec ?? metrics.uptime_sec, {
                                day: t("manage.system.unit.day", lang),
                                hour: t("manage.system.unit.hour", lang),
                                minute: t("manage.system.unit.minute", lang),
                                second: t("manage.system.unit.second", lang),
                            })}</strong>
                        </div>
                        <div className="system-health-stat">
                            <span>{t("manage.system.goroutines", lang)}</span>
                            <strong>{metrics.runtime.goroutines}</strong>
                        </div>
                        <div className="system-health-stat">
                            <span>{t("manage.system.memory", lang)}</span>
                            <strong>{bytesToHuman(metrics.memory.alloc_bytes)}</strong>
                        </div>
                        <div className="system-health-stat">
                            <span>{t("manage.system.dbPool", lang)}</span>
                            <strong>{metrics.db_pool.acquired_conns}/{metrics.db_pool.max_conns}</strong>
                        </div>
                        <div className="system-health-stat">
                            <span>{t("manage.system.updated", lang)}</span>
                            <strong>{fmtDateTime(metrics.timestamp)}</strong>
                        </div>
                    </div>

                    <details className="system-health-raw">
                        <summary>{t("manage.system.rawHealth", lang)}</summary>
                        <pre>{JSON.stringify(health, null, 2)}</pre>
                    </details>
                    <details className="system-health-raw">
                        <summary>{t("manage.system.rawMetrics", lang)}</summary>
                        <pre>{JSON.stringify(metrics, null, 2)}</pre>
                    </details>
                </>
            )}
        </div>
    )
}
