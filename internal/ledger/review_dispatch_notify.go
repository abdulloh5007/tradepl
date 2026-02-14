package ledger

import (
	"context"
	"log"
	"strings"

	"github.com/jackc/pgx/v5"
)

const reviewDispatchChannel = "review_dispatch"

func enqueueReviewDispatchTx(ctx context.Context, tx pgx.Tx, kind, requestID string) {
	if tx == nil {
		return
	}
	normalizedID := strings.TrimSpace(requestID)
	if normalizedID == "" {
		return
	}
	normalizedKind := strings.ToLower(strings.TrimSpace(kind))
	if normalizedKind == "" {
		normalizedKind = "unknown"
	}
	payload := normalizedKind + ":" + normalizedID
	if _, err := tx.Exec(ctx, `SELECT pg_notify($1, $2)`, reviewDispatchChannel, payload); err != nil {
		log.Printf("[review-dispatch] notify failed kind=%s request=%s: %v", normalizedKind, normalizedID, err)
	}
}
