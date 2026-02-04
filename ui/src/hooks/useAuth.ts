import { useState, useCallback } from "react"
import { setCookie, storedToken, storedBaseUrl } from "../utils/cookies"
import { normalizeBaseUrl } from "../utils/format"
import { createApiClient } from "../api"

export function useAuth() {
    const [baseUrl, setBaseUrl] = useState(storedBaseUrl() || "")
    const [token, setToken] = useState(storedToken())

    const api = createApiClient({ baseUrl: normalizeBaseUrl(baseUrl), token })

    const updateBaseUrl = useCallback((url: string) => {
        const normalized = normalizeBaseUrl(url)
        setBaseUrl(normalized)
        setCookie("lv_baseurl", normalized)
    }, [])

    const updateToken = useCallback((newToken: string) => {
        setToken(newToken)
        setCookie("lv_token", newToken)
    }, [])

    const logout = useCallback(() => {
        setToken("")
        setCookie("lv_token", "")
    }, [])

    const handleRegister = useCallback(async (email: string, password: string) => {
        const res = await api.register(email, password)
        updateToken(res.access_token)
        return res
    }, [api, updateToken])

    const handleLogin = useCallback(async (email: string, password: string) => {
        const res = await api.login(email, password)
        updateToken(res.access_token)
        return res
    }, [api, updateToken])

    return {
        baseUrl,
        token,
        api,
        updateBaseUrl,
        updateToken,
        logout,
        handleRegister,
        handleLogin
    }
}
