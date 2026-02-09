package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"lv-tradepl/internal/httputil"

	"github.com/go-chi/chi/v5"
)

// Handler handles admin authentication
type Handler struct {
	pool       *pgxpool.Pool
	jwtSecret  []byte
	tokenStore *TokenStore
}

// NewHandler creates a new admin handler
func NewHandler(pool *pgxpool.Pool, jwtSecret string) *Handler {
	return &Handler{
		pool:       pool,
		jwtSecret:  []byte(jwtSecret),
		tokenStore: NewTokenStore(pool),
	}
}

// Login handles admin login
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}

	// Get user from DB
	var id int
	var passwordHash string
	err := h.pool.QueryRow(r.Context(),
		"SELECT id, password_hash FROM admin_users WHERE username = $1", req.Username,
	).Scan(&id, &passwordHash)
	if err != nil {
		httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid credentials"})
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid credentials"})
		return
	}

	// Generate JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":      id,
		"username": req.Username,
		"role":     "admin",
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
	})
	tokenStr, err := token.SignedString(h.jwtSecret)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "token generation failed"})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]string{
		"token":    tokenStr,
		"username": req.Username,
	})
}

// Me returns admin info
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	username := r.Context().Value(adminUsernameKey).(string)
	role, _ := r.Context().Value(adminRoleKey).(string)
	if role == "" {
		role = "admin"
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{
		"username": username,
		"role":     role,
	})
}

func (h *Handler) GetTradingRisk(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}

	_, err := h.pool.Exec(r.Context(), `
		INSERT INTO trading_risk_config (
			id, max_open_positions, max_order_lots, max_order_notional_usd,
			margin_call_level_pct, stop_out_level_pct, unlimited_effective_leverage
		)
		VALUES (1, 200, 100, 50000, 60, 20, 3000)
		ON CONFLICT (id) DO NOTHING
	`)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var res struct {
		MaxOpenPositions        int    `json:"max_open_positions"`
		MaxOrderLots            string `json:"max_order_lots"`
		MaxOrderNotionalUSD     string `json:"max_order_notional_usd"`
		MarginCallLevelPercent  string `json:"margin_call_level_pct"`
		StopOutLevelPercent     string `json:"stop_out_level_pct"`
		UnlimitedEffectiveLevel int    `json:"unlimited_effective_leverage"`
	}
	err = h.pool.QueryRow(r.Context(), `
		SELECT max_open_positions, max_order_lots, max_order_notional_usd, margin_call_level_pct, stop_out_level_pct, unlimited_effective_leverage
		FROM trading_risk_config
		WHERE id = 1
	`).Scan(
		&res.MaxOpenPositions, &res.MaxOrderLots, &res.MaxOrderNotionalUSD,
		&res.MarginCallLevelPercent, &res.StopOutLevelPercent, &res.UnlimitedEffectiveLevel,
	)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, res)
}

