CREATE TABLE IF NOT EXISTS support_reply_templates (
    id BIGSERIAL PRIMARY KEY,
    template_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_reply_templates_sort
    ON support_reply_templates(sort_order ASC, id ASC);

INSERT INTO support_reply_templates (template_key, title, message, enabled, sort_order)
VALUES
    (
        'deposit_pending',
        'Deposit in review',
        'Your deposit request is in review now. Please wait, verification can take up to 2 hours.',
        TRUE,
        10
    ),
    (
        'deposit_approved',
        'Deposit approved',
        'Your deposit has been approved and credited to your account balance.',
        TRUE,
        20
    ),
    (
        'deposit_rejected',
        'Deposit rejected',
        'Your deposit request was rejected. Please upload a clear payment proof and exact transfer amount.',
        TRUE,
        30
    ),
    (
        'need_details',
        'Need more details',
        'Please send additional details for this request: payment method, transfer time, and proof screenshot.',
        TRUE,
        40
    ),
    (
        'closed_with_help',
        'Issue resolved',
        'Your issue has been resolved. If anything else appears, send a new message and support will help you.',
        TRUE,
        50
    )
ON CONFLICT (template_key) DO UPDATE SET
    title = EXCLUDED.title,
    message = EXCLUDED.message,
    enabled = EXCLUDED.enabled,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();
