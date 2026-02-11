BEGIN;

-- Remove only order-related data while keeping users/accounts/config intact.
TRUNCATE TABLE order_fills, trades, orders RESTART IDENTITY CASCADE;

-- Reset custom ticket sequence used by orders.ticket_no (if migration 016 applied).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relkind = 'S' AND relname = 'orders_ticket_no_seq'
    ) THEN
        EXECUTE 'ALTER SEQUENCE orders_ticket_no_seq RESTART WITH 1000000';
    END IF;
END$$;

COMMIT;
