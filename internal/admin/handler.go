package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"lv-tradepl/internal/depositmethods"

	"lv-tradepl/internal/httputil"

	"github.com/go-chi/chi/v5"
)

// Handler handles admin authentication
type Handler struct {
	pool       *pgxpool.Pool
	jwtSecret  []byte
	tokenStore *TokenStore
	updater    *UpdaterManager
}

const (
	reviewDispatchNotifyChannel = "review_dispatch"
	reviewAccessSyncPayload     = "access_sync:panel_admins"
)

// NewHandler creates a new admin handler
func NewHandler(pool *pgxpool.Pool, jwtSecret string) *Handler {
	return &Handler{
		pool:       pool,
		jwtSecret:  []byte(jwtSecret),
		tokenStore: NewTokenStore(pool),
	}
}

func (h *Handler) SetUpdater(updater *UpdaterManager) {
	h.updater = updater
}

func (h *Handler) notifyPanelAdminsAccessChanged() {
	if h.pool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, err := h.pool.Exec(ctx, `SELECT pg_notify($1, $2)`, reviewDispatchNotifyChannel, reviewAccessSyncPayload); err != nil {
		log.Printf("[admin] failed to notify panel-admin access sync: %v", err)
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
			margin_call_level_pct, stop_out_level_pct, unlimited_effective_leverage,
			signup_bonus_total_limit, signup_bonus_amount,
			real_deposit_min_usd, real_deposit_max_usd, usd_to_uzs_rate, real_deposit_review_minutes,
			telegram_deposit_chat_id,
			kyc_bonus_amount, kyc_review_eta_hours, telegram_kyc_chat_id,
			spread_calm_max_add, spread_spike_threshold, spread_spike_max_add,
			spread_news_pre_mult, spread_news_post_mult,
			spread_news_live_low_mult, spread_news_live_medium_mult, spread_news_live_high_mult,
			spread_dynamic_cap_mult, spread_smoothing_alpha
		)
		VALUES (1, 200, 100, 50000, 60, 20, 3000, 700, 10, 10, 1000, 13000, 120, '', 50, 8, '', 0.12, 0.60, 0.20, 1.08, 1.12, 1.20, 1.35, 1.55, 1.75, 0.18)
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
		SignupBonusTotalLimit   int    `json:"signup_bonus_total_limit"`
		SignupBonusAmount       string `json:"signup_bonus_amount"`
		RealDepositMinUSD       string `json:"real_deposit_min_usd"`
		RealDepositMaxUSD       string `json:"real_deposit_max_usd"`
		USDToUZSRate            string `json:"usd_to_uzs_rate"`
		RealDepositReviewMinute int    `json:"real_deposit_review_minutes"`
		TelegramDepositChatID   string `json:"telegram_deposit_chat_id"`
		KYCBonusAmount          string `json:"kyc_bonus_amount"`
		KYCReviewETAHours       int    `json:"kyc_review_eta_hours"`
		TelegramKYCChatID       string `json:"telegram_kyc_chat_id"`
		SpreadCalmMaxAdd        string `json:"spread_calm_max_add"`
		SpreadSpikeThreshold    string `json:"spread_spike_threshold"`
		SpreadSpikeMaxAdd       string `json:"spread_spike_max_add"`
		SpreadNewsPreMult       string `json:"spread_news_pre_mult"`
		SpreadNewsPostMult      string `json:"spread_news_post_mult"`
		SpreadNewsLiveLowMult   string `json:"spread_news_live_low_mult"`
		SpreadNewsLiveMediumMul string `json:"spread_news_live_medium_mult"`
		SpreadNewsLiveHighMult  string `json:"spread_news_live_high_mult"`
		SpreadDynamicCapMult    string `json:"spread_dynamic_cap_mult"`
		SpreadSmoothingAlpha    string `json:"spread_smoothing_alpha"`
	}
	err = h.pool.QueryRow(r.Context(), `
		SELECT
			trc.max_open_positions,
			trc.max_order_lots::text,
			trc.max_order_notional_usd::text,
			trc.margin_call_level_pct::text,
			trc.stop_out_level_pct::text,
			trc.unlimited_effective_leverage,
			COALESCE((to_jsonb(trc)->>'signup_bonus_total_limit')::int, 700),
			COALESCE((to_jsonb(trc)->>'signup_bonus_amount')::numeric, 10)::text,
			COALESCE((to_jsonb(trc)->>'real_deposit_min_usd')::numeric, 10)::text,
			COALESCE((to_jsonb(trc)->>'real_deposit_max_usd')::numeric, 1000)::text,
			COALESCE((to_jsonb(trc)->>'usd_to_uzs_rate')::numeric, 13000)::text,
			COALESCE((to_jsonb(trc)->>'real_deposit_review_minutes')::int, 120),
			COALESCE((to_jsonb(trc)->>'telegram_deposit_chat_id')::text, ''),
			COALESCE((to_jsonb(trc)->>'kyc_bonus_amount')::numeric, 50)::text,
			COALESCE((to_jsonb(trc)->>'kyc_review_eta_hours')::int, 8),
			COALESCE((to_jsonb(trc)->>'telegram_kyc_chat_id')::text, ''),
			COALESCE((to_jsonb(trc)->>'spread_calm_max_add')::numeric, 0.12)::text,
			COALESCE((to_jsonb(trc)->>'spread_spike_threshold')::numeric, 0.60)::text,
			COALESCE((to_jsonb(trc)->>'spread_spike_max_add')::numeric, 0.20)::text,
			COALESCE((to_jsonb(trc)->>'spread_news_pre_mult')::numeric, 1.08)::text,
			COALESCE((to_jsonb(trc)->>'spread_news_post_mult')::numeric, 1.12)::text,
			COALESCE((to_jsonb(trc)->>'spread_news_live_low_mult')::numeric, 1.20)::text,
			COALESCE((to_jsonb(trc)->>'spread_news_live_medium_mult')::numeric, 1.35)::text,
			COALESCE((to_jsonb(trc)->>'spread_news_live_high_mult')::numeric, 1.55)::text,
			COALESCE((to_jsonb(trc)->>'spread_dynamic_cap_mult')::numeric, 1.75)::text,
			COALESCE((to_jsonb(trc)->>'spread_smoothing_alpha')::numeric, 0.18)::text
		FROM trading_risk_config trc
		WHERE trc.id = 1
	`).Scan(
		&res.MaxOpenPositions, &res.MaxOrderLots, &res.MaxOrderNotionalUSD,
		&res.MarginCallLevelPercent, &res.StopOutLevelPercent, &res.UnlimitedEffectiveLevel,
		&res.SignupBonusTotalLimit, &res.SignupBonusAmount,
		&res.RealDepositMinUSD, &res.RealDepositMaxUSD, &res.USDToUZSRate, &res.RealDepositReviewMinute, &res.TelegramDepositChatID,
		&res.KYCBonusAmount, &res.KYCReviewETAHours, &res.TelegramKYCChatID,
		&res.SpreadCalmMaxAdd, &res.SpreadSpikeThreshold, &res.SpreadSpikeMaxAdd,
		&res.SpreadNewsPreMult, &res.SpreadNewsPostMult, &res.SpreadNewsLiveLowMult, &res.SpreadNewsLiveMediumMul, &res.SpreadNewsLiveHighMult,
		&res.SpreadDynamicCapMult, &res.SpreadSmoothingAlpha,
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
		SignupBonusTotalLimit   int    `json:"signup_bonus_total_limit"`
		SignupBonusAmount       string `json:"signup_bonus_amount"`
		RealDepositMinUSD       string `json:"real_deposit_min_usd"`
		RealDepositMaxUSD       string `json:"real_deposit_max_usd"`
		USDToUZSRate            string `json:"usd_to_uzs_rate"`
		RealDepositReviewMinute int    `json:"real_deposit_review_minutes"`
		TelegramDepositChatID   string `json:"telegram_deposit_chat_id"`
		KYCBonusAmount          string `json:"kyc_bonus_amount"`
		KYCReviewETAHours       int    `json:"kyc_review_eta_hours"`
		TelegramKYCChatID       string `json:"telegram_kyc_chat_id"`
		SpreadCalmMaxAdd        string `json:"spread_calm_max_add"`
		SpreadSpikeThreshold    string `json:"spread_spike_threshold"`
		SpreadSpikeMaxAdd       string `json:"spread_spike_max_add"`
		SpreadNewsPreMult       string `json:"spread_news_pre_mult"`
		SpreadNewsPostMult      string `json:"spread_news_post_mult"`
		SpreadNewsLiveLowMult   string `json:"spread_news_live_low_mult"`
		SpreadNewsLiveMediumMul string `json:"spread_news_live_medium_mult"`
		SpreadNewsLiveHighMult  string `json:"spread_news_live_high_mult"`
		SpreadDynamicCapMult    string `json:"spread_dynamic_cap_mult"`
		SpreadSmoothingAlpha    string `json:"spread_smoothing_alpha"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}

	if req.MaxOpenPositions <= 0 || req.UnlimitedEffectiveLevel <= 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "max_open_positions and unlimited_effective_leverage must be > 0"})
		return
	}
	if req.SignupBonusTotalLimit <= 0 || req.RealDepositReviewMinute <= 0 || req.KYCReviewETAHours <= 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "signup_bonus_total_limit, real_deposit_review_minutes and kyc_review_eta_hours must be > 0"})
		return
	}
	if !isPositiveNumeric(req.MaxOrderLots) ||
		!isPositiveNumeric(req.MaxOrderNotionalUSD) ||
		!isPositiveNumeric(req.MarginCallLevelPercent) ||
		!isPositiveNumeric(req.StopOutLevelPercent) ||
		!isPositiveNumeric(req.SignupBonusAmount) ||
		!isPositiveNumeric(req.RealDepositMinUSD) ||
		!isPositiveNumeric(req.RealDepositMaxUSD) ||
		!isPositiveNumeric(req.USDToUZSRate) ||
		!isPositiveNumeric(req.KYCBonusAmount) ||
		!isPositiveNumeric(req.SpreadNewsPreMult) ||
		!isPositiveNumeric(req.SpreadNewsPostMult) ||
		!isPositiveNumeric(req.SpreadNewsLiveLowMult) ||
		!isPositiveNumeric(req.SpreadNewsLiveMediumMul) ||
		!isPositiveNumeric(req.SpreadNewsLiveHighMult) ||
		!isPositiveNumeric(req.SpreadDynamicCapMult) ||
		!isPositiveNumeric(req.SpreadSmoothingAlpha) ||
		!isNonNegativeNumeric(req.SpreadCalmMaxAdd) ||
		!isNonNegativeNumeric(req.SpreadSpikeThreshold) ||
		!isNonNegativeNumeric(req.SpreadSpikeMaxAdd) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "numeric fields must be positive numbers"})
		return
	}
	minDep, _ := strconv.ParseFloat(strings.TrimSpace(req.RealDepositMinUSD), 64)
	maxDep, _ := strconv.ParseFloat(strings.TrimSpace(req.RealDepositMaxUSD), 64)
	if maxDep < minDep {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "real_deposit_max_usd must be >= real_deposit_min_usd"})
		return
	}
	spreadCap, _ := strconv.ParseFloat(strings.TrimSpace(req.SpreadDynamicCapMult), 64)
	spreadPre, _ := strconv.ParseFloat(strings.TrimSpace(req.SpreadNewsPreMult), 64)
	spreadPost, _ := strconv.ParseFloat(strings.TrimSpace(req.SpreadNewsPostMult), 64)
	spreadLow, _ := strconv.ParseFloat(strings.TrimSpace(req.SpreadNewsLiveLowMult), 64)
	spreadMed, _ := strconv.ParseFloat(strings.TrimSpace(req.SpreadNewsLiveMediumMul), 64)
	spreadHigh, _ := strconv.ParseFloat(strings.TrimSpace(req.SpreadNewsLiveHighMult), 64)
	smoothingAlpha, _ := strconv.ParseFloat(strings.TrimSpace(req.SpreadSmoothingAlpha), 64)
	if spreadCap < 1 || spreadPre < 1 || spreadPost < 1 || spreadLow < 1 || spreadMed < 1 || spreadHigh < 1 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "spread multipliers must be >= 1"})
		return
	}
	if spreadCap < spreadPre || spreadCap < spreadPost || spreadCap < spreadLow || spreadCap < spreadMed || spreadCap < spreadHigh {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "spread_dynamic_cap_mult must be >= all news multipliers"})
		return
	}
	if smoothingAlpha <= 0 || smoothingAlpha > 1 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "spread_smoothing_alpha must be in (0, 1]"})
		return
	}
	req.TelegramDepositChatID = strings.TrimSpace(req.TelegramDepositChatID)
	req.TelegramKYCChatID = strings.TrimSpace(req.TelegramKYCChatID)

	_, err := h.pool.Exec(r.Context(), `
		INSERT INTO trading_risk_config (
			id, max_open_positions, max_order_lots, max_order_notional_usd,
			margin_call_level_pct, stop_out_level_pct, unlimited_effective_leverage,
			signup_bonus_total_limit, signup_bonus_amount,
			real_deposit_min_usd, real_deposit_max_usd, usd_to_uzs_rate, real_deposit_review_minutes,
			telegram_deposit_chat_id,
			kyc_bonus_amount, kyc_review_eta_hours, telegram_kyc_chat_id,
			spread_calm_max_add, spread_spike_threshold, spread_spike_max_add,
			spread_news_pre_mult, spread_news_post_mult,
			spread_news_live_low_mult, spread_news_live_medium_mult, spread_news_live_high_mult,
			spread_dynamic_cap_mult, spread_smoothing_alpha,
			updated_at
		)
		VALUES (1, $1, $2::numeric, $3::numeric, $4::numeric, $5::numeric, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12, $13, $14::numeric, $15, $16, $17::numeric, $18::numeric, $19::numeric, $20::numeric, $21::numeric, $22::numeric, $23::numeric, $24::numeric, $25::numeric, $26::numeric, NOW())
		ON CONFLICT (id) DO UPDATE
		SET max_open_positions = EXCLUDED.max_open_positions,
			max_order_lots = EXCLUDED.max_order_lots,
			max_order_notional_usd = EXCLUDED.max_order_notional_usd,
			margin_call_level_pct = EXCLUDED.margin_call_level_pct,
			stop_out_level_pct = EXCLUDED.stop_out_level_pct,
			unlimited_effective_leverage = EXCLUDED.unlimited_effective_leverage,
			signup_bonus_total_limit = EXCLUDED.signup_bonus_total_limit,
			signup_bonus_amount = EXCLUDED.signup_bonus_amount,
			real_deposit_min_usd = EXCLUDED.real_deposit_min_usd,
			real_deposit_max_usd = EXCLUDED.real_deposit_max_usd,
			usd_to_uzs_rate = EXCLUDED.usd_to_uzs_rate,
			real_deposit_review_minutes = EXCLUDED.real_deposit_review_minutes,
			telegram_deposit_chat_id = EXCLUDED.telegram_deposit_chat_id,
			kyc_bonus_amount = EXCLUDED.kyc_bonus_amount,
			kyc_review_eta_hours = EXCLUDED.kyc_review_eta_hours,
			telegram_kyc_chat_id = EXCLUDED.telegram_kyc_chat_id,
			spread_calm_max_add = EXCLUDED.spread_calm_max_add,
			spread_spike_threshold = EXCLUDED.spread_spike_threshold,
			spread_spike_max_add = EXCLUDED.spread_spike_max_add,
			spread_news_pre_mult = EXCLUDED.spread_news_pre_mult,
			spread_news_post_mult = EXCLUDED.spread_news_post_mult,
			spread_news_live_low_mult = EXCLUDED.spread_news_live_low_mult,
			spread_news_live_medium_mult = EXCLUDED.spread_news_live_medium_mult,
			spread_news_live_high_mult = EXCLUDED.spread_news_live_high_mult,
			spread_dynamic_cap_mult = EXCLUDED.spread_dynamic_cap_mult,
			spread_smoothing_alpha = EXCLUDED.spread_smoothing_alpha,
			updated_at = NOW()
	`, req.MaxOpenPositions, req.MaxOrderLots, req.MaxOrderNotionalUSD, req.MarginCallLevelPercent, req.StopOutLevelPercent, req.UnlimitedEffectiveLevel, req.SignupBonusTotalLimit, req.SignupBonusAmount, req.RealDepositMinUSD, req.RealDepositMaxUSD, req.USDToUZSRate, req.RealDepositReviewMinute, req.TelegramDepositChatID, req.KYCBonusAmount, req.KYCReviewETAHours, req.TelegramKYCChatID, req.SpreadCalmMaxAdd, req.SpreadSpikeThreshold, req.SpreadSpikeMaxAdd, req.SpreadNewsPreMult, req.SpreadNewsPostMult, req.SpreadNewsLiveLowMult, req.SpreadNewsLiveMediumMul, req.SpreadNewsLiveHighMult, req.SpreadDynamicCapMult, req.SpreadSmoothingAlpha)
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

func (h *Handler) GetDepositMethods(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	methods, err := depositmethods.Load(r.Context(), h.pool)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"methods": methods,
	})
}

func (h *Handler) UpdateDepositMethods(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	var req struct {
		Methods []depositmethods.Method `json:"methods"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}
	methods, err := depositmethods.Save(r.Context(), h.pool, req.Methods)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"methods": methods,
	})
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

	h.notifyPanelAdminsAccessChanged()
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

	h.notifyPanelAdminsAccessChanged()
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

	h.notifyPanelAdminsAccessChanged()
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ClearKYCBlock removes KYC cooldown/permanent ban for a user (owner only).
func (h *Handler) ClearKYCBlock(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	userID := strings.TrimSpace(chi.URLParam(r, "userID"))
	if userID == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "userID is required"})
		return
	}

	_, err := h.pool.Exec(r.Context(), `
		INSERT INTO kyc_user_states (user_id, failed_attempts, blocked_until, permanent_blocked, updated_at)
		VALUES ($1::uuid, 0, NULL, FALSE, NOW())
		ON CONFLICT (user_id)
		DO UPDATE
		SET failed_attempts = 0,
			blocked_until = NULL,
			permanent_blocked = FALSE,
			updated_at = NOW()
	`, userID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ResetDatabaseData removes user/trading runtime data from DB (owner only).
func (h *Handler) ResetDatabaseData(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	var req struct {
		Confirm string `json:"confirm"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}
	if strings.TrimSpace(req.Confirm) != adminDBResetConfirmPhrase {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid confirmation phrase"})
		return
	}

	username, _ := r.Context().Value(adminUsernameKey).(string)
	if strings.TrimSpace(username) == "" {
		username = "unknown"
	}
	role, _ := r.Context().Value(adminRoleKey).(string)
	if strings.TrimSpace(role) == "" {
		role = "owner"
	}

	tx, err := h.pool.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "failed to start transaction"})
		return
	}
	defer tx.Rollback(r.Context())

	if err := ensureAdminAuditTable(r.Context(), tx); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "failed to ensure audit log table"})
		return
	}

	tables, err := listAdminResetTables(r.Context(), tx)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "failed to prepare reset table list"})
		return
	}
	if len(tables) > 0 {
		var quoted []string
		for _, table := range tables {
			quoted = append(quoted, quoteIdentifier(table))
		}
		if _, err := tx.Exec(r.Context(), fmt.Sprintf("TRUNCATE TABLE %s RESTART IDENTITY CASCADE", strings.Join(quoted, ", "))); err != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "failed to reset database data"})
			return
		}
	}

	details, _ := json.Marshal(map[string]interface{}{
		"table_count": len(tables),
		"tables":      tables,
	})

	var logID int64
	if err := tx.QueryRow(r.Context(), `
		INSERT INTO admin_audit_logs (action, actor_username, actor_role, details, created_at)
		VALUES ($1, $2, $3, $4::jsonb, NOW())
		RETURNING id
	`, "db_reset", username, role, string(details)).Scan(&logID); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "failed to write reset audit log"})
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "failed to finalize reset"})
		return
	}

	log.Printf("[admin-db-reset] actor=%s role=%s tables=%d log_id=%d", username, role, len(tables), logID)
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":         "ok",
		"log_id":         logID,
		"deleted_tables": tables,
		"deleted_count":  len(tables),
	})
}

func (h *Handler) GetSystemUpdater(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	if h.updater == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrorResponse{Error: "system updater is not configured"})
		return
	}
	status, err := h.updater.Status(r.Context())
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, status)
}

func (h *Handler) CheckSystemUpdater(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	if h.updater == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrorResponse{Error: "system updater is not configured"})
		return
	}
	status, err := h.updater.CheckNow(r.Context())
	if err != nil {
		if errors.Is(err, ErrUpdaterBusy) {
			httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{Error: err.Error()})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, status)
}

func (h *Handler) RunSystemUpdater(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	if h.updater == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrorResponse{Error: "system updater is not configured"})
		return
	}
	status, err := h.updater.UpdateNow(r.Context())
	if err != nil {
		if errors.Is(err, ErrUpdaterBusy) {
			httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{Error: err.Error()})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, status)
}

func (h *Handler) UpdateSystemUpdaterConfig(w http.ResponseWriter, r *http.Request) {
	if !requireOwner(w, r) {
		return
	}
	if h.updater == nil {
		httputil.WriteJSON(w, http.StatusServiceUnavailable, httputil.ErrorResponse{Error: "system updater is not configured"})
		return
	}
	var req UpdaterConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}
	status, err := h.updater.UpdateConfig(r.Context(), req)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, status)
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

func isNonNegativeNumeric(raw string) bool {
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return err == nil && v >= 0
}

type contextKey string

const adminUsernameKey contextKey = "admin_username"
const adminRoleKey contextKey = "admin_role"
const adminRightsKey contextKey = "admin_rights"

var allAdminRights = []string{"sessions", "trend", "events", "volatility", "kyc_review", "deposit_review", "support_review"}

func UsernameFromContext(ctx context.Context) string {
	username, _ := ctx.Value(adminUsernameKey).(string)
	return strings.TrimSpace(username)
}

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

func RequireOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !requireOwner(w, r) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

const adminDBResetConfirmPhrase = "DELETE ALL DATA"

var adminDBResetExcludedTables = []string{
	"admin_users",
	"panel_admins",
	"access_tokens",
	"assets",
	"trading_pairs",
	"account_plans",
	"trading_risk_config",
	"trading_pair_contract_specs",
	"session_configs",
	"session_schedule",
	"admin_settings",
	"volatility_settings",
	"system_settings",
	"economic_news_events",
	"admin_audit_logs",
}

func ensureAdminAuditTable(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS admin_audit_logs (
			id BIGSERIAL PRIMARY KEY,
			action TEXT NOT NULL,
			actor_username TEXT NOT NULL,
			actor_role TEXT NOT NULL,
			details JSONB NOT NULL DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	return err
}

func listAdminResetTables(ctx context.Context, tx pgx.Tx) ([]string, error) {
	rows, err := tx.Query(ctx, `
		SELECT tablename
		FROM pg_tables
		WHERE schemaname = 'public'
		  AND NOT (tablename = ANY($1))
		ORDER BY tablename ASC
	`, adminDBResetExcludedTables)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0, 32)
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return nil, err
		}
		table = strings.TrimSpace(table)
		if table == "" {
			continue
		}
		out = append(out, table)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func quoteIdentifier(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}
