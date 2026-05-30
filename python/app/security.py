from __future__ import annotations

import hmac
import hashlib
import secrets
import time
from typing import TYPE_CHECKING, Optional

from fastapi import Header, HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import settings

if TYPE_CHECKING:
    from .database import Database

_db: Database | None = None
_signer: URLSafeTimedSerializer | None = None
_rate_buckets: dict[str, list[float]] = {}

ADMIN_COOKIE = 'paramext_admin'
ADMIN_MAX_AGE = 86400  # 24 hours
ADMIN_CSRF_FIELD = 'csrf_token'


def set_database_ref(db: Database) -> None:
    global _db
    _db = db


def _get_signer() -> URLSafeTimedSerializer:
    global _signer
    if _signer is None:
        secret = settings.admin_secret_key
        if not secret or secret == 'change-me-admin-secret':
            secret = settings.admin_token
        _signer = URLSafeTimedSerializer(secret)
    return _signer


def _extract_token(authorization: str | None, x_api_token: str | None) -> str:
    if authorization and authorization.lower().startswith('bearer '):
        return authorization[7:].strip()
    if x_api_token:
        return x_api_token.strip()
    return ''


async def require_api_token(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_api_token: Optional[str] = Header(default=None),
) -> Optional[int]:
    token = _extract_token(authorization, x_api_token)
    _enforce_rate_limit(request, token)

    # Master token from env — grants access without a user record.
    master = settings.api_bearer_token or settings.api_token
    if master and token == master:
        request.state.auth_token_type = 'master'
        request.state.user_id = None
        return None

    # Per-user token from DB.
    if token and _db:
        user = await _db.get_user_by_token(token)
        if user:
            await _db.touch_user_activity(user['id'])
            request.state.auth_token_type = 'user'
            request.state.user_id = int(user['id'])
            return int(user['id'])

    # Development keeps local work easy, production must never expose the API
    # only because a master token was forgotten.
    if not master and settings.app_env != 'production':
        request.state.auth_token_type = 'anonymous-dev'
        request.state.user_id = None
        return None

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='API токен не предоставлен')
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Неверный API токен')


def _enforce_rate_limit(request: Request, token: str) -> None:
    limit = max(10, int(settings.v2_rate_limit_per_minute or 120))
    now = time.monotonic()
    window_start = now - 60
    client_host = request.client.host if request.client else 'unknown'
    token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()[:16] if token else 'no-token'
    key = f'{client_host}:{token_hash}'

    bucket = [item for item in _rate_buckets.get(key, []) if item >= window_start]
    if len(bucket) >= limit:
        _rate_buckets[key] = bucket
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail='Слишком много запросов')

    bucket.append(now)
    _rate_buckets[key] = bucket


def verify_admin_password(value: str) -> bool:
    return hmac.compare_digest(str(value or ''), settings.admin_token)


def load_admin_session(request: Request) -> dict | None:
    cookie_value = request.cookies.get(ADMIN_COOKIE, '')
    if not cookie_value:
        return None

    try:
        data = _get_signer().loads(cookie_value, max_age=ADMIN_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None

    if not isinstance(data, dict):
        return None
    if data.get('sub') != 'admin':
        return None
    if not data.get('sid') or not data.get('csrf'):
        return None

    return data


def require_admin_session(request: Request) -> dict:
    session = load_admin_session(request)
    if session:
        return session
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Требуется авторизация')


def verify_admin_csrf(request: Request, csrf_token: str) -> None:
    session = require_admin_session(request)
    expected = str(session.get('csrf') or '')
    if not expected or not hmac.compare_digest(expected, str(csrf_token or '')):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Неверный CSRF токен')


def create_admin_cookie_value() -> str:
    return _get_signer().dumps({
        'v': 1,
        'sub': 'admin',
        'sid': secrets.token_urlsafe(24),
        'csrf': secrets.token_urlsafe(24),
        'iat': int(time.time()),
    })
