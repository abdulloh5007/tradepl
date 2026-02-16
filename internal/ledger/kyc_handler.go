package ledger

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"lv-tradepl/internal/httputil"
)

const (
	maxKYCProofBytes       = 10 * 1024 * 1024
	kycRefPrefix           = "kyc_reward"
	kycRejectCooldownHours = 24
	kycRejectCooldownDays  = 7
)

type kycStatusResponse struct {
	State              string     `json:"state"`
	CanSubmit          bool       `json:"can_submit"`
	Message            string     `json:"message"`
	EligibleAccountID  string     `json:"eligible_account_id,omitempty"`
	BonusAmountUSD     string     `json:"bonus_amount_usd"`
	ReviewETAHours     int        `json:"review_eta_hours"`
	IsReviewConfigured bool       `json:"is_review_configured"`
	Claimed            bool       `json:"claimed"`
	FailedAttempts     int        `json:"failed_attempts"`
	PendingTicket      string     `json:"pending_ticket,omitempty"`
	PendingSince       *time.Time `json:"pending_since,omitempty"`
	PendingReviewDueAt *time.Time `json:"pending_review_due_at,omitempty"`
	BlockedUntil       *time.Time `json:"blocked_until,omitempty"`
	BlockedSeconds     int64      `json:"blocked_seconds,omitempty"`
	PermanentBlocked   bool       `json:"permanent_blocked"`
	LastRejectedAt     *time.Time `json:"last_rejected_at,omitempty"`
}

type kycRequestInput struct {
	DocumentType     string `json:"document_type"`
	FullName         string `json:"full_name"`
	DocumentNumber   string `json:"document_number"`
	ResidenceAddress string `json:"residence_address"`
	Notes            string `json:"notes"`
	ProofName        string `json:"proof_file_name"`
	ProofMime        string `json:"proof_mime_type"`
	ProofBase64      string `json:"proof_base64"`
}

type kycRequestResponse struct {
	RequestID      string    `json:"request_id"`
	Ticket         string    `json:"ticket"`
	Status         string    `json:"status"`
	ReviewDueAt    time.Time `json:"review_due_at"`
	BonusAmountUSD string    `json:"bonus_amount_usd"`
}

type kycUserState struct {
	FailedAttempts   int
	BlockedUntilRaw  pgtype.Timestamptz
	PermanentBlocked bool
	LastRejectedRaw  pgtype.Timestamptz
}

