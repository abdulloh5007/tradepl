import { useState, useEffect } from "react"
import { Shield, Plus, User, Trash2, Edit2, X, Loader2 } from "lucide-react"
import { PanelAdmin } from "./types"

interface PanelAdminsProps {
    baseUrl: string
    headers: any
    userRole: string | null
}

export default function PanelAdmins({ baseUrl, headers, userRole }: PanelAdminsProps) {
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

    const allRights = ["sessions", "volatility", "trend", "events"]

    useEffect(() => {
        if (userRole === "owner") {
            fetchAdmins()
        }
    }, [userRole])

    const fetchAdmins = async () => {
        try {
            const res = await fetch(`${baseUrl}/v1/admin/panel-admins`, { headers })
            if (res.ok) setPanelAdmins(await res.json())
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
            setError("Failed to create admin")
        } finally {
            setLoading(false)
        }
    }

    const deleteAdmin = async (id: number) => {
        if (!confirm("Delete this admin?")) return
        setLoading(true)
        try {
            await fetch(`${baseUrl}/v1/admin/panel-admins/${id}`, { method: "DELETE", headers })
            fetchAdmins()
        } catch (e) { setError("Failed to delete admin") }
        finally { setLoading(false) }
    }

    const startEditing = (admin: any) => {
        setEditingAdmin(admin)
        setEditAdminName(admin.name)
        setEditAdminRights(Array.isArray(admin.rights) ? admin.rights : [])
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
            if (!res.ok) throw new Error("Failed to update admin")

            setEditingAdmin(null)
            fetchAdmins()
        } catch (e) {
            setError("Failed to update admin")
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
                <h2>Panel Administrators</h2>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="admin-form">
                <div className="admin-form-row">
                    <input type="number" value={newAdminTgId} onChange={e => setNewAdminTgId(e.target.value)} placeholder="Telegram ID" />
                    <input type="text" value={newAdminName} onChange={e => setNewAdminName(e.target.value)} placeholder="Admin Name" />
                </div>
                <div className="rights-chips">
                    {allRights.map(right => (
                        <button key={right}
                            className={`right-chip ${newAdminRights.includes(right) ? 'active' : ''}`}
                            onClick={() => toggleNewAdminRight(right)}>
                            {right.charAt(0).toUpperCase() + right.slice(1)}
                        </button>
                    ))}
                </div>
                <button className="add-event-btn" onClick={createAdmin} disabled={loading || !newAdminTgId || !newAdminName}>
                    {loading ? <Loader2 className="spin" /> : <Plus size={18} />}
                    <span>Add Admin</span>
                </button>
            </div>

            <div className="admins-list">
                {panelAdmins.length === 0 ? (
                    <div className="no-events">
                        <User size={24} />
                        <span>No admins yet</span>
                    </div>
                ) : panelAdmins.map(admin => (
                    <div key={admin.id} className="admin-item">
                        <div className="admin-info">
                            <User size={20} />
                            <div>
                                <span className="admin-name">{admin.name}</span>
                                <span className="admin-tg">ID: {admin.telegram_id}</span>
                            </div>
                        </div>
                        <div className="admin-rights">
                            {Array.isArray(admin.rights) && admin.rights.map(r => <span key={r} className="right-badge">{r}</span>)}
                        </div>
                        <div className="admin-actions">
                            <button className="edit-admin-btn" onClick={() => startEditing(admin)} style={{ marginRight: 8 }}>
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
                            <h3>Edit Admin</h3>
                            <button onClick={() => setEditingAdmin(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="filter-custom">
                            <div className="date-range-inputs">
                                <div className="date-input-group" style={{ gridColumn: "1 / -1" }}>
                                    <label>Name</label>
                                    <input type="text" value={editAdminName} onChange={e => setEditAdminName(e.target.value)} />
                                </div>
                            </div>

                            <label style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8, display: "block" }}>Rights</label>
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
                                        {right.charAt(0).toUpperCase() + right.slice(1)}
                                    </button>
                                ))}
                            </div>

                            <button className="apply-filter-btn" onClick={updateAdmin} disabled={loading || !editAdminName}>
                                {loading ? <Loader2 className="spin" /> : "Save Changes"}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
