from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.filters import Command
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from .config import settings

if TYPE_CHECKING:
    from .database import Database

logger = logging.getLogger(__name__)

router = Router()
_db: Database | None = None
_bot: Bot | None = None
_polling_task: asyncio.Task | None = None


def _set_db(db: Database) -> None:
    global _db
    _db = db


# ── Handlers ───────────────────────────────────────────────────────

@router.message(Command('start'))
async def cmd_start(message: Message) -> None:
    assert _db is not None
    tg_id = message.from_user.id
    username = message.from_user.username or ''
    first_name = message.from_user.first_name or ''

    user = await _db.get_user_by_telegram_id(tg_id)
    if not user:
        user = await _db.create_user(tg_id, username, first_name)

    token = user['api_token']
    await message.answer(
        f"Добро пожаловать в paramEXT!\n\n"
        f"Ваш персональный токен:\n<code>{token}</code>\n\n"
        f"<b>Как настроить:</b>\n"
        f"1. Откройте расширение paramEXT\n"
        f"2. Нажмите на раздел «Настройки API» внизу страницы\n"
        f"3. Перейдите в раздел OpenEdu\n"
        f"4. Вставьте токен в поле «Bearer токен»\n"
        f"5. Нажмите «Проверить API» для проверки подключения",
        parse_mode='HTML',
    )


@router.message(Command('token'))
async def cmd_token(message: Message) -> None:
    assert _db is not None
    user = await _db.get_user_by_telegram_id(message.from_user.id)
    if not user:
        await message.answer("Вы не зарегистрированы. Отправьте /start")
        return

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text='Перегенерировать токен', callback_data='regen_token')],
    ])
    await message.answer(
        f"Ваш текущий токен:\n<code>{user['api_token']}</code>",
        parse_mode='HTML',
        reply_markup=kb,
    )


@router.callback_query(F.data == 'regen_token')
async def cb_regen_token(callback: CallbackQuery) -> None:
    assert _db is not None
    user = await _db.get_user_by_telegram_id(callback.from_user.id)
    if not user:
        await callback.answer('Вы не зарегистрированы', show_alert=True)
        return

    new_token = await _db.regenerate_user_token(user['id'])
    await callback.message.edit_text(
        f"Токен обновлён!\n\nНовый токен:\n<code>{new_token}</code>\n\n"
        f"Старый токен больше не работает. Обновите его в расширении.",
        parse_mode='HTML',
    )
    await callback.answer()


@router.message(Command('stats'))
async def cmd_stats(message: Message) -> None:
    assert _db is not None
    stats = await _db.get_user_stats(message.from_user.id)
    await message.answer(
        f"Ваша статистика:\n\n"
        f"Тестов: <b>{stats['tests']}</b>\n"
        f"Вопросов: <b>{stats['questions']}</b>\n"
        f"Правильных: <b>{stats['completions']}</b>",
        parse_mode='HTML',
    )


@router.message(Command('help'))
async def cmd_help(message: Message) -> None:
    await message.answer(
        "<b>paramEXT — расширение для OpenEdu</b>\n\n"
        "<b>Команды:</b>\n"
        "/start — Регистрация и получение токена\n"
        "/token — Показать текущий токен\n"
        "/stats — Ваша статистика\n"
        "/help — Эта справка\n\n"
        "<b>Настройка расширения:</b>\n"
        "1. Установите расширение paramEXT\n"
        "2. Откройте popup расширения\n"
        "3. Разверните раздел «Бэкенд»\n"
        "4. В поле «Bearer токен» вставьте токен из /token\n"
        "5. Нажмите «Проверить»\n\n"
        "После этого расширение будет собирать и показывать статистику ответов.",
        parse_mode='HTML',
    )


# ── Lifecycle ──────────────────────────────────────────────────────

async def start_bot(db: Database) -> None:
    global _bot, _polling_task
    _set_db(db)

    if not settings.telegram_bot_token:
        logger.info('TELEGRAM_BOT_TOKEN not set, bot disabled')
        return

    if settings.telegram_proxy_url:
        _bot = Bot(
            token=settings.telegram_bot_token,
            session=AiohttpSession(proxy=settings.telegram_proxy_url),
        )
        logger.info('Telegram bot proxy enabled')
    else:
        _bot = Bot(token=settings.telegram_bot_token)

    dp = Dispatcher()
    dp.include_router(router)

    async def _poll() -> None:
        try:
            await dp.start_polling(_bot, handle_signals=False)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception('Bot polling failed')

    _polling_task = asyncio.create_task(_poll())
    logger.info('Telegram bot polling started')


async def stop_bot() -> None:
    global _polling_task, _bot
    if _polling_task and not _polling_task.done():
        _polling_task.cancel()
        try:
            await _polling_task
        except asyncio.CancelledError:
            pass
    if _bot:
        await _bot.session.close()
    _polling_task = None
    _bot = None
    logger.info('Telegram bot stopped')
