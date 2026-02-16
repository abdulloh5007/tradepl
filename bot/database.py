import asyncpg
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List, Tuple

class Database:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self._asyncpg_dsn = dsn.replace('postgres://', 'postgresql://')
        self.pool: Optional[asyncpg.Pool] = None
        self.listener_conn: Optional[asyncpg.Connection] = None
    
    async def connect(self):
        # Parse the DSN to asyncpg format
        self.pool = await asyncpg.create_pool(self._asyncpg_dsn)
    
    async def close(self):
        if self.listener_conn:
            await self.listener_conn.close()
            self.listener_conn = None
        if self.pool:
            await self.pool.close()
    
    async def start_listener(self, channel: str, callback):
        if self.listener_conn:
            try:
                await self.listener_conn.close()
            except Exception:
                pass
            self.listener_conn = None
        self.listener_conn = await asyncpg.connect(self._asyncpg_dsn)
        await self.listener_conn.add_listener(channel, callback)
    
    def listener_alive(self) -> bool:
        return self.listener_conn is not None and not self.listener_conn.is_closed()
    
    async def create_token(self, token_type: str, telegram_id: int, duration_seconds: int) -> str:
        """Create a new access token."""
        token = secrets.token_hex(32)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=duration_seconds)
        
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO access_tokens (token, token_type, telegram_id, expires_at)
                VALUES ($1, $2, $3, $4)
            ''', token, token_type, telegram_id, expires_at)
        
        return token

    @staticmethod
    def _affected_rows(result: str) -> int:
        try:
            return int(str(result).split()[-1])
        except Exception:
            return 0

    async def get_active_token(self, token_type: str, telegram_id: int) -> Optional[Dict[str, Any]]:
        """Return active access token for telegram user and token type, if any."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                '''
                SELECT token, expires_at, created_at
                FROM access_tokens
                WHERE token_type = $1
                  AND telegram_id = $2
                  AND expires_at > NOW()
                ORDER BY expires_at DESC
                LIMIT 1
                ''',
                token_type,
                telegram_id,
            )
            return dict(row) if row else None

    async def delete_expired_tokens(self) -> int:
        """Delete expired access tokens and return number of removed rows."""
        async with self.pool.acquire() as conn:
            result = await conn.execute('DELETE FROM access_tokens WHERE expires_at < NOW()')
        return self._affected_rows(result)

    async def delete_user_tokens(self, token_type: str, telegram_id: int) -> int:
        """Delete all panel tokens for a specific user and token type."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                '''
                DELETE FROM access_tokens
                WHERE token_type = $1
                  AND telegram_id = $2
                ''',
                token_type,
                telegram_id,
            )
        return self._affected_rows(result)

    async def delete_all_panel_tokens(self) -> int:
        """Delete all panel access tokens regardless of owner/admin type."""
        async with self.pool.acquire() as conn:
            result = await conn.execute('DELETE FROM access_tokens')
        return self._affected_rows(result)
    
    async def is_panel_admin(self, telegram_id: int) -> bool:
        """Check if user is a panel admin."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT id FROM panel_admins WHERE telegram_id = $1',
                telegram_id
            )
            return row is not None
    
    async def get_admin_rights(self, telegram_id: int) -> Optional[Dict[str, bool]]:
        """Get admin rights for a user."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT rights FROM panel_admins WHERE telegram_id = $1',
                telegram_id
            )
            if row:
                rights = row['rights']
                if isinstance(rights, list):
                    return {r: True for r in rights}
                if isinstance(rights, str):
                    import json
                    try:
                        return json.loads(rights)
                    except:
                        return {}
                try:
                    return dict(rights)
                except (ValueError, TypeError):
                    return {}
            return None

    async def get_review_chats(self) -> Tuple[str, str]:
        """Return configured Telegram review chat IDs for deposits and KYC."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                '''
                SELECT
                    COALESCE((to_jsonb(trc)->>'telegram_deposit_chat_id')::text, '') AS deposit_chat_id,
                    COALESCE((to_jsonb(trc)->>'telegram_kyc_chat_id')::text, '') AS kyc_chat_id
                FROM trading_risk_config trc
                ORDER BY id DESC
                LIMIT 1
                '''
            )
            if not row:
                return "", ""
            return str(row["deposit_chat_id"] or "").strip(), str(row["kyc_chat_id"] or "").strip()

    async def fetch_pending_deposit_reviews(self, limit: int) -> List[Dict[str, Any]]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                '''
                SELECT
                    r.id::text AS id,
                    r.ticket_no,
                    r.user_id::text AS user_id,
                    COALESCE(u.email, '') AS user_email,
                    r.trading_account_id::text AS trading_account_id,
                    COALESCE(ta.name, '') AS account_name,
                    COALESCE(ta.mode, '') AS account_mode,
                    COALESCE(ta.plan_id, '') AS plan_id,
                    r.amount_usd,
                    r.voucher_kind,
                    r.bonus_amount_usd,
                    r.total_credit_usd,
                    r.proof_file_name,
                    r.proof_mime_type,
                    r.proof_blob,
                    r.review_due_at,
                    r.created_at
                FROM real_deposit_requests r
                LEFT JOIN users u ON u.id = r.user_id
                LEFT JOIN trading_accounts ta ON ta.id = r.trading_account_id
                WHERE r.status = 'pending'
                  AND r.review_message_id IS NULL
                ORDER BY r.created_at ASC
                LIMIT $1
                ''',
                max(1, int(limit)),
            )
            return [dict(r) for r in rows]

    async def mark_deposit_review_dispatched(self, request_id: str, chat_id: int, message_id: int) -> bool:
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                '''
                UPDATE real_deposit_requests
                SET review_message_chat_id = $2,
                    review_message_id = $3,
                    updated_at = NOW()
                WHERE id = $1
                  AND status = 'pending'
                  AND review_message_id IS NULL
                ''',
                request_id,
                chat_id,
                message_id,
            )
        try:
            affected = int(result.split()[-1])
        except Exception:
            affected = 0
        return affected > 0

    async def fetch_pending_kyc_reviews(self, limit: int) -> List[Dict[str, Any]]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                '''
                SELECT
                    r.id::text AS id,
                    r.ticket_no,
                    r.user_id::text AS user_id,
                    COALESCE(u.email, '') AS user_email,
                    r.trading_account_id::text AS trading_account_id,
                    COALESCE(ta.name, '') AS account_name,
                    COALESCE(ta.mode, '') AS account_mode,
                    COALESCE(ta.plan_id, '') AS plan_id,
                    r.document_type,
                    r.full_name,
                    r.document_number,
                    r.residence_address,
                    COALESCE(r.notes, '') AS notes,
                    r.proof_file_name,
                    r.proof_mime_type,
                    r.proof_blob,
                    r.review_due_at,
                    r.created_at
                FROM kyc_verification_requests r
                LEFT JOIN users u ON u.id = r.user_id
                LEFT JOIN trading_accounts ta ON ta.id = r.trading_account_id
                WHERE r.status = 'pending'
                  AND r.review_message_id IS NULL
                ORDER BY r.created_at ASC
                LIMIT $1
                ''',
                max(1, int(limit)),
            )
            return [dict(r) for r in rows]

    async def mark_kyc_review_dispatched(self, request_id: str, chat_id: int, message_id: int) -> bool:
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                '''
                UPDATE kyc_verification_requests
                SET review_message_chat_id = $2,
                    review_message_id = $3,
                    updated_at = NOW()
                WHERE id = $1
                  AND status = 'pending'
                  AND review_message_id IS NULL
                ''',
                request_id,
                chat_id,
                message_id,
            )
        try:
            affected = int(result.split()[-1])
        except Exception:
            affected = 0
        return affected > 0

    async def is_deposit_reviewer_allowed(self, telegram_id: int, owner_telegram_id: int) -> bool:
        if telegram_id == 0:
            return False
        if owner_telegram_id and telegram_id == owner_telegram_id:
            return True
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                '''
                SELECT COALESCE((rights->>'deposit_review')::boolean, FALSE) AS allowed
                FROM panel_admins
                WHERE telegram_id = $1
                ''',
                telegram_id,
            )
            return bool(row and row["allowed"])

    async def list_panel_admin_deposit_review_rights(self) -> List[Dict[str, Any]]:
        """Return panel admins with telegram IDs and current deposit_review right."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                '''
                SELECT
                    telegram_id,
                    COALESCE((rights->>'deposit_review')::boolean, FALSE) AS deposit_review
                FROM panel_admins
                WHERE COALESCE(telegram_id, 0) > 0
                '''
            )
            return [
                {
                    "telegram_id": int(r["telegram_id"] or 0),
                    "deposit_review": bool(r["deposit_review"]),
                }
                for r in rows
            ]

    async def is_kyc_reviewer_allowed(self, telegram_id: int, owner_telegram_id: int) -> bool:
        if telegram_id == 0:
            return False
        if owner_telegram_id and telegram_id == owner_telegram_id:
            return True
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                '''
                SELECT COALESCE((rights->>'kyc_review')::boolean, FALSE) AS allowed
                FROM panel_admins
                WHERE telegram_id = $1
                ''',
                telegram_id,
            )
            return bool(row and row["allowed"])

    async def get_deposit_request_notification_target(self, request_id: str) -> Optional[int]:
        async with self.pool.acquire() as conn:
            try:
                row = await conn.fetchrow(
                    '''
                    SELECT
                        COALESCE(u.telegram_id, 0) AS telegram_id,
                        COALESCE(u.telegram_write_access, FALSE) AS write_access,
                        COALESCE(u.telegram_notifications_enabled, TRUE) AS notifications_enabled
                    FROM real_deposit_requests r
                    LEFT JOIN users u ON u.id = r.user_id
                    WHERE r.id = $1
                    ''',
                    request_id,
                )
            except asyncpg.UndefinedColumnError:
                row = await conn.fetchrow(
                    '''
                    SELECT COALESCE(u.telegram_id, 0) AS telegram_id, COALESCE(u.telegram_write_access, FALSE) AS write_access
                    FROM real_deposit_requests r
                    LEFT JOIN users u ON u.id = r.user_id
                    WHERE r.id = $1
                    ''',
                    request_id,
                )
                if row is not None:
                    row = dict(row)
                    row["notifications_enabled"] = True
            if not row:
                return None
            telegram_id = int(row["telegram_id"] or 0)
            if telegram_id <= 0 or not bool(row["write_access"]) or not bool(row["notifications_enabled"]):
                return None
            return telegram_id

    async def get_kyc_request_notification_target(self, request_id: str) -> Optional[int]:
        async with self.pool.acquire() as conn:
            try:
                row = await conn.fetchrow(
                    '''
                    SELECT
                        COALESCE(u.telegram_id, 0) AS telegram_id,
                        COALESCE(u.telegram_write_access, FALSE) AS write_access,
                        COALESCE(u.telegram_notifications_enabled, TRUE) AS notifications_enabled
                    FROM kyc_verification_requests r
                    LEFT JOIN users u ON u.id = r.user_id
                    WHERE r.id = $1
                    ''',
                    request_id,
                )
            except asyncpg.UndefinedColumnError:
                row = await conn.fetchrow(
                    '''
                    SELECT COALESCE(u.telegram_id, 0) AS telegram_id, COALESCE(u.telegram_write_access, FALSE) AS write_access
                    FROM kyc_verification_requests r
                    LEFT JOIN users u ON u.id = r.user_id
                    WHERE r.id = $1
                    ''',
                    request_id,
                )
                if row is not None:
                    row = dict(row)
                    row["notifications_enabled"] = True
            if not row:
                return None
            telegram_id = int(row["telegram_id"] or 0)
            if telegram_id <= 0 or not bool(row["write_access"]) or not bool(row["notifications_enabled"]):
                return None
            return telegram_id

    async def disable_user_write_access(self, telegram_id: int) -> None:
        if telegram_id <= 0:
            return
        async with self.pool.acquire() as conn:
            try:
                await conn.execute(
                    '''
                    UPDATE users
                    SET telegram_write_access = FALSE
                    WHERE telegram_id = $1
                    ''',
                    telegram_id,
                )
            except asyncpg.UndefinedColumnError:
                return