func (h *Handler) UpdateTradingRisk(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}

	var req struct {
		MaxOpenPositions        int    `json:"max_open_positions"`
		MaxOrderLots            string `json:"max_order_lots"`
		MaxOrderNotionalUSD     string `json:"max_order_notional_usd"`
		MarginCallLevelPercent  string `json:"margin_call_level_pct"`
		StopOutLevelPercent     string `json:"stop_out_level_pct"`
		UnlimitedEffectiveLevel int    `json:"unlimited_effective_leverage"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}

	if req.MaxOpenPositions <= 0 || req.UnlimitedEffectiveLevel <= 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "max_open_positions and unlimited_effective_leverage must be > 0"})
		return
	}
	if !isPositiveNumeric(req.MaxOrderLots) || !isPositiveNumeric(req.MaxOrderNotionalUSD) || !isPositiveNumeric(req.MarginCallLevelPercent) || !isPositiveNumeric(req.StopOutLevelPercent) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "numeric fields must be positive numbers"})
		return
	}

	_, err := h.pool.Exec(r.Context(), `
		INSERT INTO trading_risk_config (
			id, max_open_positions, max_order_lots, max_order_notional_usd,
			margin_call_level_pct, stop_out_level_pct, unlimited_effective_leverage, updated_at
		)
		VALUES (1, $1, $2::numeric, $3::numeric, $4::numeric, $5::numeric, $6, NOW())
		ON CONFLICT (id) DO UPDATE
		SET max_open_positions = EXCLUDED.max_open_positions,
			max_order_lots = EXCLUDED.max_order_lots,
			max_order_notional_usd = EXCLUDED.max_order_notional_usd,
			margin_call_level_pct = EXCLUDED.margin_call_level_pct,
			stop_out_level_pct = EXCLUDED.stop_out_level_pct,
			unlimited_effective_leverage = EXCLUDED.unlimited_effective_leverage,
			updated_at = NOW()
	`, req.MaxOpenPositions, req.MaxOrderLots, req.MaxOrderNotionalUSD, req.MarginCallLevelPercent, req.StopOutLevelPercent, req.UnlimitedEffectiveLevel)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	h.GetTradingRisk(w, r)
}

func (h *Handler) GetTradingPairs(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}

	rows, err := h.pool.Query(r.Context(), `
		SELECT symbol, contract_size, lot_step, min_lot, max_lot, status
		FROM trading_pairs
		ORDER BY symbol ASC
	`)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	defer rows.Close()

	type pairSpec struct {
		Symbol       string `json:"symbol"`
		ContractSize string `json:"contract_size"`
		LotStep      string `json:"lot_step"`
		MinLot       string `json:"min_lot"`
		MaxLot       string `json:"max_lot"`
		Status       string `json:"status"`
	}
	out := make([]pairSpec, 0, 4)
	for rows.Next() {
		var p pairSpec
		if err := rows.Scan(&p.Symbol, &p.ContractSize, &p.LotStep, &p.MinLot, &p.MaxLot, &p.Status); err != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
			return
		}
		out = append(out, p)
	}

	httputil.WriteJSON(w, http.StatusOK, out)
}

func (h *Handler) UpdateTradingPair(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "symbol")))
	if symbol == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "symbol is required"})
		return
	}

	var req struct {
		ContractSize *string `json:"contract_size"`
		LotStep      *string `json:"lot_step"`
		MinLot       *string `json:"min_lot"`
		MaxLot       *string `json:"max_lot"`
		Status       *string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}

	if req.ContractSize != nil && !isPositiveNumeric(*req.ContractSize) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "contract_size must be positive"})
		return
	}
	if req.LotStep != nil && !isPositiveNumeric(*req.LotStep) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "lot_step must be positive"})
		return
	}
	if req.MinLot != nil && !isPositiveNumeric(*req.MinLot) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "min_lot must be positive"})
		return
	}
	if req.MaxLot != nil && !isPositiveNumeric(*req.MaxLot) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "max_lot must be positive"})
		return
	}

	var contractSize, lotStep, minLot, maxLot, status string
	if req.ContractSize != nil {
		contractSize = strings.TrimSpace(*req.ContractSize)
	}
	if req.LotStep != nil {
		lotStep = strings.TrimSpace(*req.LotStep)
	}
	if req.MinLot != nil {
		minLot = strings.TrimSpace(*req.MinLot)
	}
	if req.MaxLot != nil {
		maxLot = strings.TrimSpace(*req.MaxLot)
	}
	if req.Status != nil {
		status = strings.TrimSpace(*req.Status)
	}

	cmd, err := h.pool.Exec(r.Context(), `
		UPDATE trading_pairs
		SET contract_size = COALESCE(NULLIF($2, '')::numeric, contract_size),
			lot_step = COALESCE(NULLIF($3, '')::numeric, lot_step),
			min_lot = COALESCE(NULLIF($4, '')::numeric, min_lot),
			max_lot = COALESCE(NULLIF($5, '')::numeric, max_lot),
			status = COALESCE(NULLIF($6, ''), status)
		WHERE symbol = $1
	`, symbol, contractSize, lotStep, minLot, maxLot, status)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if cmd.RowsAffected() == 0 {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrorResponse{Error: "pair not found"})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *Handler) GetTradingPnLConfig(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}

	rows, err := h.pool.Query(r.Context(), `
		SELECT symbol, COALESCE(pnl_contract_size, contract_size)::text
		FROM trading_pairs
		ORDER BY symbol ASC
	`)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	defer rows.Close()

	type rowOut struct {
		Symbol          string `json:"symbol"`
		PnLContractSize string `json:"pnl_contract_size"`
	}
	out := make([]rowOut, 0, 4)
	for rows.Next() {
		var item rowOut
		if err := rows.Scan(&item.Symbol, &item.PnLContractSize); err != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
			return
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, out)
}

func (h *Handler) UpdateTradingPnLConfig(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "symbol")))
	if symbol == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "symbol is required"})
		return
	}

	var req struct {
		PnLContractSize string `json:"pnl_contract_size"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}
	req.PnLContractSize = strings.TrimSpace(req.PnLContractSize)
	if !isPositiveNumeric(req.PnLContractSize) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "pnl_contract_size must be positive"})
		return
	}

	cmd, err := h.pool.Exec(r.Context(), `
		UPDATE trading_pairs
		SET pnl_contract_size = $2::numeric
		WHERE symbol = $1
	`, symbol, req.PnLContractSize)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if cmd.RowsAffected() == 0 {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrorResponse{Error: "pair not found"})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// ValidateToken validates an access token from Telegram bot
