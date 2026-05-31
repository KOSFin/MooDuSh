import time
from collections import defaultdict, deque

from fastapi import APIRouter, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from urllib.parse import quote, quote_plus

from .config import settings
from .database import database
from .security import (
    ADMIN_COOKIE,
    ADMIN_CSRF_FIELD,
    ADMIN_MAX_AGE,
    create_admin_cookie_value,
    load_admin_session,
    require_admin_session,
    verify_admin_csrf,
    verify_admin_password,
)

templates = Jinja2Templates(directory='app/templates')

admin_router = APIRouter()

PAGE_SIZE = 50
LOGIN_WINDOW_SECONDS = 300
LOGIN_MAX_ATTEMPTS = 8
_login_attempts: dict[str, deque[float]] = defaultdict(deque)


def _client_key(request: Request) -> str:
    forwarded = request.headers.get('x-forwarded-for', '')
    if forwarded:
        return forwarded.split(',', 1)[0].strip()
    return request.client.host if request.client else 'unknown'


def _login_limited(request: Request) -> bool:
    key = _client_key(request)
    now = time.monotonic()
    attempts = _login_attempts[key]
    while attempts and now - attempts[0] > LOGIN_WINDOW_SECONDS:
        attempts.popleft()
    return len(attempts) >= LOGIN_MAX_ATTEMPTS


def _record_failed_login(request: Request) -> None:
    _login_attempts[_client_key(request)].append(time.monotonic())


def _clear_failed_logins(request: Request) -> None:
    _login_attempts.pop(_client_key(request), None)


def _admin_context(request: Request, active_page: str, **extra):
    session = load_admin_session(request)
    context = {
        'active_page': active_page,
        'csrf_token': session.get('csrf') if session else '',
        'app_env': settings.app_env,
    }
    context.update(extra)
    return context


def _require_admin_or_login(request: Request):
    session = load_admin_session(request)
    if session:
        return session
    raise HTTPException(status_code=status.HTTP_303_SEE_OTHER, headers={'Location': '/admin/login'})


def _safe_admin_redirect(value: str, fallback: str = '/admin') -> str:
    value = str(value or '').strip()
    if value.startswith('/admin') and not value.startswith('//') and '\n' not in value and '\r' not in value:
        return value
    return fallback


def _wants_json(request: Request) -> bool:
    accept = request.headers.get('accept', '')
    requested_with = request.headers.get('x-requested-with', '')
    return 'application/json' in accept.lower() or requested_with.lower() == 'fetch'


# ── Login / Logout ─────────────────────────────────────────────────

@admin_router.get('/admin/login', response_class=HTMLResponse)
@admin_router.get('/api/admin/login', response_class=HTMLResponse)
async def admin_login_page(request: Request):
    if load_admin_session(request):
        return RedirectResponse(url='/admin', status_code=303)
    return templates.TemplateResponse(request=request, name='admin_login.html', context={'error': None})


@admin_router.post('/admin/login', response_class=HTMLResponse)
@admin_router.post('/api/admin/login', response_class=HTMLResponse)
async def admin_login_submit(request: Request, password: str = Form(...)):
    if _login_limited(request):
        return templates.TemplateResponse(
            request=request,
            name='admin_login.html',
            context={'error': 'Слишком много попыток. Подождите несколько минут.'},
            status_code=429,
        )

    if not verify_admin_password(password):
        _record_failed_login(request)
        return templates.TemplateResponse(
            request=request,
            name='admin_login.html',
            context={'error': 'Неверный пароль администратора'},
            status_code=401,
        )
    _clear_failed_logins(request)
    response = RedirectResponse(url='/admin', status_code=303)
    response.set_cookie(
        key=ADMIN_COOKIE,
        value=create_admin_cookie_value(),
        max_age=ADMIN_MAX_AGE,
        httponly=True,
        samesite='lax',
        secure=settings.app_env == 'production',
    )
    return response


@admin_router.post('/admin/logout')
@admin_router.post('/api/admin/logout')
async def admin_logout(request: Request, csrf_token: str = Form(..., alias=ADMIN_CSRF_FIELD)):
    verify_admin_csrf(request, csrf_token)
    response = RedirectResponse(url='/admin/login', status_code=303)
    response.delete_cookie(ADMIN_COOKIE)
    return response


# ── Overview ───────────────────────────────────────────────────────

@admin_router.get('/admin', response_class=HTMLResponse)
@admin_router.get('/api/admin', response_class=HTMLResponse)
async def admin_overview(request: Request):
    _require_admin_or_login(request)
    data = await database.get_admin_overview()
    return templates.TemplateResponse(
        request=request,
        name='admin_overview.html',
        context=_admin_context(request, 'overview', data=data),
    )


