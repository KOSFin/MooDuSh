from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import datetime
from typing import Optional

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .admin import admin_router
from .bot import start_bot, stop_bot
from .config import settings
from .database import database
from .schemas import (
    LogPayloadIn,
    LogPayloadV2In,
    OpenEduAttemptIn,
    OpenEduSolutionsQueryIn,
    OpenEduV2AttemptIn,
    OpenEduV2SolutionsQueryIn,
)
from .security import require_api_token, set_database_ref
from .telegram import spawn_forward, spawn_forward_v2


@asynccontextmanager
async def lifespan(_: FastAPI):
    await database.connect()
    set_database_ref(database)
    repair_task = asyncio.create_task(database.run_repair_worker())
    try:
        await start_bot(database)
        yield
    finally:
        repair_task.cancel()
        with suppress(asyncio.CancelledError):
            await repair_task
        await stop_bot()
        await database.disconnect()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        'https://paramext.ruka.me',
        'https://syncshare.naloaty.me',
        'https://syncshare.ru',
    ],
    allow_origin_regex=r'^(https://([a-z0-9-]+\.)?openedu\.ru|chrome-extension://[a-z]{32})$',
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
    expose_headers=['*'],
    max_age=86400,
)


@app.middleware('http')
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'DENY')
    response.headers.setdefault('Referrer-Policy', 'same-origin')
    response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if request.url.path.startswith('/admin') or request.url.path.startswith('/api/admin'):
        response.headers.setdefault('Cache-Control', 'no-store')
    return response

app.include_router(admin_router)


# ── Health ─────────────────────────────────────────────────────────

@app.get('/')
@app.get('/api')
async def root() -> dict:
    return {'service': settings.app_name, 'env': settings.app_env, 'status': 'ok'}


@app.get('/health')
@app.get('/healthz')
@app.get('/api/health')
@app.get('/api/healthz')
async def healthcheck() -> dict:
    return {
        'status': 'ok',
        'service': settings.app_name,
        'env': settings.app_env,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    }


@app.get('/v2/status')
@app.get('/api/v2/status')
async def legacy_status() -> dict:
    return {'maintenance': False, 'highDemand': False}


@app.get('/v2/update')
@app.get('/api/v2/update')
async def legacy_update(version: str = '', build_id: str = '') -> dict:
    latest = settings.extension_latest_version or '2.9.0'
    required = settings.extension_required_version or ''
    return {
        'updateRequired': bool(version and version != latest),
        'latestVersion': latest,
        'requiredVersion': required,
        'releaseUrl': settings.extension_release_url,
        'repositoryUrl': settings.extension_repository_url,
        'buildKnown': _is_known_build_id(build_id),
    }


def _split_csv(value: str) -> set[str]:
    return {part.strip() for part in str(value or '').split(',') if part.strip()}


def _is_known_build_id(value: str) -> bool:
    known = _split_csv(settings.extension_known_build_ids)
    return not known or str(value or '').strip() in known


def _is_known_parser_version(value: str) -> bool:
    known = _split_csv(settings.openedu_known_parser_versions)
    return not known or str(value or '').strip() in known


# ── OpenEdu API ────────────────────────────────────────────────────

@app.post('/v1/openedu/attempts')
@app.post('/api/v1/openedu/attempts')
async def post_openedu_attempt(payload: OpenEduAttemptIn, user_id: Optional[int] = Depends(require_api_token)) -> dict:
    await database.upsert_openedu_attempt(payload.model_dump(), user_id=user_id)
    return {'ok': True}


