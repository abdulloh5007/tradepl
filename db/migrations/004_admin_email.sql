-- Rename username to email for admin_users
-- Migration: 004_admin_email.sql

ALTER TABLE admin_users RENAME COLUMN username TO email;

-- Update default admin to an email format
UPDATE admin_users SET email = 'admin@lvtrade.com' WHERE email = 'admin';
