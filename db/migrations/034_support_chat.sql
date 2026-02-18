CREATE TABLE IF NOT EXISTS support_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_user_message_at TIMESTAMPTZ,
    last_admin_message_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_conversations_user_id
    ON support_conversations(user_id);

CREATE INDEX IF NOT EXISTS idx_support_conversations_status_updated_at
    ON support_conversations(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin', 'system')),
    sender_user_id UUID,
    sender_admin_username TEXT,
    body TEXT NOT NULL,
    read_by_user BOOLEAN NOT NULL DEFAULT FALSE,
    read_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_conversation_id_id
    ON support_messages(conversation_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_support_messages_unread_user
    ON support_messages(conversation_id, read_by_user)
    WHERE sender_type IN ('admin', 'system');

CREATE INDEX IF NOT EXISTS idx_support_messages_unread_admin
    ON support_messages(conversation_id, read_by_admin)
    WHERE sender_type = 'user';