@app.post('/v1/openedu/solutions/query')
@app.post('/api/v1/openedu/solutions/query')
async def post_openedu_query(payload: OpenEduSolutionsQueryIn, user_id: Optional[int] = Depends(require_api_token)) -> dict:
    from .database import (
        compute_question_fingerprint as _fingerprint,
        is_exact_question_content_match as _is_exact_match,
        normalize_answer_text as _norm_answer,
        normalize_prompt as _norm,
    )

    question_keys = payload.questionKeys
    if not question_keys and payload.questions:
        question_keys = [q.questionKey for q in payload.questions]

    stats = await database.query_openedu_stats(payload.context.testKey, question_keys)
    question_meta = await database.query_openedu_question_metadata(payload.context.testKey, question_keys)

    # Fallback chain for questions with no exact stats:
    # 1) Content fingerprint (same prompt + same answer set).
    # 2) Similar by prompt with answer-overlap gating.
    if payload.questions:
        missing = []
        for q in payload.questions:
            entry = stats.get(q.questionKey)
            has_answers = entry and (entry.get('verifiedAnswers') or entry.get('incorrectAnswers') or entry.get('fallbackAnswers'))
            if has_answers:
                meta = question_meta.get(q.questionKey) or {}
                if meta and not _is_exact_match(
                    meta.get('promptNorm', ''),
                    meta.get('questionFingerprint', ''),
                    q.prompt,
                    q.answers or [],
                ):
                    stats[q.questionKey] = {'completedCount': 0, 'verifiedAnswers': [], 'incorrectAnswers': [], 'fallbackAnswers': []}
                    entry = stats[q.questionKey]
                    has_answers = False
            if not has_answers and q.prompt:
                answer_norms_set = set()
                for answer in (q.answers or []):
                    answer_norm = _norm_answer(answer)
                    if answer_norm:
                        answer_norms_set.add(answer_norm)
                answer_norms = sorted(answer_norms_set)
                missing.append(
                    {
                        'questionKey': q.questionKey,
                        'promptNorm': _norm(q.prompt),
                        'answerNorms': answer_norms,
                        'questionFingerprint': _fingerprint(q.prompt, q.answers or []),
                    }
                )
        if missing:
            content_matches = await database.find_question_stats_by_fingerprint(payload.context.testKey, missing)
            for qk, content_stats in content_matches.items():
                stats[qk] = content_stats

            remaining = [item for item in missing if item['questionKey'] not in content_matches]
            if remaining:
                similar = await database.find_similar_question_stats(payload.context.testKey, remaining)
                for qk, sim_stats in similar.items():
                    stats[qk] = sim_stats

    return {'statsByQuestion': stats}


# ── OpenEdu API V2 ────────────────────────────────────────────────

@app.post('/v2/openedu/attempts')
@app.post('/api/v2/openedu/attempts')
async def post_openedu_v2_attempt(payload: OpenEduV2AttemptIn, user_id: Optional[int] = Depends(require_api_token)) -> dict:
    result = await database.upsert_openedu_v2_attempt(payload.model_dump(), user_id=user_id)
    return {
        'ok': True,
        'accepted': result.get('accepted', 0),
        'quarantined': result.get('quarantined', 0),
        'duplicate': bool(result.get('duplicate', 0)),
        'buildKnown': _is_known_build_id(payload.client.buildId),
        'parserKnown': _is_known_parser_version(payload.client.parserVersion),
    }


@app.post('/v2/openedu/solutions/query')
@app.post('/api/v2/openedu/solutions/query')
async def post_openedu_v2_query(payload: OpenEduV2SolutionsQueryIn, user_id: Optional[int] = Depends(require_api_token)) -> dict:
    question_keys = payload.questionKeys
    if not question_keys and payload.questions:
        question_keys = [q.questionKey for q in payload.questions]

    stats = await database.query_openedu_v2_stats(payload.context.testKey, question_keys)
    return {
        'statsByQuestion': stats,
        'buildKnown': _is_known_build_id(payload.client.buildId),
        'parserKnown': _is_known_parser_version(payload.client.parserVersion),
    }


@app.get('/v2/users/me/stats')
@app.get('/api/v2/users/me/stats')
async def get_v2_me_stats(user_id: Optional[int] = Depends(require_api_token)) -> dict:
    return {'ok': True, 'stats': await database.get_user_public_stats(user_id)}


# ── Client logs (DB write retired, Telegram forwarding kept) ───────

@app.post('/v1/logs/client')
@app.post('/api/v1/logs/client')
async def post_extension_log(payload: LogPayloadIn, user_id: Optional[int] = Depends(require_api_token)) -> dict:
    serialized = payload.model_dump()
    spawn_forward(serialized['kind'], serialized['payload'], serialized['system'])
    return {'ok': True}


@app.post('/v2/logs/client')
@app.post('/api/v2/logs/client')
async def post_extension_log_v2(request: Request, payload: LogPayloadV2In, user_id: Optional[int] = Depends(require_api_token)) -> dict:
    serialized = payload.model_dump()
    await database.write_client_log_v2(serialized, user_id=user_id)
    spawn_forward_v2(
        serialized['kind'],
        serialized.get('payload') or {},
        serialized.get('system') or {},
        serialized.get('client') or {},
        {
            'user_id': user_id,
            'auth_type': getattr(request.state, 'auth_token_type', ''),
            'severity': serialized.get('severity') or 'error',
        },
    )
    return {'ok': True}
