import { useCallback, useEffect, useState } from "react"
import { Activity, Database, RefreshCw, Trash2 } from "lucide-react"
import Skeleton from "../Skeleton"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

type SystemHealthCardProps = {
    lang: Lang
    baseUrl: string
    headers: Record<string, string>
    canAccess: boolean
    showUpdater?: boolean
    showDangerZone?: boolean
    showRaw?: boolean
}

type HealthResponse = {
    status: string
    timestamp: string
    uptime_sec: number
    uptime: string
    build?: {
        version?: string
        revision?: string
        updated_at?: string
        main_path?: string
    }
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

type ResetDBResponse = {
    status: string
    log_id: number
    deleted_tables: string[]
    deleted_count: number
}

type UpdaterStatusResponse = {
    enabled: boolean
    repo_dir?: string
    deploy_command?: string
    auto_enabled: boolean
    interval_minutes: number
    busy: boolean
    busy_kind?: string
    current_branch?: string
    current_revision?: string
    remote_revision?: string
    update_available: boolean
    last_checked_at?: string
    last_check_ok?: boolean
    last_check_error?: string
    last_updated_at?: string
    last_update_ok?: boolean
    last_update_error?: string
    last_update_output?: string
    next_auto_check_at?: string
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

const fmtVersion = (build?: HealthResponse["build"]) => {
    if (!build) return "—"
    const version = String(build.version || "").trim()
    const revision = String(build.revision || "").trim()
    if (version && revision && !version.includes(revision.slice(0, 7))) {
        return `${version} (${revision.slice(0, 7)})`
    }
    if (version) return version
    if (revision) return revision.slice(0, 7)
    return "—"
}

const shortRev = (raw?: string) => {
    const value = String(raw || "").trim()
    if (!value) return "—"
    return value.length > 12 ? value.slice(0, 12) : value
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

const formatPingMs = (pingMs?: number, dbUp?: number) => {
    const raw = Number.isFinite(Number(pingMs)) ? Number(pingMs) : 0
    if ((dbUp ?? 0) === 1 && raw <= 0) {
        return "<1 ms"
    }
    return `${Math.max(0, Math.round(raw))} ms`
}

export default function SystemHealthCard({
    lang,
    baseUrl,
    headers,
    canAccess,
    showUpdater = true,
    showDangerZone = true,
    showRaw = true,
}: SystemHealthCardProps) {
    const [health, setHealth] = useState<HealthResponse | null>(null)
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
    const [updater, setUpdater] = useState<UpdaterStatusResponse | null>(null)
    const [updaterAutoEnabled, setUpdaterAutoEnabled] = useState(false)
    const [updaterInterval, setUpdaterInterval] = useState("10")
    const [updaterActionLoading, setUpdaterActionLoading] = useState<"" | "check" | "update" | "save">("")
    const [updaterStatus, setUpdaterStatus] = useState<string | null>(null)
    const [updaterNotice, setUpdaterNotice] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [resetConfirm, setResetConfirm] = useState("")
    const [resetLoading, setResetLoading] = useState(false)
    const [resetStatus, setResetStatus] = useState<string | null>(null)

    const refresh = useCallback(async () => {
        if (!canAccess) return
        setLoading(true)
        setError(null)
        try {
            const [healthRes, metricsRes, updaterRes] = await Promise.all([
                fetch(`${baseUrl}/v1/admin/system/health`, { headers }),
                fetch(`${baseUrl}/v1/admin/system/metrics`, { headers }),
                fetch(`${baseUrl}/v1/admin/system/updater`, { headers }),
            ])
            if (!healthRes.ok) {
                const body = await healthRes.json().catch(() => null)
                throw new Error(body?.error || t("manage.system.error.fetchHealth", lang))
            }
            if (!metricsRes.ok) {
                const body = await metricsRes.json().catch(() => null)
                throw new Error(body?.error || t("manage.system.error.fetchMetrics", lang))
            }
            if (!updaterRes.ok) {
                const body = await updaterRes.json().catch(() => null)
                throw new Error(body?.error || t("manage.system.updater.errorStatus", lang))
            }

            const healthJson = await healthRes.json()
            const metricsJson = await metricsRes.json()
            setHealth(healthJson || null)
            setMetrics(metricsJson || null)
            if (updaterRes.ok) {
                const updaterJson = await updaterRes.json().catch(() => null)
                setUpdater(updaterJson || null)
                setUpdaterAutoEnabled(Boolean(updaterJson?.auto_enabled))
                setUpdaterInterval(String(updaterJson?.interval_minutes ?? 10))
                setUpdaterNotice(null)
            } else {
                setUpdater(null)
                setUpdaterNotice(t("manage.system.updater.unavailable", lang))
            }
        } catch (e: any) {
            setError(e?.message || t("manage.system.error.loadDiagnostics", lang))
        } finally {
            setLoading(false)
        }
    }, [baseUrl, headers, canAccess, lang])

    const resetDatabase = useCallback(async () => {
        if (!canAccess) return
        const phrase = t("manage.system.reset.confirmPhrase", lang)
        if (resetConfirm.trim() !== phrase) return
        const approved = window.confirm(t("manage.system.reset.confirmDialog", lang))
        if (!approved) return

        setResetLoading(true)
        setResetStatus(null)
        setError(null)
        try {
            const res = await fetch(`${baseUrl}/v1/admin/system/reset-db`, {
                method: "POST",
                headers,
                body: JSON.stringify({ confirm: phrase }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                throw new Error(body?.error || t("manage.system.reset.error", lang))
            }
            const data = body as ResetDBResponse
            setResetStatus(
                t("manage.system.reset.success", lang)
                    .replace("{count}", String(data?.deleted_count ?? 0))
                    .replace("{logId}", String(data?.log_id ?? 0)),
            )
            setResetConfirm("")
            await refresh()
        } catch (e: any) {
            setError(e?.message || t("manage.system.reset.error", lang))
        } finally {
            setResetLoading(false)
        }
    }, [baseUrl, headers, canAccess, lang, resetConfirm, refresh])

    const saveUpdaterConfig = useCallback(async () => {
        if (!canAccess) return
        const interval = Math.max(1, Math.min(1440, Number.parseInt(updaterInterval, 10) || 10))
        setUpdaterActionLoading("save")
        setUpdaterStatus(null)
        setUpdaterNotice(null)
        setError(null)
        try {
            const res = await fetch(`${baseUrl}/v1/admin/system/updater/config`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    auto_enabled: updaterAutoEnabled,
                    interval_minutes: interval,
                }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                throw new Error(body?.error || t("manage.system.updater.errorSave", lang))
            }
            const data = body as UpdaterStatusResponse
            setUpdater(data)
            setUpdaterAutoEnabled(Boolean(data.auto_enabled))
            setUpdaterInterval(String(data.interval_minutes || interval))
            setUpdaterStatus(t("manage.system.updater.saveOk", lang))
        } catch (e: any) {
            setError(e?.message || t("manage.system.updater.errorSave", lang))
        } finally {
            setUpdaterActionLoading("")
        }
    }, [baseUrl, headers, canAccess, updaterInterval, updaterAutoEnabled, lang])

    const checkUpdater = useCallback(async () => {
        if (!canAccess) return
        setUpdaterActionLoading("check")
        setUpdaterStatus(null)
        setUpdaterNotice(null)
        setError(null)
        try {
            const res = await fetch(`${baseUrl}/v1/admin/system/updater/check`, {
                method: "POST",
                headers,
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                throw new Error(body?.error || t("manage.system.updater.errorCheck", lang))
            }
            const data = body as UpdaterStatusResponse
            setUpdater(data)
            setUpdaterAutoEnabled(Boolean(data.auto_enabled))
            setUpdaterInterval(String(data.interval_minutes || 10))
            setUpdaterStatus(t("manage.system.updater.checkOk", lang))
        } catch (e: any) {
            setError(e?.message || t("manage.system.updater.errorCheck", lang))
        } finally {
            setUpdaterActionLoading("")
        }
    }, [baseUrl, headers, canAccess, lang])

    const runUpdater = useCallback(async () => {
        if (!canAccess) return
        const approved = window.confirm(t("manage.system.updater.confirmUpdate", lang))
        if (!approved) return
        setUpdaterActionLoading("update")
        setUpdaterStatus(null)
        setUpdaterNotice(null)
        setError(null)
        try {
            const res = await fetch(`${baseUrl}/v1/admin/system/updater/update`, {
                method: "POST",
                headers,
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                throw new Error(body?.error || t("manage.system.updater.errorUpdate", lang))
            }
            const data = body as UpdaterStatusResponse
            setUpdater(data)
            setUpdaterAutoEnabled(Boolean(data.auto_enabled))
            setUpdaterInterval(String(data.interval_minutes || 10))
            setUpdaterStatus(t("manage.system.updater.updateOk", lang))
            await refresh()
        } catch (e: any) {
            setError(e?.message || t("manage.system.updater.errorUpdate", lang))
        } finally {
            setUpdaterActionLoading("")
        }
    }, [baseUrl, headers, canAccess, lang, refresh])

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
    const updaterAvailable = Boolean(updater?.update_available)
    const updaterBusy = Boolean(updater?.busy)
    const updaterIntervalNum = Math.max(1, Math.min(1440, Number.parseInt(updaterInterval, 10) || 10))
    const updaterStateText = !updater?.enabled
        ? t("manage.system.updater.disabled", lang)
        : updaterBusy
            ? (updater?.busy_kind === "update" ? t("manage.system.updater.busyUpdate", lang) : t("manage.system.updater.busyCheck", lang))
            : (updaterAvailable ? t("manage.system.updater.available", lang) : t("manage.system.updater.upToDate", lang))

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
                            <strong>{formatPingMs(metrics.db_ping_ms, metrics.db_up)}</strong>
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
                            <span>{t("manage.system.version", lang)}</span>
                            <strong>{fmtVersion(health.build)}</strong>
                        </div>
                        <div className="system-health-stat">
                            <span>{t("manage.system.memory", lang)}</span>
                            <strong>{bytesToHuman(metrics.memory.alloc_bytes)}</strong>
                        </div>
                        <div className="system-health-stat">
                            <span>{t("manage.system.deployedAt", lang)}</span>
                            <strong>{fmtDateTime(health.build?.updated_at)}</strong>
                        </div>
                        <div className="system-health-stat">
                            <span>{t("manage.system.dbPool", lang)}</span>
                            <strong>{metrics.db_pool.acquired_conns}/{metrics.db_pool.max_conns} {t("manage.system.dbPoolHint", lang)}</strong>
                        </div>
                        <div className="system-health-stat">
                            <span>{t("manage.system.updated", lang)}</span>
                            <strong>{fmtDateTime(metrics.timestamp)}</strong>
                        </div>
                    </div>

                    {showUpdater && updater && (
                        <div className={`system-updater ${updaterAvailable ? "update-available" : ""}`}>
                            <div className="system-updater-head">
                                <h3>{t("manage.system.updater.title", lang)}</h3>
                                {updaterAvailable && (
                                    <span className="system-updater-badge">{t("manage.system.updater.badge", lang)}</span>
                                )}
                            </div>
                            <div className="system-updater-grid">
                                <div className="system-updater-item">
                                    <span>{t("manage.system.updater.current", lang)}</span>
                                    <strong>{shortRev(updater.current_revision)}</strong>
                                </div>
                                <div className="system-updater-item">
                                    <span>{t("manage.system.updater.remote", lang)}</span>
                                    <strong>{shortRev(updater.remote_revision)}</strong>
                                </div>
                                <div className="system-updater-item">
                                    <span>{t("manage.system.updater.branch", lang)}</span>
                                    <strong>{updater.current_branch || "—"}</strong>
                                </div>
                                <div className="system-updater-item">
                                    <span>{t("manage.system.updater.nextAuto", lang)}</span>
                                    <strong>{fmtDateTime(updater.next_auto_check_at)}</strong>
                                </div>
                                <div className="system-updater-item">
                                    <span>{t("manage.system.updater.lastCheck", lang)}</span>
                                    <strong>{fmtDateTime(updater.last_checked_at)}</strong>
                                </div>
                                <div className="system-updater-item">
                                    <span>{t("manage.system.updater.lastUpdate", lang)}</span>
                                    <strong>{fmtDateTime(updater.last_updated_at)}</strong>
                                </div>
                            </div>

                            <div className="system-updater-config">
                                <label className="system-updater-toggle">
                                    <input
                                        type="checkbox"
                                        checked={updaterAutoEnabled}
                                        onChange={(e) => setUpdaterAutoEnabled(e.target.checked)}
                                        disabled={updaterActionLoading !== "" || updaterBusy}
                                    />
                                    <span>{t("manage.system.updater.auto", lang)}</span>
                                </label>
                                <label className="system-updater-interval">
                                    <span>{t("manage.system.updater.interval", lang)}</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={1440}
                                        step={1}
                                        value={updaterInterval}
                                        onChange={(e) => setUpdaterInterval(e.target.value)}
                                        disabled={updaterActionLoading !== "" || updaterBusy}
                                    />
                                    <small>{t("manage.system.updater.intervalHint", lang)}</small>
                                </label>
                                <button
                                    type="button"
                                    className="system-updater-btn ghost"
                                    onClick={saveUpdaterConfig}
                                    disabled={updaterActionLoading !== "" || updaterBusy}
                                >
                                    {updaterActionLoading === "save" ? t("manage.system.updater.processing", lang) : t("manage.system.updater.save", lang)}
                                </button>
                            </div>

                            <div className="system-updater-actions">
                                <button
                                    type="button"
                                    className="system-updater-btn"
                                    onClick={checkUpdater}
                                    disabled={updaterActionLoading !== "" || updaterBusy}
                                >
                                    {updaterActionLoading === "check" ? t("manage.system.updater.processing", lang) : t("manage.system.updater.check", lang)}
                                </button>
                                <button
                                    type="button"
                                    className="system-updater-btn primary"
                                    onClick={runUpdater}
                                    disabled={updaterActionLoading !== "" || updaterBusy || !updaterAvailable || !updater.enabled}
                                >
                                    {updaterActionLoading === "update" ? t("manage.system.updater.processing", lang) : t("manage.system.updater.update", lang)}
                                </button>
                            </div>

                            <div className="system-updater-status">{updaterStateText}</div>
                            <div className="system-updater-meta">
                                {t("manage.system.updater.interval", lang)}: {updaterIntervalNum}m
                            </div>
                            {updaterStatus && <div className="system-updater-status ok">{updaterStatus}</div>}

                            {updater.last_update_output && (
                                <details className="system-health-raw">
                                    <summary>{t("manage.system.updater.output", lang)}</summary>
                                    <pre>{updater.last_update_output}</pre>
                                </details>
                            )}
                        </div>
                    )}
                    {showUpdater && !updater && updaterNotice && (
                        <div className="system-updater">
                            <div className="system-updater-status">{updaterNotice}</div>
                        </div>
                    )}

                    {showRaw && (
                        <details className="system-health-raw">
                        <summary>{t("manage.system.rawHealth", lang)}</summary>
                        <pre>{JSON.stringify(health, null, 2)}</pre>
                    </details>
                    )}
                    {showRaw && (
                        <details className="system-health-raw">
                        <summary>{t("manage.system.rawMetrics", lang)}</summary>
                        <pre>{JSON.stringify(metrics, null, 2)}</pre>
                    </details>
                    )}

                    {showDangerZone && (
                        <div className="system-danger-zone">
                        <div className="system-danger-zone-title">
                            <Trash2 size={14} />
                            <span>{t("manage.system.reset.title", lang)}</span>
                        </div>
                        <p className="system-danger-zone-text">{t("manage.system.reset.description", lang)}</p>
                        <label htmlFor="system-reset-confirm" className="system-danger-zone-label">
                            {t("manage.system.reset.label", lang)}
                        </label>
                        <input
                            id="system-reset-confirm"
                            className="system-danger-zone-input"
                            type="text"
                            value={resetConfirm}
                            onChange={(e) => setResetConfirm(e.target.value)}
                            placeholder={t("manage.system.reset.placeholder", lang)}
                            autoComplete="off"
                        />
                        <button
                            className="system-danger-zone-btn"
                            onClick={resetDatabase}
                            disabled={resetLoading || resetConfirm.trim() !== t("manage.system.reset.confirmPhrase", lang)}
                        >
                            <Trash2 size={14} />
                            {resetLoading ? t("manage.system.reset.processing", lang) : t("manage.system.reset.action", lang)}
                        </button>
                        {resetStatus && <div className="system-danger-zone-status">{resetStatus}</div>}
                    </div>
                    )}
                </>
            )}
        </div>
    )
}
