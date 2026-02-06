-- Revert email back to username for admin_users
-- Migration: 005_revert_admin_email.sql

ALTER TABLE admin_users RENAME COLUMN email TO username;

-- Update admin username
UPDATE admin_users SET username = 'admin' WHERE username = 'admin@lvtrade.com';
