import { useNavigate } from "react-router-dom"
import { Home, AlertTriangle } from "lucide-react"

export const NotFoundPage = () => {
    const navigate = useNavigate()

    return (
        <div className="not-found-page">
            <div className="not-found-content">
                <AlertTriangle size={64} className="not-found-icon" />
                <h1>404</h1>
                <p>Page not found</p>
                <button className="not-found-btn" onClick={() => navigate("/")}>
                    <Home size={18} />
                    Go Home
                </button>
            </div>
        </div>
    )
}