# ── Users ──────────────────────────────────────────────────────────

@admin_router.get('/admin/users', response_class=HTMLResponse)
@admin_router.get('/api/admin/users', response_class=HTMLResponse)
async def admin_users(request: Request, page: int = 1, q: str = ''):
    _require_admin_or_login(request)
    offset = (max(1, page) - 1) * PAGE_SIZE
    data = await database.get_admin_users_page(search=q, limit=PAGE_SIZE, offset=offset)
    return templates.TemplateResponse(
        request=request,
        name='admin_users.html',
        context=_admin_context(
            request,
            'users',
            data=data,
            page=max(1, page),
            page_size=PAGE_SIZE,
            search=q,
            search_url=quote_plus(q),
        ),
    )


@admin_router.get('/admin/users/{user_id}', response_class=HTMLResponse)
@admin_router.get('/api/admin/users/{user_id}', response_class=HTMLResponse)
async def admin_user_detail(request: Request, user_id: int):
    _require_admin_or_login(request)
    data = await database.get_admin_user_detail(user_id)
    if not data.get('user'):
        raise HTTPException(status_code=404, detail='Пользователь не найден')
    return templates.TemplateResponse(
        request=request,
        name='admin_user_detail.html',
        context=_admin_context(request, 'users', data=data),
    )


# ── Tests ──────────────────────────────────────────────────────────

@admin_router.get('/admin/tests', response_class=HTMLResponse)
@admin_router.get('/api/admin/tests', response_class=HTMLResponse)
async def admin_tests(request: Request, page: int = 1, q: str = ''):
    _require_admin_or_login(request)
    offset = (max(1, page) - 1) * PAGE_SIZE
    data = await database.get_admin_tests_page(search=q, limit=PAGE_SIZE, offset=offset)
    return templates.TemplateResponse(
        request=request,
        name='admin_tests.html',
        context=_admin_context(
            request,
            'tests',
            data=data,
            page=max(1, page),
            page_size=PAGE_SIZE,
            search=q,
            search_url=quote_plus(q),
        ),
    )


@admin_router.get('/admin/tests/{test_key}', response_class=HTMLResponse)
@admin_router.get('/api/admin/tests/{test_key}', response_class=HTMLResponse)
async def admin_test_detail(request: Request, test_key: str, page: int = 1):
    _require_admin_or_login(request)
    offset = (max(1, page) - 1) * PAGE_SIZE
    data = await database.get_admin_test_detail(test_key, limit=PAGE_SIZE, offset=offset)
    if not data.get('test'):
        raise HTTPException(status_code=404, detail='Тест не найден')
    return templates.TemplateResponse(
        request=request,
        name='admin_test_detail.html',
        context=_admin_context(request, 'tests', data=data, page=max(1, page), page_size=PAGE_SIZE),
    )


# ── Questions ──────────────────────────────────────────────────────

@admin_router.get('/admin/questions', response_class=HTMLResponse)
@admin_router.get('/api/admin/questions', response_class=HTMLResponse)
async def admin_questions(request: Request, page: int = 1, q: str = ''):
    _require_admin_or_login(request)
    offset = (max(1, page) - 1) * PAGE_SIZE
    data = await database.get_admin_questions_page(search=q, limit=PAGE_SIZE, offset=offset)
    return templates.TemplateResponse(
        request=request,
        name='admin_questions.html',
        context=_admin_context(
            request,
            'questions',
            data=data,
            page=max(1, page),
            page_size=PAGE_SIZE,
            search=q,
            search_url=quote_plus(q),
        ),
    )


@admin_router.post('/admin/questions/delete')
@admin_router.post('/api/admin/questions/delete')
async def admin_question_delete(
    request: Request,
    test_key: str = Form(...),
    question_key: str = Form(...),
    return_to: str = Form('/admin/questions'),
    csrf_token: str = Form(..., alias=ADMIN_CSRF_FIELD),
):
    _require_admin_or_login(request)
    verify_admin_csrf(request, csrf_token)
    deleted = await database.delete_admin_question(test_key, question_key)
    if _wants_json(request):
        return JSONResponse({'ok': True, 'deleted': deleted})
    fallback = f'/admin/tests/{quote(test_key, safe="")}' if test_key else '/admin/questions'
    return RedirectResponse(url=_safe_admin_redirect(return_to, fallback), status_code=303)


# ── OpenEdu V2 course hierarchy ───────────────────────────────────