func (h *Handler) KYCStatus(w http.ResponseWriter, r *http.Request, userID string) {
	if h.accountSvc == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "account service unavailable"})
		return
	}
	if err := h.accountSvc.EnsureDefaultAccounts(r.Context(), userID); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	cfg, cfgErr := h.loadBonusProgramConfig(r.Context())
	if cfgErr != nil {
		if isUndefinedTableError(cfgErr) || isUndefinedColumnError(cfgErr) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "kyc is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: cfgErr.Error()})
		return
	}

	preferredAccountID := strings.TrimSpace(r.Header.Get("X-Account-ID"))
	eligibleAccountID := ""
	if target, err := h.resolveKYCEligibleAccount(r.Context(), userID, preferredAccountID); err == nil {
		eligibleAccountID = target.ID
	}

	var claimed bool
	if err := h.svc.pool.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1
			FROM kyc_bonus_claims
			WHERE user_id = $1
		)
	`, userID).Scan(&claimed); err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "kyc is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var pendingID string
	var pendingTicketNo int64
	var pendingCreatedAt time.Time
	var pendingDueAt time.Time
	err := h.svc.pool.QueryRow(r.Context(), `
		SELECT id::text, ticket_no, created_at, review_due_at
		FROM kyc_verification_requests
		WHERE user_id = $1
		  AND status = 'pending'
		ORDER BY created_at DESC
		LIMIT 1
	`, userID).Scan(&pendingID, &pendingTicketNo, &pendingCreatedAt, &pendingDueAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "kyc is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	state := kycUserState{}
	stateErr := h.svc.pool.QueryRow(r.Context(), `
		SELECT
			COALESCE(failed_attempts, 0),
			blocked_until,
			COALESCE(permanent_blocked, FALSE),
			last_rejected_at
		FROM kyc_user_states
		WHERE user_id = $1
	`, userID).Scan(
		&state.FailedAttempts,
		&state.BlockedUntilRaw,
		&state.PermanentBlocked,
		&state.LastRejectedRaw,
	)
	if stateErr != nil && !errors.Is(stateErr, pgx.ErrNoRows) {
		if isUndefinedTableError(stateErr) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "kyc is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: stateErr.Error()})
		return
	}

	now := time.Now().UTC()
	reviewConfigured := strings.TrimSpace(cfg.TelegramKYCChatID) != "" && strings.TrimSpace(h.tgBotToken) != ""
	resp := kycStatusResponse{
		State:              "unavailable",
		CanSubmit:          false,
		Message:            "KYC is unavailable",
		EligibleAccountID:  eligibleAccountID,
		BonusAmountUSD:     cfg.KYCBonusAmount.StringFixed(2),
		ReviewETAHours:     cfg.KYCReviewETAHours,
		IsReviewConfigured: reviewConfigured,
		Claimed:            claimed,
		FailedAttempts:     state.FailedAttempts,
		PermanentBlocked:   state.PermanentBlocked,
	}

	if state.LastRejectedRaw.Valid {
		t := state.LastRejectedRaw.Time.UTC()
		resp.LastRejectedAt = &t
	}

	if claimed {
		resp.State = "approved"
		resp.Message = "KYC bonus already claimed"
		httputil.WriteJSON(w, http.StatusOK, resp)
		return
	}

	if strings.TrimSpace(pendingID) != "" {
		resp.State = "pending"
		resp.Message = "KYC is under review"
		resp.PendingTicket = formatKYCRequestTicket(pendingTicketNo, pendingID)
		pendingCreatedAtUTC := pendingCreatedAt.UTC()
		pendingDueAtUTC := pendingDueAt.UTC()
		resp.PendingSince = &pendingCreatedAtUTC
		resp.PendingReviewDueAt = &pendingDueAtUTC
		httputil.WriteJSON(w, http.StatusOK, resp)
		return
	}

	if state.PermanentBlocked {
		resp.State = "blocked_permanent"
		resp.Message = "KYC is blocked permanently. Contact support or owner."
		httputil.WriteJSON(w, http.StatusOK, resp)
		return
	}

	if state.BlockedUntilRaw.Valid {
		blockedUntil := state.BlockedUntilRaw.Time.UTC()
		if blockedUntil.After(now) {
			resp.State = "blocked_temp"
			resp.Message = "KYC is temporarily blocked after rejected submissions."
			resp.BlockedUntil = &blockedUntil
			secondsLeft := int64(blockedUntil.Sub(now).Seconds())
			if secondsLeft < 0 {
				secondsLeft = 0
			}
			resp.BlockedSeconds = secondsLeft
			httputil.WriteJSON(w, http.StatusOK, resp)
			return
		}
	}

	if !reviewConfigured {
		resp.State = "unavailable"
		resp.Message = "KYC review chat is not configured yet."
		httputil.WriteJSON(w, http.StatusOK, resp)
		return
	}

	if eligibleAccountID == "" {
		resp.State = "unavailable"
		resp.Message = "Switch to an active Real Standard account to submit KYC."
		httputil.WriteJSON(w, http.StatusOK, resp)
		return
	}

	resp.State = "available"
	resp.CanSubmit = true
	resp.Message = "KYC can be submitted"
	httputil.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) RequestKYC(w http.ResponseWriter, r *http.Request, userID string) {
	if h.accountSvc == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "account service unavailable"})
		return
	}
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if account.Mode != "real" || strings.TrimSpace(strings.ToLower(account.PlanID)) != "standard" || !account.IsActive {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{
			Error: "KYC submission requires active Real Standard account",
		})
		return
	}

	cfg, cfgErr := h.loadBonusProgramConfig(r.Context())
	if cfgErr != nil {
		if isUndefinedTableError(cfgErr) || isUndefinedColumnError(cfgErr) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "kyc is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: cfgErr.Error()})
		return
	}
	if strings.TrimSpace(cfg.TelegramKYCChatID) == "" || strings.TrimSpace(h.tgBotToken) == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{
			Error: "KYC review is unavailable: Telegram review chat is not configured",
		})
		return
	}

	var req kycRequestInput
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	documentType := normalizeKYCDocumentType(req.DocumentType)
	if documentType == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid document_type"})
		return
	}
	fullName := strings.TrimSpace(req.FullName)
	if len(fullName) < 3 || len(fullName) > 140 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "full_name must be between 3 and 140 characters"})
		return
	}
	documentNumber := strings.TrimSpace(req.DocumentNumber)
	if len(documentNumber) < 3 || len(documentNumber) > 80 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "document_number must be between 3 and 80 characters"})
		return
	}
	residenceAddress := strings.TrimSpace(req.ResidenceAddress)
	if len(residenceAddress) < 6 || len(residenceAddress) > 280 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "residence_address must be between 6 and 280 characters"})
		return
	}
	notes := strings.TrimSpace(req.Notes)
	if len(notes) > 500 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "notes is too long"})
		return
	}

	proofName := strings.TrimSpace(req.ProofName)
	proofMime := strings.TrimSpace(req.ProofMime)
	if proofName == "" || proofMime == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "proof file is required"})
		return
	}
	proofBlob, err := decodeProofBlob(req.ProofBase64)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if len(proofBlob) > maxKYCProofBytes {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "proof file is too large (max 10MB)"})
		return
	}

	tx, err := h.svc.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	defer tx.Rollback(r.Context())

	var alreadyClaimed bool
	if err := tx.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM kyc_bonus_claims WHERE user_id = $1)
	`, userID).Scan(&alreadyClaimed); err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "kyc is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if alreadyClaimed {
		httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{Error: "KYC bonus already claimed"})
		return
	}

	state, err := h.loadKYCUserStateTx(r.Context(), tx, userID)
	if err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "kyc is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	now := time.Now().UTC()
	if state.PermanentBlocked {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "KYC is blocked permanently. Contact support or owner."})
		return
	}
	if state.BlockedUntilRaw.Valid && state.BlockedUntilRaw.Time.UTC().After(now) {
		blockedUntil := state.BlockedUntilRaw.Time.UTC()
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{
			Error: fmt.Sprintf("KYC is blocked until %s", blockedUntil.Format("2006-01-02 15:04:05 MST")),
		})
		return
	}

	var pendingID string
	var pendingTicketNo int64
	err = tx.QueryRow(r.Context(), `
		SELECT id::text, ticket_no
		FROM kyc_verification_requests
		WHERE user_id = $1
		  AND status = 'pending'
		ORDER BY created_at DESC
		LIMIT 1
		FOR UPDATE
	`, userID).Scan(&pendingID, &pendingTicketNo)
	if err == nil {
		httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{
			Error: fmt.Sprintf("pending KYC request already exists: %s", formatKYCRequestTicket(pendingTicketNo, pendingID)),
		})
		return
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	reviewDueAt := now.Add(time.Duration(cfg.KYCReviewETAHours) * time.Hour)
	var requestID string
	var ticketNo int64
	insertErr := tx.QueryRow(r.Context(), `
		INSERT INTO kyc_verification_requests (
			user_id,
			trading_account_id,
			document_type,
			full_name,
			document_number,
			residence_address,
			notes,
			proof_file_name,
			proof_mime_type,
			proof_size_bytes,
			proof_blob,
			status,
			review_due_at,
			updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7,
			$8, $9, $10, $11,
			'pending', $12, NOW()
		)
		RETURNING id::text, ticket_no
	`, userID, account.ID, documentType, fullName, documentNumber, residenceAddress, notes, proofName, proofMime, len(proofBlob), proofBlob, reviewDueAt).Scan(&requestID, &ticketNo)
	if insertErr != nil {
		if isUndefinedTableError(insertErr) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "kyc is unavailable: run migrations"})
			return
		}
		if isUniqueViolationError(insertErr) {
			httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{Error: "pending KYC request already exists"})
			return
		}
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: insertErr.Error()})
		return
	}

	if _, err := tx.Exec(r.Context(), `
		UPDATE kyc_user_states
		SET last_request_id = $2::uuid,
			updated_at = NOW()
		WHERE user_id = $1
	`, userID, requestID); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	enqueueReviewDispatchTx(r.Context(), tx, "kyc", requestID)

	if err := tx.Commit(r.Context()); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	ticket := formatKYCRequestTicket(ticketNo, requestID)
	h.notifyUserTelegramAsync(
		userID,
		"system",
		"KYC request submitted",
		fmt.Sprintf("Request %s is pending review. Expected review time is about %d hour(s).", ticket, cfg.KYCReviewETAHours),
		"#notifications",
	)

	httputil.WriteJSON(w, http.StatusCreated, kycRequestResponse{
		RequestID:      requestID,
		Ticket:         ticket,
		Status:         "pending",
		ReviewDueAt:    reviewDueAt,
		BonusAmountUSD: cfg.KYCBonusAmount.StringFixed(2),
	})
}

