import asyncio

import httpx

from .config import settings


def _should_forward(kind: str) -> bool:
    lowered = kind.lower()
    return 'error' in lowered or 'exception' in lowered or 'rejection' in lowered


async def forward_log_to_telegram(kind: str, payload: dict, system: dict) -> None:
    if not _should_forward(kind):
        return

    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        return

    text = (
        f"paramEXT log: {kind}\n"
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
