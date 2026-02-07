import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import App from "./App"
import ManagePanel from "./pages/ManagePanel"
import { NotFoundPage } from "./pages/NotFoundPage"
import { storedTheme } from "./utils/cookies"
import "./styles.css"

const root = document.getElementById("root")
if (root) {
  const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:8080"
  const theme = storedTheme()

  createRoot(root).render(
    <BrowserRouter>
      <Routes>
        <Route path="/manage-panel" element={
          <ManagePanel
            baseUrl={baseUrl}
            theme={theme}
            onThemeToggle={() => { }}
          />
        } />
        <Route path="/" element={<App />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

