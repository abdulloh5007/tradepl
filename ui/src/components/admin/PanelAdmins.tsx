import { useState, useEffect } from "react"
import { Shield, Plus, User, Trash2, Edit2, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { PanelAdmin } from "./types"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

interface PanelAdminsProps {
    lang: Lang
    baseUrl: string
    headers: any
    userRole: string | null
}

const allRights = ["sessions", "volatility", "trend", "events", "kyc_review", "deposit_review"]

const rightLabel = (value: string, lang: Lang) => {
    const normalized = String(value || "").trim().toLowerCase()
    if (normalized === "sessions") return t("manage.admins.rights.sessions", lang)
    if (normalized === "volatility") return t("manage.admins.rights.volatility", lang)
    if (normalized === "trend") return t("manage.admins.rights.trend", lang)
    if (normalized === "events") return t("manage.admins.rights.events", lang)
    if (normalized === "kyc_review") return t("manage.admins.rights.kycReview", lang)
    if (normalized === "deposit_review") return t("manage.admins.rights.depositReview", lang)
    const fallback = normalized.replace(/_/g, " ")
    if (!fallback) return value
    return fallback.charAt(0).toUpperCase() + fallback.slice(1)
}

const normalizeRights = (rights: unknown): string[] => {
    if (Array.isArray(rights)) {
        return rights.filter((r): r is string => typeof r === "string")
    }

    if (rights && typeof rights === "object") {
        return Object.entries(rights as Record<string, unknown>)
            .filter(([, enabled]) => enabled === true)
            .map(([right]) => right)
    }

    return []
}

export default function PanelAdmins({ lang, baseUrl, headers, userRole }: PanelAdminsProps) {
    const [panelAdmins, setPanelAdmins] = useState<PanelAdmin[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // New Admin State
    const [newAdminTgId, setNewAdminTgId] = useState("")
    const [newAdminName, setNewAdminName] = useState("")
    const [newAdminRights, setNewAdminRights] = useState<string[]>([])

    // Edit Admin State
    const [editingAdmin, setEditingAdmin] = useState<any>(null)
    const [editAdminName, setEditAdminName] = useState("")
    const [editAdminRights, setEditAdminRights] = useState<string[]>([])

    useEffect(() => {
        if (userRole === "owner") {
            fetchAdmins()
        }
    }, [userRole])

    const fetchAdmins = async () => {
        try {
            const res = await fetch(`${baseUrl}/v1/admin/panel-admins`, { headers })
            if (res.ok) {
                const data = await res.json()
                const normalized = Array.isArray(data)
                    ? data.map((admin: any) => ({ ...admin, rights: normalizeRights(admin.rights) }))
                    : []
                setPanelAdmins(normalized)
            }
        } catch (e) {
            console.error(e)
        }
    }

    const createAdmin = async () => {
        if (!newAdminTgId || !newAdminName) return
        setLoading(true)
        try {
            const rightsMap: Record<string, boolean> = {}
            newAdminRights.forEach(r => { rightsMap[r] = true })

            const res = await fetch(`${baseUrl}/v1/admin/panel-admins`, {
                method: "POST", headers,
                body: JSON.stringify({ telegram_id: parseInt(newAdminTgId), name: newAdminName, rights: rightsMap })
            })

            if (res.ok) {
                setNewAdminTgId("")
                setNewAdminName("")
                setNewAdminRights([])
                fetchAdmins()
            }
        } catch (e) {
            setError(t("manage.admins.error.create", lang))
        } finally {
            setLoading(false)
        }
    }

    const deleteAdmin = async (id: number) => {
        if (!confirm(t("manage.admins.confirmDelete", lang))) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/panel-admins/${id}`, { method: "DELETE", headers })
            fetchAdmins()
        } catch (e) { setError(t("manage.admins.error.delete", lang)) }
        finally { setLoading(false) }
    }

    const startEditing = (admin: any) => {
        setEditingAdmin(admin)
        setEditAdminName(admin.name)
        setEditAdminRights(normalizeRights(admin.rights))
    }

    const updateAdmin = async () => {
        if (!editingAdmin) return
        setLoading(true)
        try {
            const rightsMap: Record<string, boolean> = {}
            editAdminRights.forEach(r => rightsMap[r] = true)

            const res = await fetch(`${baseUrl}/v1/admin/panel-admins/${editingAdmin.id}`, {
                method: "PUT",
                headers: {
                    ...headers,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name: editAdminName,
                    rights: rightsMap
                })
            })
            if (!res.ok) throw new Error(t("manage.admins.error.update", lang))

            setError(null)
            setEditingAdmin(null)
            await fetchAdmins()
            toast.success(t("manage.admins.updated", lang))
        } catch (e) {
            setError(t("manage.admins.error.update", lang))
            toast.error(t("manage.admins.error.updateRights", lang))
        } finally {
            setLoading(false)
        }
    }

    const toggleNewAdminRight = (right: string) => {
        if (newAdminRights.includes(right)) {
            setNewAdminRights(newAdminRights.filter(r => r !== right))
        } else {
            setNewAdminRights([...newAdminRights, right])
        }
    }

    if (userRole !== "owner") return null

    return (
        <div className="admin-card full-width">
            <div className="admin-card-header">
                <Shield size={20} />
                <h2>{t("manage.admins.title", lang)}</h2>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="admin-form">
                <div className="admin-form-row">
                    <input type="number" value={newAdminTgId} onChange={e => setNewAdminTgId(e.target.value)} placeholder={t("manage.admins.telegramID", lang)} />
                    <input type="text" value={newAdminName} onChange={e => setNewAdminName(e.target.value)} placeholder={t("manage.admins.adminName", lang)} />
                </div>
                <div className="rights-chips">
                    {allRights.map(right => (
                        <button key={right}
                            className={`right-chip ${newAdminRights.includes(right) ? 'active' : ''}`}
                            onClick={() => toggleNewAdminRight(right)}>
                            {rightLabel(right, lang)}
                        </button>
                    ))}
                </div>
                <button className="add-event-btn" onClick={createAdmin} disabled={loading || !newAdminTgId || !newAdminName}>
                    {loading ? <Loader2 className="spin" /> : <Plus size={18} />}
                    <span>{t("manage.admins.add", lang)}</span>
                </button>
            </div>

            <div className="admins-list">
                {panelAdmins.length === 0 ? (
                    <div className="no-events">
                        <User size={24} />
                        <span>{t("manage.admins.empty", lang)}</span>
                    </div>
                ) : panelAdmins.map(admin => (
                    <div key={admin.id} className="admin-item">
                        <div className="admin-info">
                            <User size={20} />
                            <div className="admin-meta">
                                <span className="admin-name">{admin.name}</span>
                                <span className="admin-tg">{t("manage.admins.id", lang).replace("{id}", String(admin.telegram_id))}</span>
                            </div>
                        </div>
                        <div className="admin-rights">
                            {Array.isArray(admin.rights) && admin.rights.map(r => <span key={r} className="right-badge">{rightLabel(r, lang)}</span>)}
                        </div>
                        <div className="admin-actions">
                            <button className="edit-admin-btn" onClick={() => startEditing(admin)}>
                                <Edit2 size={16} />
                            </button>
                            <button className="delete-admin-btn" onClick={() => deleteAdmin(admin.id)}>
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Edit Admin Modal */}
            {editingAdmin && (
                <>
                    <div className="filter-overlay" onClick={() => setEditingAdmin(null)} />
                    <div className="filter-modal">
                        <div className="filter-header">
                            <h3>{t("manage.admins.editTitle", lang)}</h3>
                            <button onClick={() => setEditingAdmin(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="filter-custom">
                            <div className="date-range-inputs">
                                <div className="date-input-group" style={{ gridColumn: "1 / -1" }}>
                                    <label>{t("manage.admins.name", lang)}</label>
                                    <input type="text" value={editAdminName} onChange={e => setEditAdminName(e.target.value)} />
                                </div>
                            </div>

                            <label style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8, display: "block" }}>{t("manage.admins.rightsTitle", lang)}</label>
                            <div className="rights-chips" style={{ marginBottom: 20 }}>
                                {allRights.map(right => (
                                    <button key={right}
                                        className={`right-chip ${editAdminRights.includes(right) ? 'active' : ''}`}
                                        onClick={() => {
                                            if (editAdminRights.includes(right)) {
                                                setEditAdminRights(prev => prev.filter(r => r !== right))
                                            } else {
                                                setEditAdminRights(prev => [...prev, right])
                                            }
                                        }}>
                                        {rightLabel(right, lang)}
                                    </button>
                                ))}
                            </div>

                            <button className="apply-filter-btn" onClick={updateAdmin} disabled={loading || !editAdminName}>
                                {loading ? <Loader2 className="spin" /> : t("manage.admins.saveChanges", lang)}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