func (h *Handler) ValidateToken(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "token required"})
		return
	}

	accessToken, err := h.tokenStore.ValidateToken(r.Context(), token)
	if err != nil {
		httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid or expired token"})
		return
	}

	// Get rights as array
	var rightsArr []string
	if accessToken.TokenType == "admin" {
		admin, err := h.tokenStore.GetPanelAdminByTelegramID(r.Context(), accessToken.TelegramID)
		if err != nil {
			httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "admin not found"})
			return
		}
		for k, v := range admin.Rights {
			if v {
				rightsArr = append(rightsArr, k)
			}
		}
	} else {
		// Owner has all rights
		rightsArr = append([]string{}, allAdminRights...)
	}

	// Generate admin JWT token for API requests
	jwtToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":    accessToken.TelegramID,
		"role":   accessToken.TokenType,
		"rights": rightsArr,
		"exp":    accessToken.ExpiresAt.Unix(),
	})
	adminToken, err := jwtToken.SignedString(h.jwtSecret)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "token generation failed"})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"valid":       true,
		"role":        accessToken.TokenType,
		"telegram_id": accessToken.TelegramID,
		"expires_at":  accessToken.ExpiresAt,
		"rights":      rightsArr,
		"admin_token": adminToken,
	})
}

// GetPanelAdmins returns all panel admins (owner only)
func (h *Handler) GetPanelAdmins(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	admins, err := h.tokenStore.GetPanelAdmins(r.Context())
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if admins == nil {
		admins = []PanelAdmin{}
	}
	httputil.WriteJSON(w, http.StatusOK, admins)
}

// CreatePanelAdmin creates a new panel admin
func (h *Handler) CreatePanelAdmin(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	var req struct {
		TelegramID int64           `json:"telegram_id"`
		Name       string          `json:"name"`
		Rights     map[string]bool `json:"rights"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}

	if req.TelegramID == 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "telegram_id required"})
		return
	}

	admin, err := h.tokenStore.CreatePanelAdmin(r.Context(), req.TelegramID, req.Name, req.Rights)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusCreated, admin)
}

// UpdatePanelAdmin updates a panel admin
func (h *Handler) UpdatePanelAdmin(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid id"})
		return
	}

	var req struct {
		Name   string          `json:"name"`
		Rights map[string]bool `json:"rights"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}

	admin, err := h.tokenStore.UpdatePanelAdmin(r.Context(), id, req.Name, req.Rights)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, admin)
}

// DeletePanelAdmin deletes a panel admin
func (h *Handler) DeletePanelAdmin(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid id"})
		return
	}

	if err := h.tokenStore.DeletePanelAdmin(r.Context(), id); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// AdminAuthMiddleware validates admin JWT token
func AdminAuthMiddleware(jwtSecret string) func(http.Handler) http.Handler {
	secret := []byte(jwtSecret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "missing authorization"})
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || parts[0] != "Bearer" {
				httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid authorization format"})
				return
			}

			token, err := jwt.Parse(parts[1], func(token *jwt.Token) (interface{}, error) {
				return secret, nil
			})
			if err != nil || !token.Valid {
				httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "invalid token"})
				return
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid claims"})
				return
			}

			role, _ := claims["role"].(string)
			// Accept both "admin" (old login) and "owner"/"admin" (new Telegram token)
			if role != "admin" && role != "owner" {
				httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "admin access required"})
				return
			}

			// Get username or telegram_id for context
			username, _ := claims["username"].(string)
			if username == "" {
				// For Telegram tokens, use role as identifier
				username = role
			}
			rightsMap := map[string]bool{}
			if rightsRaw, ok := claims["rights"].([]interface{}); ok {
				for _, raw := range rightsRaw {
					if right, ok := raw.(string); ok && right != "" {
						rightsMap[right] = true
					}
				}
			}
			// Backward compatibility for legacy /admin/login tokens without rights claim.
			if role == "admin" && len(rightsMap) == 0 {
				if usernameClaim, ok := claims["username"].(string); ok && strings.TrimSpace(usernameClaim) != "" {
					for _, right := range allAdminRights {
						rightsMap[right] = true
					}
				}
			}
			if role == "owner" {
				for _, right := range allAdminRights {
					rightsMap[right] = true
				}
			}
			ctx := context.WithValue(r.Context(), adminUsernameKey, username)
			ctx = context.WithValue(ctx, adminRoleKey, role)
			ctx = context.WithValue(ctx, adminRightsKey, rightsMap)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func isPositiveNumeric(raw string) bool {
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return err == nil && v > 0
}

type contextKey string

const adminUsernameKey contextKey = "admin_username"
const adminRoleKey contextKey = "admin_role"
const adminRightsKey contextKey = "admin_rights"

var allAdminRights = []string{"sessions", "trend", "events", "volatility"}

func requireOwner(w http.ResponseWriter, r *http.Request) bool {
	role, _ := r.Context().Value(adminRoleKey).(string)
	if role != "owner" {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "owner access required"})
		return false
	}
	return true
}

func RequireRight(right string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, _ := r.Context().Value(adminRoleKey).(string)
			if role == "owner" {
				next.ServeHTTP(w, r)
				return
			}
			rights, _ := r.Context().Value(adminRightsKey).(map[string]bool)
			if rights == nil || !rights[right] {
				httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "insufficient rights"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
