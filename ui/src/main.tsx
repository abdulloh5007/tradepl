import { useState, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import App from "./App"
import ManagePanel from "./pages/Manage/ManagePanel"
import NotFoundPage from "./pages/NotFound/NotFoundPage"
import { storedTheme, storedBaseUrl } from "./utils/cookies"
import "./styles.css"

function RootApp() {
  const [theme, setTheme] = useState<"dark" | "light">(storedTheme)
  const baseUrl = (import.meta.env.VITE_API_URL || storedBaseUrl()).replace(/\/+$/, "")

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    localStorage.setItem("theme", theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(t => t === "dark" ? "light" : "dark")
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/manage-panel" element={
          <ManagePanel
            baseUrl={baseUrl}
            theme={theme}
            onThemeToggle={toggleTheme}
          />
        } />
        <Route path="/" element={<App />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(<RootApp />)
}
