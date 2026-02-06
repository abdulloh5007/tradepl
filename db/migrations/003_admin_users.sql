-- Admin authentication
-- Migration: 003_admin_users.sql

CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default admin user
-- Password: LvTrade@2026 (bcrypt hash)
INSERT INTO admin_users (username, password_hash) VALUES 
    ('admin', '$2a$10$YITZyf6S7A8S0Qj1C3sLdO5LFz3K.Z0kGJq2nW8.J5q9VZ4rZYwDe')
ON CONFLICT (username) DO NOTHING;