func normalizeKYCDocumentType(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "passport":
		return "passport"
	case "id_card", "idcard", "id-card":
		return "id_card"
	case "driver_license", "driver-license", "drivers_license":
		return "driver_license"
	case "other":
		return "other"
	default:
		return ""
	}
}

func formatKYCRequestTicket(ticketNo int64, seed string) string {
	digits := normalizeLocalTicketNumber(ticketNo, seed)
	letters := localTicketSeedLetters(fmt.Sprintf("kyc:%d:%s", ticketNo, seed))
	return "BXkyc" + digits + letters
}

func (h *Handler) resolveKYCEligibleAccount(ctx context.Context, userID, preferredID string) (signupBonusTargetAccount, error) {
	var target signupBonusTargetAccount
	err := h.svc.pool.QueryRow(ctx, `
		SELECT id::text, name, mode
		FROM trading_accounts
		WHERE user_id = $1
		  AND mode = 'real'
		  AND plan_id = 'standard'
		  AND is_active = TRUE
		ORDER BY (id::text = $2) DESC, created_at ASC
		LIMIT 1
	`, userID, preferredID).Scan(&target.ID, &target.Name, &target.Mode)
	if err != nil {
		return signupBonusTargetAccount{}, err
	}
	target.Mode = strings.ToLower(strings.TrimSpace(target.Mode))
	return target, nil
}

