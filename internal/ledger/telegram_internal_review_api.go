package ledger

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"lv-tradepl/internal/httputil"
)

type internalTelegramDecisionRequest struct {
	RequestID          string `json:"request_id"`
	Action             string `json:"action"`
	ReviewerTelegramID int64  `json:"reviewer_telegram_id"`
}

type internalTelegramDepositDecisionResponse struct {
	RequestID string `json:"request_id"`
	Ticket    string `json:"ticket"`
	Status    string `json:"status"`
	AmountUSD string `json:"amount_usd"`
	BonusUSD  string `json:"bonus_usd"`
	TotalUSD  string `json:"total_usd"`
}

type internalTelegramKYCDecisionResponse struct {
	RequestID        string     `json:"request_id"`
	Ticket           string     `json:"ticket"`
	Status           string     `json:"status"`
	BonusAmountUSD   string     `json:"bonus_amount_usd"`
	FailedAttempts   int        `json:"failed_attempts"`
	BlockedUntil     *time.Time `json:"blocked_until,omitempty"`
	PermanentBlocked bool       `json:"permanent_blocked"`
}

func (h *Handler) InternalTelegramDepositDecision(w http.ResponseWriter, r *http.Request) {
	var req internalTelegramDecisionRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	req.RequestID = strings.TrimSpace(req.RequestID)
	req.Action = strings.ToLower(strings.TrimSpace(req.Action))
	if req.RequestID == "" || (req.Action != "approve" && req.Action != "reject") || req.ReviewerTelegramID == 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "request_id, action and reviewer_telegram_id are required"})
		return
	}
	if !h.isTelegramReviewerAllowed(r.Context(), req.ReviewerTelegramID) {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "reviewer is not allowed"})
		return
	}
	outcome, err := h.applyTelegramDepositReviewDecision(r.Context(), req.RequestID, req.Action, req.ReviewerTelegramID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrorResponse{Error: "deposit request not found"})
			return
		}
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, internalTelegramDepositDecisionResponse{
		RequestID: outcome.RequestID,
		Ticket:    outcome.Ticket,
		Status:    outcome.Status,
		AmountUSD: outcome.AmountUSD.StringFixed(2),
		BonusUSD:  outcome.BonusUSD.StringFixed(2),
		TotalUSD:  outcome.TotalUSD.StringFixed(2),
	})
}

func (h *Handler) InternalTelegramKYCDecision(w http.ResponseWriter, r *http.Request) {
	var req internalTelegramDecisionRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	req.RequestID = strings.TrimSpace(req.RequestID)
	req.Action = strings.ToLower(strings.TrimSpace(req.Action))
	if req.RequestID == "" || (req.Action != "approve" && req.Action != "reject") || req.ReviewerTelegramID == 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "request_id, action and reviewer_telegram_id are required"})
		return
	}
	if !h.isTelegramKYCReviewerAllowed(r.Context(), req.ReviewerTelegramID) {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "reviewer is not allowed"})
		return
	}
	outcome, err := h.applyTelegramKYCReviewDecision(r.Context(), req.RequestID, req.Action, req.ReviewerTelegramID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrorResponse{Error: "kyc request not found"})
			return
		}
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, internalTelegramKYCDecisionResponse{
		RequestID:        outcome.RequestID,
		Ticket:           outcome.Ticket,
		Status:           outcome.Status,
		BonusAmountUSD:   outcome.BonusAmountUSD.StringFixed(2),
		FailedAttempts:   outcome.FailedAttempts,
		BlockedUntil:     outcome.BlockedUntil,
		PermanentBlocked: outcome.PermanentBlocked,
	})
}
