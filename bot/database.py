import asyncpg
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict

class Database:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self.pool: Optional[asyncpg.Pool] = None
    
    async def connect(self):
        # Parse the DSN to asyncpg format
        dsn = self.dsn.replace('postgres://', 'postgresql://')
        self.pool = await asyncpg.create_pool(dsn)
    
    async def close(self):
        if self.pool:
            await self.pool.close()
    
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