func (h *Handler) loadKYCUserStateTx(ctx context.Context, tx pgx.Tx, userID string) (kycUserState, error) {
	if _, err := tx.Exec(ctx, `
		INSERT INTO kyc_user_states (user_id, failed_attempts, blocked_until, permanent_blocked, updated_at)
		VALUES ($1, 0, NULL, FALSE, NOW())
		ON CONFLICT (user_id) DO NOTHING
	`, userID); err != nil {
		return kycUserState{}, err
	}

	state := kycUserState{}
	err := tx.QueryRow(ctx, `
		SELECT
			COALESCE(failed_attempts, 0),
			blocked_until,
			COALESCE(permanent_blocked, FALSE),
			last_rejected_at
		FROM kyc_user_states
		WHERE user_id = $1
		FOR UPDATE
	`, userID).Scan(
		&state.FailedAttempts,
		&state.BlockedUntilRaw,
		&state.PermanentBlocked,
		&state.LastRejectedRaw,
	)
	if err != nil {
		return kycUserState{}, err
	}
	return state, nil
}

func (h *Handler) applyKYCRejectionPenaltyTx(ctx context.Context, tx pgx.Tx, userID string) (failedAttempts int, blockedUntil *time.Time, permanent bool, err error) {
	state, err := h.loadKYCUserStateTx(ctx, tx, userID)
	if err != nil {
		return 0, nil, false, err
	}
	now := time.Now().UTC()
	nextFailures := state.FailedAttempts + 1
	permanent = nextFailures >= 3

	var blockedUntilRaw interface{}
	if permanent {
		blockedUntilRaw = nil
	} else if nextFailures == 1 {
		until := now.Add(kycRejectCooldownHours * time.Hour)
		blockedUntil = &until
		blockedUntilRaw = until
	} else {
		until := now.Add(kycRejectCooldownDays * 24 * time.Hour)
		blockedUntil = &until
		blockedUntilRaw = until
	}

	if _, err := tx.Exec(ctx, `
		UPDATE kyc_user_states
		SET failed_attempts = $2,
			blocked_until = $3,
			permanent_blocked = $4,
			last_rejected_at = NOW(),
			updated_at = NOW()
		WHERE user_id = $1
	`, userID, nextFailures, blockedUntilRaw, permanent); err != nil {
		return 0, nil, false, err
	}
	return nextFailures, blockedUntil, permanent, nil
}

func (h *Handler) clearKYCStateTx(ctx context.Context, tx pgx.Tx, userID string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO kyc_user_states (user_id, failed_attempts, blocked_until, permanent_blocked, updated_at)
		VALUES ($1, 0, NULL, FALSE, NOW())
		ON CONFLICT (user_id)
		DO UPDATE
		SET failed_attempts = 0,
			blocked_until = NULL,
			permanent_blocked = FALSE,
			updated_at = NOW()
	`, userID)
	return err
}

func (h *Handler) resolveKYCBonusTargetAccountTx(ctx context.Context, tx pgx.Tx, userID, preferredAccountID string) (signupBonusTargetAccount, error) {
	var target signupBonusTargetAccount
	err := tx.QueryRow(ctx, `
		SELECT id::text, name, mode
		FROM trading_accounts
		WHERE user_id = $1
		  AND mode = 'real'
		  AND plan_id = 'standard'
		  AND is_active = TRUE
		ORDER BY (id::text = $2) DESC, created_at ASC
		LIMIT 1
		FOR UPDATE
	`, userID, preferredAccountID).Scan(&target.ID, &target.Name, &target.Mode)
	if err != nil {
		return signupBonusTargetAccount{}, err
	}
	target.Mode = strings.ToLower(strings.TrimSpace(target.Mode))
	return target, nil
}

func kycRewardRef(requestID string) string {
	return fmt.Sprintf("%s:%s", kycRefPrefix, strings.TrimSpace(requestID))
}

func formatKYCBlockMessage(blockedUntil *time.Time, permanent bool) string {
	if permanent {
		return "KYC request rejected. Your account is permanently blocked from KYC submissions."
	}
	if blockedUntil == nil {
		return "KYC request rejected."
	}
	return fmt.Sprintf(
		"KYC request rejected. New submission is blocked until %s.",
		blockedUntil.UTC().Format("2006-01-02 15:04:05 MST"),
	)
}