@admin_router.get('/admin/v2/courses', response_class=HTMLResponse)
@admin_router.get('/api/admin/v2/courses', response_class=HTMLResponse)
async def admin_v2_courses(request: Request, page: int = 1, q: str = ''):
    _require_admin_or_login(request)
    offset = (max(1, page) - 1) * PAGE_SIZE
    data = await database.get_admin_v2_courses_page(search=q, limit=PAGE_SIZE, offset=offset)
    return templates.TemplateResponse(
        request=request,
        name='admin_v2_courses.html',
        context=_admin_context(
            request,
            'v2_courses',
            data=data,
            page=max(1, page),
            page_size=PAGE_SIZE,
            search=q,
            search_url=quote_plus(q),
        ),
    )


@admin_router.get('/admin/v2/courses/{course_id:path}', response_class=HTMLResponse)
@admin_router.get('/api/admin/v2/courses/{course_id:path}', response_class=HTMLResponse)
async def admin_v2_course_detail(request: Request, course_id: str):
    _require_admin_or_login(request)
    data = await database.get_admin_v2_course_detail(course_id)
    if not data.get('course'):
        raise HTTPException(status_code=404, detail='Курс не найден')
    return templates.TemplateResponse(
        request=request,
        name='admin_v2_course_detail.html',
        context=_admin_context(request, 'v2_courses', data=data),
    )


@admin_router.post('/admin/v2/purge')
@admin_router.post('/api/admin/v2/purge')
async def admin_v2_purge(request: Request, csrf_token: str = Form(..., alias=ADMIN_CSRF_FIELD)):
    _require_admin_or_login(request)
    verify_admin_csrf(request, csrf_token)
    await database.delete_admin_v2_all()
    return RedirectResponse(url='/admin/v2/courses', status_code=303)


@admin_router.post('/admin/v2/courses/delete')
@admin_router.post('/api/admin/v2/courses/delete')
async def admin_v2_course_delete(
    request: Request,
    course_id: str = Form(...),
    csrf_token: str = Form(..., alias=ADMIN_CSRF_FIELD),
):
    _require_admin_or_login(request)
    verify_admin_csrf(request, csrf_token)
    deleted = await database.delete_admin_v2_course(course_id)
    if _wants_json(request):
        return JSONResponse({'ok': True, 'deleted': deleted})
    return RedirectResponse(url='/admin/v2/courses', status_code=303)


@admin_router.post('/admin/v2/chapters/delete')
@admin_router.post('/api/admin/v2/chapters/delete')
async def admin_v2_chapter_delete(
    request: Request,
    course_id: str = Form(...),
    chapter_id: str = Form(...),
    csrf_token: str = Form(..., alias=ADMIN_CSRF_FIELD),
):
    _require_admin_or_login(request)
    verify_admin_csrf(request, csrf_token)
    deleted = await database.delete_admin_v2_chapter(course_id, chapter_id)
    if _wants_json(request):
        return JSONResponse({'ok': True, 'deleted': deleted})
    return RedirectResponse(url=f'/admin/v2/courses/{quote(course_id, safe="")}', status_code=303)


@admin_router.post('/admin/v2/sequentials/delete')
@admin_router.post('/api/admin/v2/sequentials/delete')
async def admin_v2_sequential_delete(
    request: Request,
    course_id: str = Form(...),
    sequential_id: str = Form(...),
    csrf_token: str = Form(..., alias=ADMIN_CSRF_FIELD),
):
    _require_admin_or_login(request)
    verify_admin_csrf(request, csrf_token)
    deleted = await database.delete_admin_v2_sequential(course_id, sequential_id)
    if _wants_json(request):
        return JSONResponse({'ok': True, 'deleted': deleted})
    return RedirectResponse(url=f'/admin/v2/courses/{quote(course_id, safe="")}', status_code=303)


@admin_router.post('/admin/v2/questions/delete')
@admin_router.post('/api/admin/v2/questions/delete')
async def admin_v2_question_delete(
    request: Request,
    test_key: str = Form(...),
    question_key: str = Form(...),
    course_id: str = Form(''),
    csrf_token: str = Form(..., alias=ADMIN_CSRF_FIELD),
):
    _require_admin_or_login(request)
    verify_admin_csrf(request, csrf_token)
    deleted = await database.delete_admin_v2_question(test_key, question_key)
    if _wants_json(request):
        return JSONResponse({'ok': True, 'deleted': deleted})
    if course_id:
        return RedirectResponse(url=f'/admin/v2/courses/{quote(course_id, safe="")}', status_code=303)
    return RedirectResponse(url='/admin/v2/courses', status_code=303)


# ── Data API (JSON) ───────────────────────────────────────────────

@admin_router.get('/admin/data')
@admin_router.get('/api/admin/data')
async def admin_data(request: Request):
    require_admin_session(request)
    return await database.get_admin_overview()
