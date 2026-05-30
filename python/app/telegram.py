import asyncio
import json
import re
import time

import httpx

from .config import settings


def _should_forward(kind: str) -> bool:
    lowered = kind.lower()
    return 'error' in lowered or 'exception' in lowered or 'rejection' in lowered


_SECRET_RE = re.compile(r'(authorization|x-api-token|api[_-]?token|bearer|cookie|password)["\':=\s]+([^,\s}]+)', re.IGNORECASE)
_forward_cache: dict[str, float] = {}


def _redact(value) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    text = _SECRET_RE.sub(r'\1=<redacted>', text)
    if len(text) > 2200:
        text = text[:2200] + '... <truncated>'
    return text


def _dedupe(key: str, ttl: int = 60) -> bool:
    now = time.monotonic()
    last = _forward_cache.get(key, 0)
    if now - last < ttl:
        return True
    _forward_cache[key] = now
    return False


async def forward_log_to_telegram(kind: str, payload: dict, system: dict) -> None:
    if not _should_forward(kind):
        return

    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        return

    text = (
        f"MooDuSh log: {kind}\n"
        f"scope: {system.get('scope', 'unknown')}\n"
        f"url: {system.get('url', 'n/a')}\n"
        f"payload: {str(payload)[:2500]}"
    )

    body = {
        'chat_id': settings.telegram_chat_id,
        'text': text,
        'disable_web_page_preview': True,
    }

    if settings.telegram_topic_id > 0:
        body['message_thread_id'] = settings.telegram_topic_id

    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"

    client_kwargs = {'timeout': 5.0}
    if settings.telegram_proxy_url:
        client_kwargs['proxy'] = settings.telegram_proxy_url

    async with httpx.AsyncClient(**client_kwargs) as client:
        try:
            await client.post(url, json=body)
        except Exception:
            return


def spawn_forward(kind: str, payload: dict, system: dict) -> None:
    asyncio.create_task(forward_log_to_telegram(kind, payload, system))


async def forward_log_to_telegram_v2(kind: str, payload: dict, system: dict, client: dict, actor: dict) -> None:
    if not _should_forward(kind) and str(actor.get('severity') or '') not in {'error', 'critical'}:
        return
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        return

    signature = '|'.join([
        str(actor.get('user_id') or 'anonymous'),
        str(kind or ''),
        str(system.get('scope') or ''),
        str(payload.get('message') or payload.get('error') or '')[:160],
    ])
    if _dedupe(signature):
        return

    text = (
        f"MooDuSh V2 log: {kind}\n"
        f"severity: {actor.get('severity', 'error')}\n"
        f"user_id: {actor.get('user_id', 'anonymous')} ({actor.get('auth_type', 'unknown')})\n"
        f"platform: {client.get('platform', system.get('platform', 'unknown'))}\n"
        f"extension: {client.get('extensionVersion', 'unknown')} build={client.get('buildId', 'unknown')}\n"
        f"parser: {client.get('parserVersion', 'unknown')}\n"
        f"scope: {system.get('scope', 'unknown')}\n"
        f"url: {system.get('url', 'n/a')}\n"
        f"payload: {_redact(payload)}"
    )

    body = {
        'chat_id': settings.telegram_chat_id,
        'text': text,
        'disable_web_page_preview': True,
    }
    if settings.telegram_topic_id > 0:
        body['message_thread_id'] = settings.telegram_topic_id

    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    client_kwargs = {'timeout': 5.0}
    if settings.telegram_proxy_url:
        client_kwargs['proxy'] = settings.telegram_proxy_url

    async with httpx.AsyncClient(**client_kwargs) as http_client:
        try:
            await http_client.post(url, json=body)
        except Exception:
            return


def spawn_forward_v2(kind: str, payload: dict, system: dict, client: dict, actor: dict) -> None:
    asyncio.create_task(forward_log_to_telegram_v2(kind, payload, system, client, actor))
