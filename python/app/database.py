from __future__ import annotations

import asyncio
import hashlib
import html
import json
import re
import uuid
from typing import Any

import asyncpg

from .config import settings

_NORM_PUNCT_RE = re.compile(r'[^\w\s]', re.UNICODE)
_NORM_WS_RE = re.compile(r'\s+')
_ZERO_WIDTH_RE = re.compile(r'[\u200b-\u200f\ufeff]')
_QUESTION_UI_RE = re.compile(r'(\|\*\~?\??|\?+\s*(?=MooDuSh|Вставить)|похож\.)', re.IGNORECASE)
_TRAILING_COUNT_RE = re.compile(r'(^|\s)\d+(?=\s|$)')
_CSS_DECLARATION_RE = re.compile(
    r'\b(?:align-items|animation|background(?:-color)?|border(?:-(?:color|radius|top-color))?|box-sizing|color|display|font(?:-size|-weight)?|height|justify-content|line-height|margin(?:-(?:bottom|left|right|top))?|max-width|min-height|opacity|overflow|padding(?:-(?:bottom|left|right|top))?|pointer-events|position|text-align|transform|transition|width|z-index)\s*:',
    re.IGNORECASE,
)
_CSS_SELECTOR_RE = re.compile(r'(^|\s)[.#][a-z_-][\w-]*(?:[.#][a-z_-][\w-]*)?(?=\s|[,{:.#])', re.IGNORECASE)
_OPENEDU_CSS_MARKER_RE = re.compile(r'\b(?:answerPlaceStudent|allAnswers|loadingspinner|ui-sortable|btn-brand|submit-attempt-container|problem-action-buttons-wrapper)\b', re.IGNORECASE)
OPENEDU_V2_UNMAPPED_COURSE_ID = '__unmapped__'
_TEX_COMMANDS = {
    'Alpha': 'Α',
    'Beta': 'Β',
    'Gamma': 'Γ',
    'Delta': 'Δ',
    'Epsilon': 'Ε',
    'Zeta': 'Ζ',
    'Eta': 'Η',
    'Theta': 'Θ',
    'Iota': 'Ι',
    'Kappa': 'Κ',
    'Lambda': 'Λ',
    'Mu': 'Μ',
    'Nu': 'Ν',
    'Xi': 'Ξ',
    'Omicron': 'Ο',
    'Pi': 'Π',
    'Rho': 'Ρ',
    'Sigma': 'Σ',
    'Tau': 'Τ',
    'Upsilon': 'Υ',
    'Phi': 'Φ',
    'Chi': 'Χ',
    'Psi': 'Ψ',
    'Omega': 'Ω',
    'alpha': 'α',
    'beta': 'β',
    'gamma': 'γ',
    'delta': 'δ',
    'epsilon': 'ε',
    'varepsilon': 'ε',
    'zeta': 'ζ',
    'eta': 'η',
    'theta': 'θ',
    'vartheta': 'θ',
    'iota': 'ι',
    'kappa': 'κ',
    'lambda': 'λ',
    'mu': 'μ',
    'nu': 'ν',
    'xi': 'ξ',
    'omicron': 'ο',
    'pi': 'π',
    'rho': 'ρ',
    'sigma': 'σ',
    'tau': 'τ',
    'upsilon': 'υ',
    'phi': 'φ',
    'varphi': 'φ',
    'chi': 'χ',
    'psi': 'ψ',
    'omega': 'ω',
    'times': '×',
    'cdot': '·',
    'le': '≤',
    'leq': '≤',
    'ge': '≥',
    'geq': '≥',
    'neq': '≠',
    'ne': '≠',
    'pm': '±',
    'infty': '∞',
}
_QUESTION_UI_PHRASES = sorted(
    [
        'Вставить популярные ответы похожего вопроса',
        'Вставить популярный ответ похожего вопроса',
        'Вставить правильные ответы',
        'Вставить правильный ответ',
        'Вставить популярные ответы',
        'Вставить популярный ответ',
        'Вставить ответы похожего вопроса',
        'Вставить ответ похожего вопроса',
        'Нет точных ответов, только похожие данные.',
        'Нет статистики по этому вопросу.',
        'Для этого вопроса пока нет своей статистики.',
        'Точный ответ для этого вопроса не найден.',
        'Показаны данные похожего вопроса.',
        'Похожий вопрос',
        'Этот вопрос',
        'MooDuSh OpenEdu',
        'MooDuSh',
        'Пока нет ответов.',
        'Ответы',
    ],
    key=len,
    reverse=True,
)


def collapse_whitespace(value: Any) -> str:
    return _NORM_WS_RE.sub(' ', html.unescape(str(value or ''))).strip()


def normalize_tex_math_text(value: Any) -> str:
    text = html.unescape(str(value or ''))
    for _ in range(3):
        next_text = re.sub(r'\\\(([\s\S]*?)\\\)', r'\1', text)
        next_text = re.sub(r'\\\[([\s\S]*?)\\\]', r'\1', next_text)
        next_text = re.sub(r'\$\$([\s\S]*?)\$\$', r'\1', next_text)
        next_text = re.sub(r'(^|[^\w$])\$([^$\n]+)\$', r'\1\2', next_text)
        if next_text == text:
            break
        text = next_text

    for _ in range(4):
        next_text = re.sub(r'\\(?:text|mathrm|mathbf|mathit|mathsf|textrm)\s*\{([^{}]*)\}', r'\1', text)
        next_text = re.sub(r'\{([^{}]*)\}', r'\1', next_text)
        if next_text == text:
            break
        text = next_text

    text = re.sub(r'\\[,;:! ]', ' ', text)
    text = re.sub(
        r'\\([A-Za-z]+)\b',
        lambda match: _TEX_COMMANDS.get(match.group(1), match.group(1)),
        text,
    )
    text = re.sub(r'\\([{}()[\],.;:+\-*/=])', r'\1', text)
    text = re.sub(r'\s+([)\],.;:])', r'\1', text)
    text = re.sub(r'([([])\s+', r'\1', text)
    return collapse_whitespace(text)


def _strip_question_ui_phrases(value: str) -> str:
    text = _ZERO_WIDTH_RE.sub(' ', str(value or ''))
    text = _QUESTION_UI_RE.sub(' ', text)
    for phrase in _QUESTION_UI_PHRASES:
        text = re.sub(re.escape(phrase), ' ', text, flags=re.IGNORECASE)
    return text


def _has_question_ui_artifact(value: str) -> bool:
    text = str(value or '')
    if _QUESTION_UI_RE.search(text):
        return True
    lowered = text.lower()
    return any(phrase.lower() in lowered for phrase in _QUESTION_UI_PHRASES)


def _strip_answer_text_artifacts(text: str, answer_texts: list[str] | None) -> str:
    result = str(text or '')
    seen: set[str] = set()
    answers: list[str] = []
    for answer_text in answer_texts or []:
        answer = collapse_whitespace(answer_text)
        answer_norm = answer.lower()
        if not answer or len(answer_norm) < 4 or answer_norm in seen:
            continue
        seen.add(answer_norm)
        answers.append(answer)

    for answer in sorted(answers, key=len, reverse=True):
        result = re.sub(
            re.escape(answer) + r'\s*\d*(?=\s|$|\D)',
            ' ',
            result,
            flags=re.IGNORECASE,
        )
    return result


def sanitize_question_prompt(prompt: str, answer_texts: list[str] | None = None) -> str:
    raw = normalize_tex_math_text(prompt)
    if not raw:
        return ''

    had_ui_artifact = _has_question_ui_artifact(raw)
    text = _strip_question_ui_phrases(raw)

    answers = answer_texts or []
    answer_hits = 0
    for answer_text in answers:
        answer = collapse_whitespace(answer_text)
        if len(answer) >= 4 and answer in text:
            answer_hits += 1

    should_strip_answers = had_ui_artifact or answer_hits >= 2 or (answer_hits >= 1 and len(raw) > 240)
    if should_strip_answers:
        text = _strip_answer_text_artifacts(text, answers)

    text = re.sub(
        r'\b(верно|неверно|правильно|неправильно|correct|incorrect|true|false)\s*:\s*',
        ' ',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r'\s*\b(верно|неверно|правильно|неправильно|correct|incorrect|true|false)\b\s*$',
        ' ',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r'\s+([?.!,;:])', r'\1', text)
    if should_strip_answers:
        text = _TRAILING_COUNT_RE.sub(' ', text)

    cleaned = collapse_whitespace(text)
    return cleaned or raw


def sanitize_answer_text(answer_text: str) -> str:
    text = normalize_tex_math_text(_strip_question_ui_phrases(answer_text))
    return re.sub(r'\s+([?.!,;:])', r'\1', text)


def looks_like_css_noise_text(value: str) -> bool:
    text = collapse_whitespace(value)
    if not text:
        return False

    declarations = _CSS_DECLARATION_RE.findall(text)
    if not declarations:
        return False

    has_css_syntax = bool(re.search(r'[{};]', text) or re.search(r'!important\b', text, re.IGNORECASE))
    if _OPENEDU_CSS_MARKER_RE.search(text) and (has_css_syntax or len(declarations) >= 1):
        return True
    if _CSS_SELECTOR_RE.search(text) and (has_css_syntax or len(declarations) >= 2):
        return True
    return len(declarations) >= 3 and has_css_syntax


def normalize_prompt(prompt: str) -> str:
    text = _NORM_PUNCT_RE.sub('', sanitize_question_prompt(prompt))
    return _NORM_WS_RE.sub(' ', text).strip().lower()


def normalize_answer_text(answer_text: str) -> str:
    text = _NORM_PUNCT_RE.sub('', sanitize_answer_text(answer_text))
    return _NORM_WS_RE.sub(' ', text).strip().lower()


def compute_question_fingerprint(prompt: str, answer_texts: list[str]) -> str:
    prompt_norm = normalize_prompt(sanitize_question_prompt(prompt, answer_texts))
    normalized_answers: list[str] = []
    seen: set[str] = set()

    for answer_text in answer_texts:
        answer_norm = normalize_answer_text(answer_text)
        if not answer_norm or answer_norm in seen:
            continue
        seen.add(answer_norm)
        normalized_answers.append(answer_norm)

    normalized_answers.sort()
    if not prompt_norm and not normalized_answers:
        return ''

    blob = json.dumps(
        {'prompt': prompt_norm, 'answers': normalized_answers},
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    )
    return hashlib.sha256(blob.encode('utf-8')).hexdigest()[:32]


def is_exact_question_content_match(
    stored_prompt_norm: str,
    stored_question_fingerprint: str,
    prompt: str,
    answer_texts: list[str],
) -> bool:
    prompt_norm = normalize_prompt(prompt)
    if not prompt_norm:
        return True

    normalized_answers = [
        normalize_answer_text(answer_text)
        for answer_text in (answer_texts or [])
    ]
    normalized_answers = [answer for answer in normalized_answers if answer]

    stored_prompt_norm = str(stored_prompt_norm or '').strip()
    stored_question_fingerprint = str(stored_question_fingerprint or '').strip()

    if normalized_answers and stored_question_fingerprint:
        return stored_question_fingerprint == compute_question_fingerprint(prompt, answer_texts)

    if stored_prompt_norm:
        return stored_prompt_norm == prompt_norm

    return True


def merge_key_order(primary: list[str], extra: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for key in [*primary, *extra]:
        value = str(key or '').strip()
        if not value or value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


class Database:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None

    @staticmethod
    def _command_count(status: str) -> int:
        try:
            return int(str(status or '').rsplit(' ', 1)[-1])
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _v2_admin_course_filter(course_id: str) -> str:
        return '' if course_id == OPENEDU_V2_UNMAPPED_COURSE_ID else str(course_id or '')

    async def connect(self) -> None:
        self.pool = await asyncpg.create_pool(
            host=settings.database_host,
            port=settings.database_port,
            user=settings.database_user,
            password=settings.database_password,
            database=settings.database_name,
            min_size=settings.database_min_connections,
            max_size=settings.database_max_connections,
            command_timeout=15,
        )
        await self._init_schema()

    async def disconnect(self) -> None:
        if self.pool:
            await self.pool.close()

    async def _init_schema(self) -> None:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id BIGSERIAL PRIMARY KEY,
                    telegram_id BIGINT UNIQUE NOT NULL,
                    telegram_username TEXT NOT NULL DEFAULT '',
                    telegram_first_name TEXT NOT NULL DEFAULT '',
                    api_token TEXT UNIQUE NOT NULL,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS openedu_tests (
                    test_key TEXT PRIMARY KEY,
                    host TEXT NOT NULL,
                    path TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS openedu_questions (
                    test_key TEXT NOT NULL,
                    question_key TEXT NOT NULL,
                    prompt TEXT NOT NULL DEFAULT '',
                    completed_count BIGINT NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (test_key, question_key)
                );

                CREATE TABLE IF NOT EXISTS openedu_answer_stats (
                    test_key TEXT NOT NULL,
                    question_key TEXT NOT NULL,
                    answer_key TEXT NOT NULL,
                    answer_text TEXT NOT NULL,
                    verified_count BIGINT NOT NULL DEFAULT 0,
                    incorrect_count BIGINT NOT NULL DEFAULT 0,
                    fallback_count BIGINT NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (test_key, question_key, answer_key)
                );

                CREATE TABLE IF NOT EXISTS openedu_participant_question_state (
                    test_key TEXT NOT NULL,
                    participant_key TEXT NOT NULL,
                    question_key TEXT NOT NULL,
                    selected_answer_keys TEXT[] NOT NULL DEFAULT '{}',
                    verified_answer_keys TEXT[] NOT NULL DEFAULT '{}',
                    incorrect_answer_keys TEXT[] NOT NULL DEFAULT '{}',
                    is_correct BOOLEAN NOT NULL DEFAULT FALSE,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (test_key, participant_key, question_key)
                );

                CREATE TABLE IF NOT EXISTS openedu_attempts (
                    id BIGSERIAL PRIMARY KEY,
                    test_key TEXT NOT NULL,
                    completed BOOLEAN NOT NULL DEFAULT FALSE,
                    source TEXT NOT NULL DEFAULT 'extension',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS extension_logs (
                    id BIGSERIAL PRIMARY KEY,
                    kind TEXT NOT NULL,
                    payload JSONB NOT NULL,
                    system JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_openedu_attempts_test_key ON openedu_attempts (test_key);
                CREATE INDEX IF NOT EXISTS idx_openedu_questions_test_key ON openedu_questions (test_key);
                CREATE INDEX IF NOT EXISTS idx_openedu_stats_test_key ON openedu_answer_stats (test_key);
                CREATE INDEX IF NOT EXISTS idx_openedu_participant_state_test_key ON openedu_participant_question_state (test_key);
                CREATE INDEX IF NOT EXISTS idx_extension_logs_kind ON extension_logs (kind);
                """
            )

            # Schema evolution — add columns / indexes that may not exist yet.
            for stmt in [
                "ALTER TABLE openedu_attempts ADD COLUMN IF NOT EXISTS fingerprint TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE openedu_attempts ADD COLUMN IF NOT EXISTS user_id BIGINT DEFAULT NULL",
                "ALTER TABLE openedu_participant_question_state ADD COLUMN IF NOT EXISTS user_id BIGINT DEFAULT NULL",
                "ALTER TABLE openedu_questions ADD COLUMN IF NOT EXISTS prompt_norm TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE openedu_questions ADD COLUMN IF NOT EXISTS question_fingerprint TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE openedu_answer_stats ADD COLUMN IF NOT EXISTS answer_norm TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE openedu_answer_stats ADD COLUMN IF NOT EXISTS incorrect_count BIGINT NOT NULL DEFAULT 0",
                "ALTER TABLE openedu_participant_question_state ADD COLUMN IF NOT EXISTS incorrect_answer_keys TEXT[] NOT NULL DEFAULT '{}'",
            ]:
                await conn.execute(stmt)

            await conn.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_openedu_attempts_fingerprint
                    ON openedu_attempts (fingerprint) WHERE fingerprint != ''
                """
            )
            await conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_openedu_questions_prompt_norm
                    ON openedu_questions (test_key, prompt_norm) WHERE prompt_norm != ''
                """
            )
            await conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_openedu_questions_fingerprint
                    ON openedu_questions (test_key, question_fingerprint) WHERE question_fingerprint != ''
                """
            )
            await conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_openedu_stats_answer_norm
                    ON openedu_answer_stats (test_key, question_key, answer_norm) WHERE answer_norm != ''
                """
            )

            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS openedu_v2_courses (
                    course_id TEXT PRIMARY KEY,
                    host TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL DEFAULT '',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS openedu_v2_chapters (
                    course_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    order_index INTEGER NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (course_id, chapter_id)
                );

                CREATE TABLE IF NOT EXISTS openedu_v2_sequentials (
                    course_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL DEFAULT '',
                    sequential_id TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    order_index INTEGER NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (course_id, sequential_id)
                );

                CREATE TABLE IF NOT EXISTS openedu_v2_verticals (
                    course_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL DEFAULT '',
                    sequential_id TEXT NOT NULL DEFAULT '',
                    vertical_id TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    order_index INTEGER NOT NULL DEFAULT 0,
                    graded BOOLEAN NOT NULL DEFAULT FALSE,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (course_id, vertical_id)
                );

                CREATE TABLE IF NOT EXISTS openedu_v2_tests (
                    test_key TEXT PRIMARY KEY,
                    host TEXT NOT NULL,
                    path TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    course_id TEXT NOT NULL DEFAULT '',
                    chapter_id TEXT NOT NULL DEFAULT '',
                    sequential_id TEXT NOT NULL DEFAULT '',
                    vertical_id TEXT NOT NULL DEFAULT '',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS openedu_v2_frames (
                    frame_key TEXT PRIMARY KEY,
                    test_key TEXT NOT NULL DEFAULT '',
                    course_id TEXT NOT NULL DEFAULT '',
                    chapter_id TEXT NOT NULL DEFAULT '',
                    sequential_id TEXT NOT NULL DEFAULT '',
                    vertical_id TEXT NOT NULL DEFAULT '',
                    problem_id TEXT NOT NULL DEFAULT '',
                    frame_url TEXT NOT NULL DEFAULT '',
                    parser_version TEXT NOT NULL DEFAULT '',
                    parser_source TEXT NOT NULL DEFAULT '',
                    question_count INTEGER NOT NULL DEFAULT 0,
                    parse_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS openedu_v2_questions (
                    test_key TEXT NOT NULL,
                    question_key TEXT NOT NULL,
                    course_id TEXT NOT NULL DEFAULT '',
                    chapter_id TEXT NOT NULL DEFAULT '',
                    sequential_id TEXT NOT NULL DEFAULT '',
                    vertical_id TEXT NOT NULL DEFAULT '',
                    problem_id TEXT NOT NULL DEFAULT '',
                    prompt TEXT NOT NULL DEFAULT '',
                    prompt_norm TEXT NOT NULL DEFAULT '',
                    question_type TEXT NOT NULL DEFAULT 'unknown',
                    question_fingerprint TEXT NOT NULL DEFAULT '',
                    extension_version TEXT NOT NULL DEFAULT '',
                    build_id TEXT NOT NULL DEFAULT '',
                    parser_version TEXT NOT NULL DEFAULT '',
                    parser_source TEXT NOT NULL DEFAULT '',
                    raw_type TEXT NOT NULL DEFAULT '',
                    parse_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                    completed_count BIGINT NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (test_key, question_key)
                );

                CREATE TABLE IF NOT EXISTS openedu_v2_answers (
                    test_key TEXT NOT NULL,
                    question_key TEXT NOT NULL,
                    answer_key TEXT NOT NULL,
                    answer_text TEXT NOT NULL DEFAULT '',
                    answer_norm TEXT NOT NULL DEFAULT '',
                    answer_fingerprint TEXT NOT NULL DEFAULT '',
                    extension_version TEXT NOT NULL DEFAULT '',
                    build_id TEXT NOT NULL DEFAULT '',
                    parser_version TEXT NOT NULL DEFAULT '',
                    verified_count BIGINT NOT NULL DEFAULT 0,
                    incorrect_count BIGINT NOT NULL DEFAULT 0,
                    fallback_count BIGINT NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (test_key, question_key, answer_key)
                );

                CREATE TABLE IF NOT EXISTS openedu_v2_participant_question_state (
                    test_key TEXT NOT NULL,
                    participant_key TEXT NOT NULL,
                    question_key TEXT NOT NULL,
                    user_id BIGINT DEFAULT NULL,
                    selected_answer_keys TEXT[] NOT NULL DEFAULT '{}',
                    verified_answer_keys TEXT[] NOT NULL DEFAULT '{}',
                    incorrect_answer_keys TEXT[] NOT NULL DEFAULT '{}',
                    is_correct BOOLEAN NOT NULL DEFAULT FALSE,
                    extension_version TEXT NOT NULL DEFAULT '',
                    build_id TEXT NOT NULL DEFAULT '',
                    parser_version TEXT NOT NULL DEFAULT '',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (test_key, participant_key, question_key)
                );

                CREATE TABLE IF NOT EXISTS openedu_v2_attempts (
                    id BIGSERIAL PRIMARY KEY,
                    test_key TEXT NOT NULL,
                    user_id BIGINT DEFAULT NULL,
                    completed BOOLEAN NOT NULL DEFAULT FALSE,
                    source TEXT NOT NULL DEFAULT 'extension',
                    fingerprint TEXT NOT NULL DEFAULT '',
                    extension_version TEXT NOT NULL DEFAULT '',
                    build_id TEXT NOT NULL DEFAULT '',
                    parser_version TEXT NOT NULL DEFAULT '',
                    platform TEXT NOT NULL DEFAULT 'openedu',
                    client_id TEXT NOT NULL DEFAULT '',
                    session_id TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS openedu_v2_parse_reports (
                    id BIGSERIAL PRIMARY KEY,
                    test_key TEXT NOT NULL DEFAULT '',
                    question_key TEXT NOT NULL DEFAULT '',
                    course_id TEXT NOT NULL DEFAULT '',
                    vertical_id TEXT NOT NULL DEFAULT '',
                    reason TEXT NOT NULL DEFAULT '',
                    prompt_preview TEXT NOT NULL DEFAULT '',
                    question_type TEXT NOT NULL DEFAULT 'unknown',
                    parser_version TEXT NOT NULL DEFAULT '',
                    parser_source TEXT NOT NULL DEFAULT '',
                    parse_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS client_logs (
                    id BIGSERIAL PRIMARY KEY,
                    user_id BIGINT DEFAULT NULL,
                    kind TEXT NOT NULL,
                    severity TEXT NOT NULL DEFAULT 'error',
                    platform TEXT NOT NULL DEFAULT '',
                    extension_version TEXT NOT NULL DEFAULT '',
                    build_id TEXT NOT NULL DEFAULT '',
                    parser_version TEXT NOT NULL DEFAULT '',
                    scope TEXT NOT NULL DEFAULT '',
                    url TEXT NOT NULL DEFAULT '',
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    system JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_openedu_v2_tests_course ON openedu_v2_tests (course_id, chapter_id, sequential_id, vertical_id);
                CREATE INDEX IF NOT EXISTS idx_openedu_v2_questions_course ON openedu_v2_questions (course_id, chapter_id, sequential_id, vertical_id);
                CREATE INDEX IF NOT EXISTS idx_openedu_v2_questions_fingerprint ON openedu_v2_questions (test_key, question_fingerprint) WHERE question_fingerprint != '';
                CREATE INDEX IF NOT EXISTS idx_openedu_v2_answers_norm ON openedu_v2_answers (test_key, question_key, answer_norm) WHERE answer_norm != '';
                CREATE INDEX IF NOT EXISTS idx_openedu_v2_attempts_test ON openedu_v2_attempts (test_key, created_at DESC);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_openedu_v2_attempts_fingerprint ON openedu_v2_attempts (fingerprint) WHERE fingerprint != '';
                CREATE INDEX IF NOT EXISTS idx_client_logs_user_created ON client_logs (user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_client_logs_kind_created ON client_logs (kind, created_at DESC);
                """
            )

            for stmt in [
                "ALTER TABLE openedu_v2_questions ADD COLUMN IF NOT EXISTS extension_version TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE openedu_v2_questions ADD COLUMN IF NOT EXISTS build_id TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE openedu_v2_questions ADD COLUMN IF NOT EXISTS parser_version TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE openedu_v2_answers ADD COLUMN IF NOT EXISTS extension_version TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE openedu_v2_answers ADD COLUMN IF NOT EXISTS build_id TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE openedu_v2_answers ADD COLUMN IF NOT EXISTS parser_version TEXT NOT NULL DEFAULT ''",
            ]:
                await conn.execute(stmt)

        await self.repair_openedu_data()

    async def _backfill_prompt_norms(self) -> None:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            # Reset broken values left by the old SQL backfill (Cyrillic was
            # stripped, leaving whitespace-only strings like ' ').
            await conn.execute(
                """
                UPDATE openedu_questions
                SET prompt_norm = ''
                WHERE prompt_norm != '' AND btrim(prompt_norm) = ''
                """
            )

            rows = await conn.fetch(
                "SELECT test_key, question_key, prompt FROM openedu_questions WHERE prompt_norm = '' AND prompt != ''"
            )
            if not rows:
                return

            updates = [
                (normalize_prompt(row['prompt']), row['test_key'], row['question_key'])
                for row in rows
            ]
            # Filter out rows where normalization yields empty string.
            updates = [u for u in updates if u[0]]

            if updates:
                await conn.executemany(
                    "UPDATE openedu_questions SET prompt_norm = $1 WHERE test_key = $2 AND question_key = $3",
                    updates,
                )

    async def _backfill_question_fingerprints(self) -> None:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    q.test_key,
                    q.question_key,
                    q.prompt,
                    COALESCE(array_agg(s.answer_text) FILTER (WHERE s.answer_text != ''), '{}') AS answer_texts
                FROM openedu_questions q
                LEFT JOIN openedu_answer_stats s
                    ON s.test_key = q.test_key
                    AND s.question_key = q.question_key
                WHERE q.question_fingerprint = ''
                GROUP BY q.test_key, q.question_key, q.prompt
                """
            )
            if not rows:
                return

            updates = []
            for row in rows:
                fingerprint = compute_question_fingerprint(
                    str(row['prompt'] or ''),
                    list(row['answer_texts'] or []),
                )
                if not fingerprint:
                    continue
                updates.append((fingerprint, row['test_key'], row['question_key']))

            if updates:
                await conn.executemany(
                    "UPDATE openedu_questions SET question_fingerprint = $1 WHERE test_key = $2 AND question_key = $3",
                    updates,
                )

    async def _sanitize_openedu_questions(self, limit: int = 10000) -> int:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    q.test_key,
                    q.question_key,
                    q.prompt,
                    COALESCE(array_agg(s.answer_text) FILTER (WHERE s.answer_text != ''), '{}') AS answer_texts
                FROM openedu_questions q
                LEFT JOIN openedu_answer_stats s
                    ON s.test_key = q.test_key
                    AND s.question_key = q.question_key
                WHERE q.prompt != ''
                  AND (
                    q.prompt ILIKE '%MooDuSh%'
                    OR q.prompt ILIKE '%Вставить%'
                    OR q.prompt ILIKE '%Нет статистики%'
                    OR q.prompt ILIKE '%Ответы%'
                    OR POSITION(chr(92) IN q.prompt) > 0
                    OR q.prompt LIKE '%$%'
                    OR length(q.prompt) > 240
                  )
                GROUP BY q.test_key, q.question_key, q.prompt
                ORDER BY MAX(q.updated_at) DESC
                LIMIT $1
                """,
                limit,
            )
            updates = []
            for row in rows:
                answer_texts = [sanitize_answer_text(str(item or '')) for item in (row['answer_texts'] or [])]
                clean_prompt = sanitize_question_prompt(str(row['prompt'] or ''), answer_texts)
                if not clean_prompt or clean_prompt == str(row['prompt'] or ''):
                    continue
                updates.append(
                    (
                        clean_prompt,
                        normalize_prompt(clean_prompt),
                        compute_question_fingerprint(clean_prompt, answer_texts),
                        row['test_key'],
                        row['question_key'],
                    )
                )

            if not updates:
                return 0

            await conn.executemany(
                """
                UPDATE openedu_questions
                SET prompt = $1,
                    prompt_norm = $2,
                    question_fingerprint = $3,
                    updated_at = NOW()
                WHERE test_key = $4 AND question_key = $5
                """,
                updates,
            )
            return len(updates)

    async def _sanitize_openedu_answer_stats(self, limit: int = 10000) -> int:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT test_key, question_key, answer_key, answer_text, answer_norm
                FROM openedu_answer_stats
                WHERE answer_norm = ''
                   OR answer_text ILIKE '%MooDuSh%'
                   OR answer_text ILIKE '%Вставить%'
                   OR POSITION(chr(92) IN answer_text) > 0
                   OR answer_text LIKE '%$%'
                ORDER BY updated_at DESC
                LIMIT $1
                """,
                limit,
            )
            updates = []
            for row in rows:
                answer_text = sanitize_answer_text(str(row['answer_text'] or ''))
                answer_norm = normalize_answer_text(answer_text)
                if answer_text == str(row['answer_text'] or '') and answer_norm == str(row['answer_norm'] or ''):
                    continue
                updates.append(
                    (
                        answer_text,
                        answer_norm,
                        row['test_key'],
                        row['question_key'],
                        row['answer_key'],
                    )
                )

            if not updates:
                return 0

            await conn.executemany(
                """
                UPDATE openedu_answer_stats
                SET answer_text = $1,
                    answer_norm = $2,
                    updated_at = NOW()
                WHERE test_key = $3 AND question_key = $4 AND answer_key = $5
                """,
                updates,
            )
            return len(updates)

    async def _backfill_answer_norms(self) -> None:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT test_key, question_key, answer_key, answer_text
                FROM openedu_answer_stats
                WHERE answer_norm = '' AND answer_text != ''
                LIMIT 5000
                """
            )
            updates = []
            for row in rows:
                answer_norm = normalize_answer_text(str(row['answer_text'] or ''))
                if not answer_norm:
                    continue
                updates.append(
                    (
                        answer_norm,
                        row['test_key'],
                        row['question_key'],
                        row['answer_key'],
                    )
                )
            if updates:
                await conn.executemany(
                    """
                    UPDATE openedu_answer_stats
                    SET answer_norm = $1
                    WHERE test_key = $2 AND question_key = $3 AND answer_key = $4
                    """,
                    updates,
                )

    def _pick_answer_text(self, current: str, candidate: str) -> str:
        current_text = sanitize_answer_text(current)
        candidate_text = sanitize_answer_text(candidate)
        if not current_text:
            return candidate_text
        if not candidate_text:
            return current_text
        if _has_question_ui_artifact(current_text) and not _has_question_ui_artifact(candidate_text):
            return candidate_text
        if len(candidate_text) > len(current_text) and len(current_text) < 4:
            return candidate_text
        return current_text

    async def _merge_duplicate_openedu_answers(self) -> None:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            groups = await conn.fetch(
                """
                SELECT test_key, question_key, answer_norm, array_agg(answer_key ORDER BY answer_key) AS answer_keys
                FROM openedu_answer_stats
                WHERE answer_norm != ''
                GROUP BY test_key, question_key, answer_norm
                HAVING COUNT(*) > 1
                LIMIT 300
                """
            )
            if not groups:
                return

            async with conn.transaction():
                for group in groups:
                    test_key = group['test_key']
                    question_key = group['question_key']
                    answer_norm = group['answer_norm']
                    rows = await conn.fetch(
                        """
                        SELECT answer_key, answer_text, verified_count, incorrect_count, fallback_count, updated_at
                        FROM openedu_answer_stats
                        WHERE test_key = $1 AND question_key = $2 AND answer_norm = $3
                        ORDER BY (verified_count + incorrect_count + fallback_count) DESC, updated_at DESC, answer_key ASC
                        """,
                        test_key,
                        question_key,
                        answer_norm,
                    )
                    if len(rows) < 2:
                        continue

                    canonical = rows[0]
                    canonical_key = canonical['answer_key']
                    answer_text = str(canonical['answer_text'] or '')

                    for duplicate in rows[1:]:
                        duplicate_key = duplicate['answer_key']
                        if duplicate_key == canonical_key:
                            continue

                        answer_text = self._pick_answer_text(answer_text, str(duplicate['answer_text'] or ''))
                        await conn.execute(
                            """
                            UPDATE openedu_answer_stats
                            SET verified_count = verified_count + $4,
                                incorrect_count = incorrect_count + $5,
                                fallback_count = fallback_count + $6,
                                answer_text = $7,
                                answer_norm = $8,
                                updated_at = NOW()
                            WHERE test_key = $1 AND question_key = $2 AND answer_key = $3
                            """,
                            test_key,
                            question_key,
                            canonical_key,
                            int(duplicate['verified_count'] or 0),
                            int(duplicate['incorrect_count'] or 0),
                            int(duplicate['fallback_count'] or 0),
                            answer_text,
                            answer_norm,
                        )
                        await conn.execute(
                            """
                            UPDATE openedu_participant_question_state
                            SET selected_answer_keys = ARRAY(
                                    SELECT DISTINCT item
                                    FROM unnest(array_replace(selected_answer_keys, $4, $3)) AS item
                                    WHERE item != ''
                                    ORDER BY item
                                ),
                                verified_answer_keys = ARRAY(
                                    SELECT DISTINCT item
                                    FROM unnest(array_replace(verified_answer_keys, $4, $3)) AS item
                                    WHERE item != ''
                                    ORDER BY item
                                ),
                                incorrect_answer_keys = ARRAY(
                                    SELECT DISTINCT item
                                    FROM unnest(array_replace(incorrect_answer_keys, $4, $3)) AS item
                                    WHERE item != ''
                                    ORDER BY item
                                ),
                                updated_at = NOW()
                            WHERE test_key = $1 AND question_key = $2
                              AND ($4 = ANY(selected_answer_keys) OR $4 = ANY(verified_answer_keys) OR $4 = ANY(incorrect_answer_keys))
                            """,
                            test_key,
                            question_key,
                            canonical_key,
                            duplicate_key,
                        )
                        await conn.execute(
                            """
                            DELETE FROM openedu_answer_stats
                            WHERE test_key = $1 AND question_key = $2 AND answer_key = $3
                            """,
                            test_key,
                            question_key,
                            duplicate_key,
                        )

    async def repair_openedu_data(self) -> dict[str, int]:
        """Normalize old OpenEdu rows and collapse safe duplicates."""
        fixed_questions = await self._sanitize_openedu_questions()
        fixed_answers = await self._sanitize_openedu_answer_stats()
        await self._backfill_prompt_norms()
        await self._backfill_answer_norms()
        await self._backfill_question_fingerprints()
        await self._merge_duplicate_openedu_answers()
        await self._merge_duplicate_openedu_questions()
        await self._merge_duplicate_openedu_answers()
        await self._repair_openedu_v2_hierarchy()
        return {'questions': fixed_questions, 'answers': fixed_answers}

    async def _repair_openedu_v2_hierarchy(self) -> None:
        """Backfill V2 hierarchy on rows that were saved before course metadata arrived."""
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE openedu_v2_tests t
                SET chapter_id = COALESCE(NULLIF(t.chapter_id, ''), NULLIF(v.chapter_id, ''), t.chapter_id),
                    sequential_id = COALESCE(NULLIF(t.sequential_id, ''), NULLIF(v.sequential_id, ''), t.sequential_id),
                    updated_at = NOW()
                FROM openedu_v2_verticals v
                WHERE t.course_id = v.course_id
                  AND t.vertical_id = v.vertical_id
                  AND t.vertical_id != ''
                  AND (t.chapter_id = '' OR t.sequential_id = '')
                """
            )
            await conn.execute(
                """
                UPDATE openedu_v2_questions q
                SET course_id = COALESCE(NULLIF(q.course_id, ''), NULLIF(v.course_id, ''), q.course_id),
                    chapter_id = COALESCE(NULLIF(q.chapter_id, ''), NULLIF(v.chapter_id, ''), q.chapter_id),
                    sequential_id = COALESCE(NULLIF(q.sequential_id, ''), NULLIF(v.sequential_id, ''), q.sequential_id),
                    updated_at = NOW()
                FROM openedu_v2_verticals v
                WHERE q.vertical_id = v.vertical_id
                  AND q.vertical_id != ''
                  AND (q.course_id = '' OR q.course_id = v.course_id)
                  AND (q.course_id = '' OR q.chapter_id = '' OR q.sequential_id = '')
                """
            )
            await conn.execute(
                """
                UPDATE openedu_v2_questions q
                SET course_id = COALESCE(NULLIF(q.course_id, ''), NULLIF(t.course_id, ''), q.course_id),
                    chapter_id = COALESCE(NULLIF(q.chapter_id, ''), NULLIF(t.chapter_id, ''), q.chapter_id),
                    sequential_id = COALESCE(NULLIF(q.sequential_id, ''), NULLIF(t.sequential_id, ''), q.sequential_id),
                    vertical_id = COALESCE(NULLIF(q.vertical_id, ''), NULLIF(t.vertical_id, ''), q.vertical_id),
                    updated_at = NOW()
                FROM openedu_v2_tests t
                WHERE q.test_key = t.test_key
                  AND (q.course_id = '' OR q.chapter_id = '' OR q.sequential_id = '' OR q.vertical_id = '')
                """
            )

    async def run_repair_worker(self) -> None:
        interval = max(30, int(settings.database_repair_interval_seconds or 300))
        while True:
            try:
                await self.repair_openedu_data()
            except Exception as exc:
                print(f'OpenEdu repair worker failed: {exc}')
            await asyncio.sleep(interval)

    async def _merge_duplicate_openedu_questions(self) -> None:
        """Collapse old OpenEdu rows that only differ by unstable question keys."""
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            groups = await conn.fetch(
                """
                SELECT test_key, array_agg(question_key ORDER BY question_key) AS question_keys
                FROM openedu_questions
                WHERE question_fingerprint != '' AND question_key LIKE 'q2_%'
                GROUP BY test_key, question_fingerprint
                HAVING COUNT(*) > 1
                UNION
                SELECT test_key, array_agg(question_key ORDER BY question_key) AS question_keys
                FROM openedu_questions
                WHERE prompt_norm != '' AND question_key LIKE 'q2_%'
                GROUP BY test_key, prompt_norm
                HAVING COUNT(*) > 1
                LIMIT 200
                """
            )
            if not groups:
                return

            async with conn.transaction():
                for group in groups:
                    test_key = group['test_key']
                    question_keys = [str(key) for key in (group['question_keys'] or []) if str(key)]
                    existing_rows = await conn.fetch(
                        """
                        SELECT question_key
                        FROM openedu_questions
                        WHERE test_key = $1 AND question_key = ANY($2::text[])
                        """,
                        test_key,
                        question_keys,
                    )
                    question_keys = [str(row['question_key']) for row in existing_rows]
                    if len(question_keys) < 2:
                        continue

                    canonical_key = sorted(
                        question_keys,
                        key=lambda key: (0 if '_' not in key[3:] else 1, len(key), key),
                    )[0]
                    duplicate_keys = [key for key in question_keys if key != canonical_key]
                    if not duplicate_keys:
                        continue

                    for duplicate_key in duplicate_keys:
                        stat_rows = await conn.fetch(
                            """
                            SELECT answer_key, answer_text, answer_norm, verified_count, incorrect_count, fallback_count
                            FROM openedu_answer_stats
                            WHERE test_key = $1 AND question_key = $2
                            """,
                            test_key,
                            duplicate_key,
                        )
                        for row in stat_rows:
                            await conn.execute(
                                """
                                INSERT INTO openedu_answer_stats
                                    (test_key, question_key, answer_key, answer_text, answer_norm, verified_count, incorrect_count, fallback_count, updated_at)
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                                ON CONFLICT (test_key, question_key, answer_key)
                                DO UPDATE SET answer_text = COALESCE(NULLIF(openedu_answer_stats.answer_text, ''), EXCLUDED.answer_text),
                                              answer_norm = COALESCE(NULLIF(openedu_answer_stats.answer_norm, ''), EXCLUDED.answer_norm),
                                              verified_count = openedu_answer_stats.verified_count + EXCLUDED.verified_count,
                                              incorrect_count = openedu_answer_stats.incorrect_count + EXCLUDED.incorrect_count,
                                              fallback_count = openedu_answer_stats.fallback_count + EXCLUDED.fallback_count,
                                              updated_at = NOW()
                                """,
                                test_key,
                                canonical_key,
                                row['answer_key'],
                                row['answer_text'],
                                row['answer_norm'] or normalize_answer_text(str(row['answer_text'] or '')),
                                int(row['verified_count'] or 0),
                                int(row['incorrect_count'] or 0),
                                int(row['fallback_count'] or 0),
                            )

                        await conn.execute(
                            "DELETE FROM openedu_answer_stats WHERE test_key = $1 AND question_key = $2",
                            test_key,
                            duplicate_key,
                        )
                        await conn.execute(
                            """
                            INSERT INTO openedu_participant_question_state
                                (test_key, participant_key, question_key, selected_answer_keys, verified_answer_keys, incorrect_answer_keys, is_correct, user_id, updated_at)
                            SELECT test_key, participant_key, $1, selected_answer_keys, verified_answer_keys, incorrect_answer_keys, is_correct, user_id, NOW()
                            FROM openedu_participant_question_state
                            WHERE test_key = $2 AND question_key = $3
                            ON CONFLICT (test_key, participant_key, question_key)
                            DO UPDATE SET selected_answer_keys = ARRAY(
                                              SELECT DISTINCT item
                                              FROM unnest(openedu_participant_question_state.selected_answer_keys || EXCLUDED.selected_answer_keys) AS item
                                              WHERE item != ''
                                              ORDER BY item
                                          ),
                                          verified_answer_keys = ARRAY(
                                              SELECT DISTINCT item
                                              FROM unnest(openedu_participant_question_state.verified_answer_keys || EXCLUDED.verified_answer_keys) AS item
                                              WHERE item != ''
                                              ORDER BY item
                                          ),
                                          incorrect_answer_keys = ARRAY(
                                              SELECT DISTINCT item
                                              FROM unnest(openedu_participant_question_state.incorrect_answer_keys || EXCLUDED.incorrect_answer_keys) AS item
                                              WHERE item != ''
                                              ORDER BY item
                                          ),
                                          is_correct = openedu_participant_question_state.is_correct OR EXCLUDED.is_correct,
                                          user_id = COALESCE(EXCLUDED.user_id, openedu_participant_question_state.user_id),
                                          updated_at = NOW()
                            """,
                            canonical_key,
                            test_key,
                            duplicate_key,
                        )
                        await conn.execute(
                            "DELETE FROM openedu_participant_question_state WHERE test_key = $1 AND question_key = $2",
                            test_key,
                            duplicate_key,
                        )
                        await conn.execute(
                            """
                            UPDATE openedu_questions canonical
                            SET completed_count = canonical.completed_count + duplicate.completed_count,
                                updated_at = GREATEST(canonical.updated_at, duplicate.updated_at)
                            FROM openedu_questions duplicate
                            WHERE canonical.test_key = $1
                              AND canonical.question_key = $2
                              AND duplicate.test_key = $1
                              AND duplicate.question_key = $3
                            """,
                            test_key,
                            canonical_key,
                            duplicate_key,
                        )
                        await conn.execute(
                            "DELETE FROM openedu_questions WHERE test_key = $1 AND question_key = $2",
                            test_key,
                            duplicate_key,
                        )

    # ── Users ──────────────────────────────────────────────────────

    async def get_user_by_token(self, token: str) -> asyncpg.Record | None:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(
                "SELECT * FROM users WHERE api_token = $1 AND is_active = TRUE",
                token,
            )

    async def get_user_by_telegram_id(self, telegram_id: int) -> asyncpg.Record | None:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(
                "SELECT * FROM users WHERE telegram_id = $1",
                telegram_id,
            )

    async def create_user(self, telegram_id: int, username: str, first_name: str) -> asyncpg.Record:
        assert self.pool is not None
        token = str(uuid.uuid4())
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(
                """
                INSERT INTO users (telegram_id, telegram_username, telegram_first_name, api_token)
                VALUES ($1, $2, $3, $4)
                RETURNING *
                """,
                telegram_id,
                username,
                first_name,
                token,
            )

    async def regenerate_user_token(self, user_id: int) -> str:
        assert self.pool is not None
        new_token = str(uuid.uuid4())
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE users SET api_token = $1 WHERE id = $2",
                new_token,
                user_id,
            )
        return new_token

    async def touch_user_activity(self, user_id: int) -> None:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE users SET last_active_at = NOW() WHERE id = $1",
                user_id,
            )

    async def get_user_stats(self, telegram_id: int) -> dict[str, Any]:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            user = await conn.fetchrow(
                "SELECT id, participant_key FROM (SELECT id, 'p_' || id::text AS participant_key FROM users WHERE telegram_id = $1) u",
                telegram_id,
            )
            if not user:
                return {'tests': 0, 'questions': 0, 'completions': 0}

            row = await conn.fetchrow(
                """
                SELECT
                    COUNT(DISTINCT test_key) AS tests,
                    COUNT(*) AS questions,
                    COUNT(*) FILTER (WHERE is_correct) AS completions
                FROM openedu_participant_question_state
                WHERE user_id = $1
                """,
                user['id'],
            )
            return {
                'tests': int(row['tests']) if row else 0,
                'questions': int(row['questions']) if row else 0,
                'completions': int(row['completions']) if row else 0,
            }

    # ── OpenEdu attempts ───────────────────────────────────────────

    @staticmethod
    def _compute_attempt_fingerprint(context: dict, questions: list, actor_key: str) -> str:
        normalized_questions = []
        for q in questions:
            raw_answers = q.get('answers', []) if isinstance(q, dict) else []
            answer_texts = [
                sanitize_answer_text(str(a.get('answerText') or ''))
                for a in raw_answers
                if isinstance(a, dict) and str(a.get('inputType') or '') != 'text'
            ]
            question_identity = compute_question_fingerprint(
                str(q.get('prompt') or '') if isinstance(q, dict) else '',
                answer_texts,
            ) or (str(q.get('questionKey') or '') if isinstance(q, dict) else '')
            normalized_questions.append(
                {
                    'questionIdentity': question_identity,
                    'isCorrect': bool(q.get('isCorrect')) if isinstance(q, dict) else False,
                    'answers': sorted(
                        [
                            {
                                'answerIdentity': normalize_answer_text(str(a.get('answerText') or '')) or str(a.get('answerKey') or ''),
                                'selected': bool(a.get('selected')),
                                'correct': bool(a.get('correct')),
                                'incorrect': bool(a.get('incorrect')),
                                'inputType': str(a.get('inputType') or ''),
                            }
                            for a in raw_answers
                            if isinstance(a, dict)
                        ],
                        key=lambda a: a['answerIdentity'],
                    ),
                }
            )

        blob = json.dumps({
            'actorKey': actor_key,
            'testKey': context.get('testKey', ''),
            'path': context.get('path', ''),
            'questions': sorted(normalized_questions, key=lambda q: q['questionIdentity']),
        }, sort_keys=True)
        return hashlib.sha256(blob.encode()).hexdigest()[:32]

    async def _resolve_storage_question_key(
        self,
        conn,
        test_key: str,
        question_key: str,
        prompt_norm: str,
        question_fingerprint: str,
        stable_answer_count: int = 0,
    ) -> str:
        if question_fingerprint:
            existing_by_content = await conn.fetchrow(
                """
                SELECT question_key
                FROM openedu_questions
                WHERE test_key = $1
                  AND question_fingerprint = $2
                  AND question_fingerprint != ''
                ORDER BY completed_count DESC, updated_at DESC, question_key ASC
                LIMIT 1
                """,
                test_key,
                question_fingerprint,
            )
            if existing_by_content:
                return str(existing_by_content['question_key'])

        if stable_answer_count == 0 and prompt_norm:
            existing_by_prompt = await conn.fetchrow(
                """
                SELECT question_key
                FROM openedu_questions
                WHERE test_key = $1
                  AND prompt_norm = $2
                  AND prompt_norm != ''
                ORDER BY completed_count DESC, updated_at DESC, question_key ASC
                LIMIT 1
                """,
                test_key,
                prompt_norm,
            )
            if existing_by_prompt:
                return str(existing_by_prompt['question_key'])

        existing_by_key = await conn.fetchrow(
            """
            SELECT prompt_norm, question_fingerprint
            FROM openedu_questions
            WHERE test_key = $1 AND question_key = $2
            """,
            test_key,
            question_key,
        )
        if not existing_by_key:
            return question_key

        stored_fingerprint = str(existing_by_key['question_fingerprint'] or '')
        stored_prompt_norm = str(existing_by_key['prompt_norm'] or '')
        fingerprint_conflict = bool(
            question_fingerprint
            and stored_fingerprint
            and stored_fingerprint != question_fingerprint
        )
        prompt_conflict = bool(
            question_fingerprint
            and prompt_norm
            and stored_prompt_norm
            and stored_prompt_norm != prompt_norm
        )
        if not fingerprint_conflict and not prompt_conflict:
            return question_key

        suffix = (question_fingerprint or hashlib.sha256(prompt_norm.encode('utf-8')).hexdigest())[:10]
        return f'{question_key}_fp_{suffix}'

    async def _resolve_storage_answer_key(
        self,
        conn,
        test_key: str,
        question_key: str,
        answer_key: str,
        answer_norm: str,
    ) -> str:
        if not answer_norm:
            return answer_key

        existing = await conn.fetchrow(
            """
            SELECT answer_key
                FROM openedu_answer_stats
                WHERE test_key = $1
                  AND question_key = $2
                  AND answer_norm = $3
                  AND answer_norm != ''
            ORDER BY (verified_count + incorrect_count + fallback_count) DESC, updated_at DESC, answer_key ASC
            LIMIT 1
            """,
            test_key,
            question_key,
            answer_norm,
        )
        if existing:
            return str(existing['answer_key'])
        return answer_key

    async def upsert_openedu_attempt(self, payload: dict[str, Any], user_id: int | None = None) -> None:
        assert self.pool is not None
        context = payload['context']
        questions = payload.get('questions', [])
        completed = bool(payload.get('completed', False))
        participant_key = str(context.get('participantKey') or '').strip() or 'anonymous'
        actor_key = f'user:{user_id}' if user_id is not None else f'participant:{participant_key}'
        fingerprint = self._compute_attempt_fingerprint(context, questions, actor_key)

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """
                    INSERT INTO openedu_tests (test_key, host, path, title, updated_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (test_key)
                    DO UPDATE SET host = EXCLUDED.host, path = EXCLUDED.path, title = EXCLUDED.title, updated_at = NOW()
                    """,
                    context['testKey'],
                    context['host'],
                    context['path'],
                    context.get('title', ''),
                )

                attempt_id = await conn.fetchval(
                    """
                    INSERT INTO openedu_attempts (test_key, completed, source, fingerprint, user_id)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (fingerprint) WHERE fingerprint != ''
                    DO NOTHING
                    RETURNING id
                    """,
                    context['testKey'],
                    completed,
                    payload.get('source', 'extension'),
                    fingerprint,
                    user_id,
                )

                if attempt_id is None:
                    await conn.execute(
                        """
                        UPDATE openedu_attempts
                        SET completed = $2,
                            user_id = COALESCE($3, user_id)
                        WHERE fingerprint = $1
                          AND fingerprint != ''
                        """,
                        fingerprint,
                        completed,
                        user_id,
                    )
                    return

                for question in questions:
                    question_key = str(question.get('questionKey') or '').strip()
                    if not question_key:
                        continue

                    question_correct = bool(question.get('isCorrect'))
                    answers = question.get('answers', [])
                    selected_answers_count = sum(1 for a in answers if bool(a.get('selected')))
                    explicit_correct_answers_count = sum(1 for a in answers if bool(a.get('correct')))
                    has_explicit_correct_answers = explicit_correct_answers_count > 0

                    if has_explicit_correct_answers and selected_answers_count <= 1 and explicit_correct_answers_count > 1:
                        has_explicit_correct_answers = False

                    raw_answer_entries: list[dict[str, Any]] = []
                    for answer in answers:
                        answer_key = str(answer.get('answerKey') or '').strip()
                        if not answer_key:
                            continue
                        answer_text = sanitize_answer_text(str(answer.get('answerText') or ''))
                        answer_norm = normalize_answer_text(answer_text)
                        raw_answer_entries.append(
                            {
                                'answer_key': answer_key,
                                'answer_text': answer_text,
                                'answer_norm': answer_norm,
                                'selected': bool(answer.get('selected')),
                                'correct': bool(answer.get('correct')),
                                'incorrect': bool(answer.get('incorrect')),
                                'input_type': str(answer.get('inputType') or ''),
                            }
                        )

                    answer_texts = [
                        entry['answer_text']
                        for entry in raw_answer_entries
                        if entry['answer_text'] and entry['input_type'] != 'text'
                    ]
                    prompt_raw = sanitize_question_prompt(str(question.get('prompt') or ''), answer_texts)
                    prompt_norm = normalize_prompt(prompt_raw)
                    question_fingerprint = compute_question_fingerprint(prompt_raw, answer_texts)
                    question_key = await self._resolve_storage_question_key(
                        conn,
                        context['testKey'],
                        question_key,
                        prompt_norm,
                        question_fingerprint,
                        len(answer_texts),
                    )
                    await conn.execute(
                        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
                        context['testKey'],
                        participant_key + '|' + question_key,
                    )

                    answer_text_by_key: dict[str, str] = {}
                    answer_norm_by_key: dict[str, str] = {}
                    selected_answer_keys: set[str] = set()
                    current_verified_answer_keys: set[str] = set()
                    current_incorrect_answer_keys: set[str] = set()

                    for entry in raw_answer_entries:
                        answer_key = await self._resolve_storage_answer_key(
                            conn,
                            context['testKey'],
                            question_key,
                            entry['answer_key'],
                            entry['answer_norm'],
                        )
                        answer_text_by_key[answer_key] = self._pick_answer_text(
                            answer_text_by_key.get(answer_key, ''),
                            entry['answer_text'],
                        )
                        answer_norm_by_key[answer_key] = entry['answer_norm']
                        if entry['selected']:
                            selected_answer_keys.add(answer_key)
                        if (
                            question_correct
                            and has_explicit_correct_answers
                            and entry['selected']
                            and entry['correct']
                        ):
                            current_verified_answer_keys.add(answer_key)
                        if entry['selected'] and entry['incorrect']:
                            current_incorrect_answer_keys.add(answer_key)

                    previous_state = await conn.fetchrow(
                        """
                        SELECT selected_answer_keys, verified_answer_keys, incorrect_answer_keys, is_correct
                        FROM openedu_participant_question_state
                        WHERE test_key = $1 AND participant_key = $2 AND question_key = $3
                        """,
                        context['testKey'],
                        participant_key,
                        question_key,
                    )

                    prev_selected_keys = set(previous_state['selected_answer_keys'] or []) if previous_state else set()
                    prev_verified_keys = set(previous_state['verified_answer_keys'] or []) if previous_state else set()
                    prev_incorrect_keys = set(previous_state['incorrect_answer_keys'] or []) if previous_state else set()
                    prev_is_correct = bool(previous_state['is_correct']) if previous_state else False

                    # Verified answers are permanent: merge with previous,
                    # never remove, never decrement.
                    verified_answer_keys = current_verified_answer_keys | prev_verified_keys
                    incorrect_answer_keys = current_incorrect_answer_keys | prev_incorrect_keys

                    # Once marked correct, stay correct permanently.
                    if prev_is_correct:
                        question_correct = True

                    completed_delta = 0
                    if question_correct and not prev_is_correct:
                        completed_delta = 1

                    await conn.execute(
                        """
                        INSERT INTO openedu_questions (test_key, question_key, prompt, prompt_norm, question_fingerprint, completed_count, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, NOW())
                        ON CONFLICT (test_key, question_key)
                        DO UPDATE SET prompt = CASE
                                          WHEN EXCLUDED.prompt != '' THEN EXCLUDED.prompt
                                          ELSE openedu_questions.prompt
                                      END,
                                      prompt_norm = COALESCE(NULLIF(EXCLUDED.prompt_norm, ''), openedu_questions.prompt_norm),
                                      question_fingerprint = COALESCE(NULLIF(EXCLUDED.question_fingerprint, ''), openedu_questions.question_fingerprint),
                                      completed_count = GREATEST(0, openedu_questions.completed_count + $6),
                                      updated_at = NOW()
                        """,
                        context['testKey'],
                        question_key,
                        prompt_raw,
                        prompt_norm,
                        question_fingerprint,
                        completed_delta,
                    )

                    # Counts are per participant-state delta. The same actor can
                    # send several slightly different DOM snapshots for one
                    # submit, so repeated identical answer facts must be idempotent.
                    selected_increment_keys = selected_answer_keys - prev_selected_keys
                    verified_increment_keys = current_verified_answer_keys - prev_verified_keys
                    incorrect_increment_keys = current_incorrect_answer_keys - prev_incorrect_keys
                    stored_selected_answer_keys = selected_answer_keys | prev_selected_keys

                    for answer_key in (selected_increment_keys | verified_increment_keys | incorrect_increment_keys):
                        selected_inc = 1 if answer_key in selected_increment_keys else 0
                        verified_inc = 1 if answer_key in verified_increment_keys else 0
                        incorrect_inc = 1 if answer_key in incorrect_increment_keys else 0
                        if selected_inc == 0 and verified_inc == 0 and incorrect_inc == 0:
                            continue
                        await conn.execute(
                            """
                            INSERT INTO openedu_answer_stats (test_key, question_key, answer_key, answer_text, answer_norm, verified_count, incorrect_count, fallback_count, updated_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                            ON CONFLICT (test_key, question_key, answer_key)
                            DO UPDATE SET answer_text = COALESCE(NULLIF(EXCLUDED.answer_text, ''), openedu_answer_stats.answer_text),
                                          answer_norm = COALESCE(NULLIF(EXCLUDED.answer_norm, ''), openedu_answer_stats.answer_norm),
                                          verified_count = openedu_answer_stats.verified_count + EXCLUDED.verified_count,
                                          incorrect_count = openedu_answer_stats.incorrect_count + EXCLUDED.incorrect_count,
                                          fallback_count = openedu_answer_stats.fallback_count + EXCLUDED.fallback_count,
                                          updated_at = NOW()
                            """,
                            context['testKey'], question_key, answer_key,
                            answer_text_by_key.get(answer_key, ''),
                            answer_norm_by_key.get(answer_key, ''),
                            verified_inc, incorrect_inc, selected_inc,
                        )

                    await conn.execute(
                        """
                        INSERT INTO openedu_participant_question_state
                            (test_key, participant_key, question_key, selected_answer_keys, verified_answer_keys, incorrect_answer_keys, is_correct, user_id, updated_at)
                        VALUES ($1, $2, $3, $4::text[], $5::text[], $6::text[], $7, $8, NOW())
                        ON CONFLICT (test_key, participant_key, question_key)
                        DO UPDATE SET selected_answer_keys = EXCLUDED.selected_answer_keys,
                                      verified_answer_keys = EXCLUDED.verified_answer_keys,
                                      incorrect_answer_keys = EXCLUDED.incorrect_answer_keys,
                                      is_correct = EXCLUDED.is_correct,
                                      user_id = COALESCE(EXCLUDED.user_id, openedu_participant_question_state.user_id),
                                      updated_at = NOW()
                        """,
                        context['testKey'], participant_key, question_key,
                        sorted(stored_selected_answer_keys), sorted(verified_answer_keys), sorted(incorrect_answer_keys),
                        question_correct, user_id,
                    )

    # ── OpenEdu V2 attempts ───────────────────────────────────────

    def _v2_question_quarantine_reason(self, question: dict[str, Any], answer_texts: list[str]) -> str:
        prompt = collapse_whitespace(question.get('prompt', ''))
        confidence = float(question.get('parseConfidence') or 0)
        question_type = str(question.get('questionType') or 'unknown').strip().lower()
        if not prompt:
            return 'empty_prompt'
        if looks_like_css_noise_text(prompt):
            return 'css_prompt_noise'
        if len(prompt) > 12000:
            return 'prompt_too_large'
        if question_type in {'', 'unknown', 'unsupported'}:
            return 'unknown_question_type'
        if confidence < 0.45:
            return 'low_confidence'
        if len(answer_texts) > 80:
            return 'too_many_answers'
        return ''

    @staticmethod
    def _safe_json(value: Any) -> str:
        return json.dumps(value or {}, ensure_ascii=False, sort_keys=True, default=str)

    async def _upsert_openedu_v2_hierarchy(self, conn, context: dict[str, Any], course: dict[str, Any]) -> None:
        course_id = str(course.get('courseId') or context.get('courseId') or '').strip()
        if not course_id:
            return

        await conn.execute(
            """
            INSERT INTO openedu_v2_courses (course_id, host, title, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (course_id)
            DO UPDATE SET host = COALESCE(NULLIF(EXCLUDED.host, ''), openedu_v2_courses.host),
                          title = COALESCE(NULLIF(EXCLUDED.title, ''), openedu_v2_courses.title),
                          updated_at = NOW()
            """,
            course_id,
            str(context.get('host') or ''),
            str(course.get('courseTitle') or context.get('title') or ''),
        )

        chapter_id = str(course.get('chapterId') or '').strip()
        if chapter_id:
            await conn.execute(
                """
                INSERT INTO openedu_v2_chapters (course_id, chapter_id, title, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (course_id, chapter_id)
                DO UPDATE SET title = COALESCE(NULLIF(EXCLUDED.title, ''), openedu_v2_chapters.title),
                              updated_at = NOW()
                """,
                course_id,
                chapter_id,
                str(course.get('chapterTitle') or ''),
            )

        sequential_id = str(course.get('sequentialId') or '').strip()
        if sequential_id:
            await conn.execute(
                """
                INSERT INTO openedu_v2_sequentials (course_id, chapter_id, sequential_id, title, updated_at)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (course_id, sequential_id)
                DO UPDATE SET chapter_id = COALESCE(NULLIF(EXCLUDED.chapter_id, ''), openedu_v2_sequentials.chapter_id),
                              title = COALESCE(NULLIF(EXCLUDED.title, ''), openedu_v2_sequentials.title),
                              updated_at = NOW()
                """,
                course_id,
                chapter_id,
                sequential_id,
                str(course.get('sequentialTitle') or ''),
            )

        vertical_id = str(course.get('verticalId') or '').strip()
        if vertical_id:
            await conn.execute(
                """
                INSERT INTO openedu_v2_verticals (course_id, chapter_id, sequential_id, vertical_id, title, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (course_id, vertical_id)
                DO UPDATE SET chapter_id = COALESCE(NULLIF(EXCLUDED.chapter_id, ''), openedu_v2_verticals.chapter_id),
                              sequential_id = COALESCE(NULLIF(EXCLUDED.sequential_id, ''), openedu_v2_verticals.sequential_id),
                              title = COALESCE(NULLIF(EXCLUDED.title, ''), openedu_v2_verticals.title),
                              updated_at = NOW()
                """,
                course_id,
                chapter_id,
                sequential_id,
                vertical_id,
                str(course.get('verticalTitle') or ''),
            )

    async def upsert_openedu_v2_attempt(self, payload: dict[str, Any], user_id: int | None = None) -> dict[str, int]:
        assert self.pool is not None
        context = payload['context']
        client = payload.get('client') or {}
        questions = payload.get('questions', [])
        completed = bool(payload.get('completed', False))
        participant_key = str(context.get('participantKey') or '').strip() or 'anonymous'
        actor_key = f'user:{user_id}' if user_id is not None else f'participant:{participant_key}'
        fingerprint = self._compute_attempt_fingerprint(context, questions, actor_key)
        accepted = 0
        quarantined = 0

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                first_course = (questions[0].get('course') if questions else {}) or {}
                await self._upsert_openedu_v2_hierarchy(conn, context, first_course)
                await conn.execute(
                    """
                    INSERT INTO openedu_v2_tests
                        (test_key, host, path, title, course_id, chapter_id, sequential_id, vertical_id, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                    ON CONFLICT (test_key)
                    DO UPDATE SET host = EXCLUDED.host,
                                  path = EXCLUDED.path,
                                  title = COALESCE(NULLIF(EXCLUDED.title, ''), openedu_v2_tests.title),
                                  course_id = COALESCE(NULLIF(EXCLUDED.course_id, ''), openedu_v2_tests.course_id),
                                  chapter_id = COALESCE(NULLIF(EXCLUDED.chapter_id, ''), openedu_v2_tests.chapter_id),
                                  sequential_id = COALESCE(NULLIF(EXCLUDED.sequential_id, ''), openedu_v2_tests.sequential_id),
                                  vertical_id = COALESCE(NULLIF(EXCLUDED.vertical_id, ''), openedu_v2_tests.vertical_id),
                                  updated_at = NOW()
                    """,
                    context['testKey'],
                    context['host'],
                    context['path'],
                    context.get('title', ''),
                    first_course.get('courseId', ''),
                    first_course.get('chapterId', ''),
                    first_course.get('sequentialId', ''),
                    first_course.get('verticalId', ''),
                )

                inserted_attempt = await conn.fetchval(
                    """
                    INSERT INTO openedu_v2_attempts
                        (test_key, completed, source, fingerprint, user_id, extension_version, build_id, parser_version, platform, client_id, session_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT DO NOTHING
                    RETURNING id
                    """,
                    context['testKey'],
                    completed,
                    str(payload.get('source') or 'extension'),
                    fingerprint,
                    user_id,
                    str(client.get('extensionVersion') or ''),
                    str(client.get('buildId') or ''),
                    str(client.get('parserVersion') or ''),
                    str(client.get('platform') or 'openedu'),
                    str(client.get('clientId') or ''),
                    str(client.get('sessionId') or ''),
                )
                if not inserted_attempt:
                    return {'accepted': 0, 'quarantined': 0, 'duplicate': 1}

                for question in questions:
                    question_key = str(question.get('questionKey') or '').strip()
                    if not question_key:
                        continue

                    course = question.get('course') or {}
                    await self._upsert_openedu_v2_hierarchy(conn, context, course)
                    answers = question.get('answers', [])
                    raw_answer_entries = []
                    for answer_index, answer in enumerate(answers):
                        answer_key = str(answer.get('answerKey') or answer.get('answerFingerprint') or '').strip()
                        if not answer_key:
                            continue
                        answer_text = sanitize_answer_text(str(answer.get('answerText') or ''))
                        raw_answer_entries.append({
                            'answer_key': answer_key,
                            'answer_text': answer_text,
                            'answer_norm': normalize_answer_text(answer_text),
                            'answer_fingerprint': str(answer.get('answerFingerprint') or ''),
                            'selected': bool(answer.get('selected')),
                            'correct': bool(answer.get('correct')),
                            'incorrect': bool(answer.get('incorrect')),
                            'input_type': str(answer.get('inputType') or ''),
                            'order_index': answer_index,
                        })

                    answer_texts = [
                        entry['answer_text']
                        for entry in raw_answer_entries
                        if entry['answer_text'] and entry['input_type'] != 'text'
                    ]
                    prompt_raw = sanitize_question_prompt(str(question.get('prompt') or ''), answer_texts)
                    question['prompt'] = prompt_raw
                    quarantine_reason = self._v2_question_quarantine_reason(question, answer_texts)
                    if quarantine_reason:
                        quarantined += 1
                        await conn.execute(
                            """
                            INSERT INTO openedu_v2_parse_reports
                                (test_key, question_key, course_id, vertical_id, reason, prompt_preview, question_type, parser_version, parser_source, parse_confidence, payload)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
                            """,
                            context['testKey'],
                            question_key,
                            str(course.get('courseId') or ''),
                            str(course.get('verticalId') or ''),
                            quarantine_reason,
                            prompt_raw[:500],
                            str(question.get('questionType') or 'unknown'),
                            str(client.get('parserVersion') or ''),
                            str(question.get('parserSource') or ''),
                            float(question.get('parseConfidence') or 0),
                            self._safe_json({'question': question, 'client': client}),
                        )
                        continue

                    await conn.execute(
                        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
                        context['testKey'],
                        participant_key + '|' + question_key,
                    )

                    accepted += 1
                    question_correct = bool(question.get('isCorrect'))
                    selected_key_list = merge_key_order([
                        entry['answer_key'] for entry in raw_answer_entries if entry['selected']
                    ], [])
                    current_verified_list = merge_key_order([
                        entry['answer_key']
                        for entry in raw_answer_entries
                        if question_correct and entry['selected'] and entry['correct']
                    ], [])
                    current_incorrect_list = merge_key_order([
                        entry['answer_key'] for entry in raw_answer_entries if entry['selected'] and entry['incorrect']
                    ], [])
                    selected_keys = set(selected_key_list)
                    current_verified = set(current_verified_list)
                    current_incorrect = set(current_incorrect_list)

                    previous_state = await conn.fetchrow(
                        """
                        SELECT selected_answer_keys, verified_answer_keys, incorrect_answer_keys, is_correct
                        FROM openedu_v2_participant_question_state
                        WHERE test_key = $1 AND participant_key = $2 AND question_key = $3
                        """,
                        context['testKey'],
                        participant_key,
                        question_key,
                    )
                    prev_selected = set(previous_state['selected_answer_keys'] or []) if previous_state else set()
                    prev_verified = set(previous_state['verified_answer_keys'] or []) if previous_state else set()
                    prev_incorrect = set(previous_state['incorrect_answer_keys'] or []) if previous_state else set()
                    prev_correct = bool(previous_state['is_correct']) if previous_state else False
                    verified_key_list = merge_key_order(current_verified_list, list(previous_state['verified_answer_keys'] or []) if previous_state else [])
                    incorrect_key_list = merge_key_order(current_incorrect_list, list(previous_state['incorrect_answer_keys'] or []) if previous_state else [])
                    verified_keys = set(verified_key_list)
                    incorrect_keys = set(incorrect_key_list)
                    if prev_correct:
                        question_correct = True
                    completed_delta = 1 if question_correct and not prev_correct else 0

                    await conn.execute(
                        """
                        INSERT INTO openedu_v2_questions
                            (test_key, question_key, course_id, chapter_id, sequential_id, vertical_id, problem_id, prompt, prompt_norm,
                             question_type, question_fingerprint, extension_version, build_id, parser_version, parser_source, raw_type, parse_confidence, completed_count, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
                        ON CONFLICT (test_key, question_key)
                        DO UPDATE SET course_id = COALESCE(NULLIF(EXCLUDED.course_id, ''), openedu_v2_questions.course_id),
                                      chapter_id = COALESCE(NULLIF(EXCLUDED.chapter_id, ''), openedu_v2_questions.chapter_id),
                                      sequential_id = COALESCE(NULLIF(EXCLUDED.sequential_id, ''), openedu_v2_questions.sequential_id),
                                      vertical_id = COALESCE(NULLIF(EXCLUDED.vertical_id, ''), openedu_v2_questions.vertical_id),
                                      problem_id = COALESCE(NULLIF(EXCLUDED.problem_id, ''), openedu_v2_questions.problem_id),
                                      prompt = COALESCE(NULLIF(EXCLUDED.prompt, ''), openedu_v2_questions.prompt),
                                      prompt_norm = COALESCE(NULLIF(EXCLUDED.prompt_norm, ''), openedu_v2_questions.prompt_norm),
                                      question_type = COALESCE(NULLIF(EXCLUDED.question_type, ''), openedu_v2_questions.question_type),
                                      question_fingerprint = COALESCE(NULLIF(EXCLUDED.question_fingerprint, ''), openedu_v2_questions.question_fingerprint),
                                      extension_version = COALESCE(NULLIF(EXCLUDED.extension_version, ''), openedu_v2_questions.extension_version),
                                      build_id = COALESCE(NULLIF(EXCLUDED.build_id, ''), openedu_v2_questions.build_id),
                                      parser_version = COALESCE(NULLIF(EXCLUDED.parser_version, ''), openedu_v2_questions.parser_version),
                                      parser_source = COALESCE(NULLIF(EXCLUDED.parser_source, ''), openedu_v2_questions.parser_source),
                                      parse_confidence = GREATEST(openedu_v2_questions.parse_confidence, EXCLUDED.parse_confidence),
                                      completed_count = openedu_v2_questions.completed_count + $18,
                                      updated_at = NOW()
                        """,
                        context['testKey'],
                        question_key,
                        str(course.get('courseId') or ''),
                        str(course.get('chapterId') or ''),
                        str(course.get('sequentialId') or ''),
                        str(course.get('verticalId') or ''),
                        str(course.get('problemId') or ''),
                        prompt_raw,
                        normalize_prompt(prompt_raw),
                        str(question.get('questionType') or 'unknown'),
                        str(question.get('questionFingerprint') or '') or compute_question_fingerprint(prompt_raw, answer_texts),
                        str(client.get('extensionVersion') or ''),
                        str(client.get('buildId') or ''),
                        str(client.get('parserVersion') or ''),
                        str(question.get('parserSource') or ''),
                        str(question.get('rawType') or ''),
                        float(question.get('parseConfidence') or 0),
                        completed_delta,
                    )

                    selected_increment_keys = selected_keys - prev_selected
                    verified_increment_keys = current_verified - prev_verified
                    incorrect_increment_keys = current_incorrect - prev_incorrect
                    stored_selected_key_list = merge_key_order(selected_key_list, list(previous_state['selected_answer_keys'] or []) if previous_state else [])

                    for entry in raw_answer_entries:
                        selected_inc = 1 if entry['answer_key'] in selected_increment_keys else 0
                        verified_inc = 1 if entry['answer_key'] in verified_increment_keys else 0
                        incorrect_inc = 1 if entry['answer_key'] in incorrect_increment_keys else 0
                        if selected_inc == 0 and verified_inc == 0 and incorrect_inc == 0:
                            continue
                        await conn.execute(
                            """
                            INSERT INTO openedu_v2_answers
                                (test_key, question_key, answer_key, answer_text, answer_norm, answer_fingerprint,
                                 extension_version, build_id, parser_version, verified_count, incorrect_count, fallback_count, updated_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
                            ON CONFLICT (test_key, question_key, answer_key)
                            DO UPDATE SET answer_text = COALESCE(NULLIF(EXCLUDED.answer_text, ''), openedu_v2_answers.answer_text),
                                          answer_norm = COALESCE(NULLIF(EXCLUDED.answer_norm, ''), openedu_v2_answers.answer_norm),
                                          answer_fingerprint = COALESCE(NULLIF(EXCLUDED.answer_fingerprint, ''), openedu_v2_answers.answer_fingerprint),
                                          extension_version = COALESCE(NULLIF(EXCLUDED.extension_version, ''), openedu_v2_answers.extension_version),
                                          build_id = COALESCE(NULLIF(EXCLUDED.build_id, ''), openedu_v2_answers.build_id),
                                          parser_version = COALESCE(NULLIF(EXCLUDED.parser_version, ''), openedu_v2_answers.parser_version),
                                          verified_count = openedu_v2_answers.verified_count + EXCLUDED.verified_count,
                                          incorrect_count = openedu_v2_answers.incorrect_count + EXCLUDED.incorrect_count,
                                          fallback_count = openedu_v2_answers.fallback_count + EXCLUDED.fallback_count,
                                          updated_at = NOW()
                            """,
                            context['testKey'],
                            question_key,
                            entry['answer_key'],
                            entry['answer_text'],
                            entry['answer_norm'],
                            entry['answer_fingerprint'],
                            str(client.get('extensionVersion') or ''),
                            str(client.get('buildId') or ''),
                            str(client.get('parserVersion') or ''),
                            verified_inc,
                            incorrect_inc,
                            selected_inc,
                        )

                    await conn.execute(
                        """
                        INSERT INTO openedu_v2_participant_question_state
                            (test_key, participant_key, question_key, user_id, selected_answer_keys, verified_answer_keys,
                             incorrect_answer_keys, is_correct, extension_version, build_id, parser_version, updated_at)
                        VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7::text[], $8, $9, $10, $11, NOW())
                        ON CONFLICT (test_key, participant_key, question_key)
                        DO UPDATE SET selected_answer_keys = EXCLUDED.selected_answer_keys,
                                      verified_answer_keys = EXCLUDED.verified_answer_keys,
                                      incorrect_answer_keys = EXCLUDED.incorrect_answer_keys,
                                      is_correct = EXCLUDED.is_correct,
                                      user_id = COALESCE(EXCLUDED.user_id, openedu_v2_participant_question_state.user_id),
                                      extension_version = EXCLUDED.extension_version,
                                      build_id = EXCLUDED.build_id,
                                      parser_version = EXCLUDED.parser_version,
                                      updated_at = NOW()
                        """,
                        context['testKey'],
                        participant_key,
                        question_key,
                        user_id,
                        stored_selected_key_list,
                        verified_key_list,
                        incorrect_key_list,
                        question_correct,
                        str(client.get('extensionVersion') or ''),
                        str(client.get('buildId') or ''),
                        str(client.get('parserVersion') or ''),
                    )

        return {'accepted': accepted, 'quarantined': quarantined, 'duplicate': 0}

    async def query_openedu_v2_stats(self, test_key: str, question_keys: list[str]) -> dict[str, Any]:
        assert self.pool is not None
        if not question_keys:
            return {}
        async with self.pool.acquire() as conn:
            question_rows = await conn.fetch(
                "SELECT question_key, completed_count FROM openedu_v2_questions WHERE test_key = $1 AND question_key = ANY($2::text[])",
                test_key,
                question_keys,
            )
            stat_rows = await conn.fetch(
                """
                SELECT question_key, answer_key, answer_text, verified_count, incorrect_count, fallback_count
                FROM openedu_v2_answers
                WHERE test_key = $1 AND question_key = ANY($2::text[])
                ORDER BY question_key, verified_count DESC, incorrect_count DESC, fallback_count DESC
                """,
                test_key,
                question_keys,
            )
            order_rows = await conn.fetch(
                """
                SELECT question_key, verified_answer_keys
                FROM (
                    SELECT question_key,
                           verified_answer_keys,
                           ROW_NUMBER() OVER (PARTITION BY question_key ORDER BY updated_at DESC) AS rn
                    FROM openedu_v2_participant_question_state
                    WHERE test_key = $1
                      AND question_key = ANY($2::text[])
                      AND is_correct
                      AND array_length(verified_answer_keys, 1) > 0
                ) ranked
                WHERE rn = 1
                """,
                test_key,
                question_keys,
            )

        completed_map = {row['question_key']: int(row['completed_count']) for row in question_rows}
        order_map = {
            row['question_key']: {
                str(answer_key): index
                for index, answer_key in enumerate(row['verified_answer_keys'] or [])
            }
            for row in order_rows
        }
        result = {
            qk: {'completedCount': completed_map.get(qk, 0), 'verifiedAnswers': [], 'incorrectAnswers': [], 'fallbackAnswers': []}
            for qk in question_keys
        }
        for row in stat_rows:
            entry = result.get(row['question_key'])
            if not entry:
                continue
            v = int(row['verified_count'])
            i = int(row['incorrect_count'])
            f = int(row['fallback_count'])
            order_index = order_map.get(row['question_key'], {}).get(row['answer_key'])
            order_payload = {'orderIndex': order_index} if order_index is not None else {}
            if v > 0:
                entry['verifiedAnswers'].append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': v, **order_payload})
            if i > 0:
                entry['incorrectAnswers'].append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': i, **order_payload})
            if f > 0:
                entry['fallbackAnswers'].append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': f, **order_payload})
        for entry in result.values():
            for key in ('verifiedAnswers', 'incorrectAnswers', 'fallbackAnswers'):
                entry[key].sort(key=lambda item: (
                    item.get('orderIndex') is None,
                    int(item.get('orderIndex') if item.get('orderIndex') is not None else 0),
                    -int(item.get('count') or 0),
                ))
        return result

    async def write_client_log_v2(self, payload: dict[str, Any], user_id: int | None = None) -> None:
        assert self.pool is not None
        client = payload.get('client') or {}
        system = payload.get('system') or {}
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO client_logs
                    (user_id, kind, severity, platform, extension_version, build_id, parser_version, scope, url, payload, system)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
                """,
                user_id,
                str(payload.get('kind') or ''),
                str(payload.get('severity') or 'error'),
                str(client.get('platform') or ''),
                str(client.get('extensionVersion') or ''),
                str(client.get('buildId') or ''),
                str(client.get('parserVersion') or ''),
                str(system.get('scope') or ''),
                str(system.get('url') or ''),
                self._safe_json(payload.get('payload') or {}),
                self._safe_json(system),
            )

    async def get_user_public_stats(self, user_id: int | None) -> dict[str, Any]:
        assert self.pool is not None
        if user_id is None:
            return {'tests': 0, 'courses': 0, 'questions': 0, 'completions': 0, 'attempts': 0}
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    COUNT(DISTINCT ps.test_key) AS tests,
                    COUNT(DISTINCT q.course_id) FILTER (WHERE q.course_id != '') AS courses,
                    COUNT(*) AS questions,
                    COUNT(*) FILTER (WHERE ps.is_correct) AS completions,
                    (SELECT COUNT(*) FROM openedu_v2_attempts WHERE user_id = $1) AS attempts
                FROM openedu_v2_participant_question_state ps
                LEFT JOIN openedu_v2_questions q
                    ON q.test_key = ps.test_key
                    AND q.question_key = ps.question_key
                WHERE ps.user_id = $1
                """,
                user_id,
            )
        return {
            'tests': int(row['tests'] or 0) if row else 0,
            'courses': int(row['courses'] or 0) if row else 0,
            'questions': int(row['questions'] or 0) if row else 0,
            'completions': int(row['completions'] or 0) if row else 0,
            'attempts': int(row['attempts'] or 0) if row else 0,
        }

    # ── Stats query ────────────────────────────────────────────────

    async def query_openedu_stats(self, test_key: str, question_keys: list[str]) -> dict[str, Any]:
        assert self.pool is not None
        if not question_keys:
            return {}

        async with self.pool.acquire() as conn:
            question_rows = await conn.fetch(
                "SELECT question_key, completed_count FROM openedu_questions WHERE test_key = $1 AND question_key = ANY($2::text[])",
                test_key, question_keys,
            )
            stat_rows = await conn.fetch(
                """
                SELECT question_key, answer_key, answer_text, verified_count, incorrect_count, fallback_count
                FROM openedu_answer_stats
                WHERE test_key = $1 AND question_key = ANY($2::text[])
                ORDER BY question_key, verified_count DESC, incorrect_count DESC, fallback_count DESC
                """,
                test_key, question_keys,
            )

        completed_map = {row['question_key']: int(row['completed_count']) for row in question_rows}
        result: dict[str, Any] = {}
        for qk in question_keys:
            result[qk] = {'completedCount': completed_map.get(qk, 0), 'verifiedAnswers': [], 'incorrectAnswers': [], 'fallbackAnswers': []}

        for row in stat_rows:
            entry = result.get(row['question_key'])
            if not entry:
                continue
            v = int(row['verified_count'])
            i = int(row['incorrect_count'])
            f = int(row['fallback_count'])
            if v > 0:
                entry['verifiedAnswers'].append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': v})
            if i > 0:
                entry['incorrectAnswers'].append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': i})
            if f > 0:
                entry['fallbackAnswers'].append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': f})

        return result

    async def query_openedu_question_metadata(self, test_key: str, question_keys: list[str]) -> dict[str, dict[str, str]]:
        assert self.pool is not None
        if not question_keys:
            return {}

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT question_key, prompt_norm, question_fingerprint
                FROM openedu_questions
                WHERE test_key = $1 AND question_key = ANY($2::text[])
                """,
                test_key,
                question_keys,
            )

        return {
            str(row['question_key']): {
                'promptNorm': str(row['prompt_norm'] or ''),
                'questionFingerprint': str(row['question_fingerprint'] or ''),
            }
            for row in rows
        }

    # ── Similar-question fallback ────────────────────────────────────

    async def find_question_stats_by_fingerprint(
        self, test_key: str, missing: list[dict[str, str]],
    ) -> dict[str, Any]:
        assert self.pool is not None
        if not missing:
            return {}

        original_keys = [m['questionKey'] for m in missing if m.get('questionKey')]
        fingerprints = [m['questionFingerprint'] for m in missing if m.get('questionFingerprint')]
        if not original_keys or not fingerprints or len(original_keys) != len(fingerprints):
            return {}

        async with self.pool.acquire() as conn:
            matched_rows = await conn.fetch(
                """
                SELECT DISTINCT ON (m.original_key)
                    m.original_key,
                    q.question_key AS matched_key,
                    q.completed_count
                FROM unnest($1::text[], $2::text[]) AS m(original_key, question_fingerprint)
                JOIN openedu_questions q
                    ON q.test_key = $3
                    AND q.question_fingerprint = m.question_fingerprint
                    AND q.question_fingerprint != ''
                    AND q.question_key LIKE 'q2_%'
                    AND q.question_key != m.original_key
                ORDER BY m.original_key, q.completed_count DESC
                """,
                original_keys,
                fingerprints,
                test_key,
            )
            if not matched_rows:
                return {}

            matched_map: dict[str, tuple[str, int]] = {}
            matched_keys: list[str] = []
            for row in matched_rows:
                matched_map[row['original_key']] = (row['matched_key'], int(row['completed_count']))
                matched_keys.append(row['matched_key'])

            stat_rows = await conn.fetch(
                """
                SELECT question_key, answer_key, answer_text, verified_count, incorrect_count, fallback_count
                FROM openedu_answer_stats
                WHERE test_key = $1 AND question_key = ANY($2::text[])
                ORDER BY question_key, verified_count DESC, incorrect_count DESC, fallback_count DESC
                """,
                test_key,
                matched_keys,
            )

        stats_by_matched: dict[str, list] = {}
        for row in stat_rows:
            stats_by_matched.setdefault(row['question_key'], []).append(row)

        result: dict[str, Any] = {}
        for original_key, (matched_key, completed_count) in matched_map.items():
            rows = stats_by_matched.get(matched_key, [])
            verified = []
            incorrect = []
            fallback = []
            for row in rows:
                v = int(row['verified_count'])
                i = int(row['incorrect_count'])
                f = int(row['fallback_count'])
                if v > 0:
                    verified.append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': v})
                if i > 0:
                    incorrect.append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': i})
                if f > 0:
                    fallback.append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': f})

            if not verified and not incorrect and not fallback:
                continue

            result[original_key] = {
                'completedCount': completed_count,
                'verifiedAnswers': verified,
                'incorrectAnswers': incorrect,
                'fallbackAnswers': fallback,
                'similarMatch': False,
                'matchedBy': 'content',
                'matchedQuestionKey': matched_key,
            }

        return result

    async def find_similar_question_stats(
        self, test_key: str, missing: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """For questions with no exact stats, find best prompt match by answer overlap."""
        assert self.pool is not None
        if not missing:
            return {}

        prepared: list[dict[str, Any]] = []
        for item in missing:
            question_key = str(item.get('questionKey') or '').strip()
            prompt_norm = str(item.get('promptNorm') or '').strip()
            answer_norms_raw = item.get('answerNorms') or []
            answer_norms = sorted(
                {
                    str(a).strip()
                    for a in answer_norms_raw
                    if str(a).strip()
                }
            )
            if not question_key or not prompt_norm or not answer_norms:
                continue
            prepared.append(
                {
                    'questionKey': question_key,
                    'promptNorm': prompt_norm,
                    'answerNorms': answer_norms,
                }
            )

        if not prepared:
            return {}

        prompt_norms = [m['promptNorm'] for m in prepared]
        original_keys = [m['questionKey'] for m in prepared]
        answer_norms_by_original = {
            m['questionKey']: set(m['answerNorms'])
            for m in prepared
        }

        async with self.pool.acquire() as conn:
            candidate_rows = await conn.fetch(
                """
                SELECT
                    m.original_key,
                    q.question_key AS matched_key,
                    q.completed_count
                FROM unnest($1::text[], $2::text[]) AS m(original_key, prompt_norm)
                JOIN openedu_questions q
                    ON q.test_key = $3
                    AND q.prompt_norm = m.prompt_norm
                    AND q.prompt_norm != ''
                    AND q.question_key LIKE 'q2_%'
                    AND q.question_key != m.original_key
                ORDER BY m.original_key, q.completed_count DESC
                """,
                original_keys,
                prompt_norms,
                test_key,
            )

            if not candidate_rows:
                return {}

            candidate_keys = sorted({row['matched_key'] for row in candidate_rows})
            if not candidate_keys:
                return {}

            answer_rows = await conn.fetch(
                """
                SELECT question_key, answer_text
                FROM openedu_answer_stats
                WHERE test_key = $1 AND question_key = ANY($2::text[])
                """,
                test_key,
                candidate_keys,
            )

            stats_rows = await conn.fetch(
                """
                SELECT question_key, answer_key, answer_text, verified_count, incorrect_count, fallback_count
                FROM openedu_answer_stats
                WHERE test_key = $1 AND question_key = ANY($2::text[])
                ORDER BY question_key, verified_count DESC, incorrect_count DESC, fallback_count DESC
                """,
                test_key,
                candidate_keys,
            )

        answer_norms_by_candidate: dict[str, set[str]] = {}
        for row in answer_rows:
            answer_norm = normalize_answer_text(str(row['answer_text'] or ''))
            if not answer_norm:
                continue
            answer_norms_by_candidate.setdefault(row['question_key'], set()).add(answer_norm)

        best_match: dict[str, tuple[str, int, float]] = {}
        for row in candidate_rows:
            original_key = row['original_key']
            matched_key = row['matched_key']
            completed_count = int(row['completed_count'])

            original_norms = answer_norms_by_original.get(original_key, set())
            candidate_norms = answer_norms_by_candidate.get(matched_key, set())
            if not original_norms or not candidate_norms:
                continue

            overlap_count = len(original_norms & candidate_norms)
            if overlap_count <= 0:
                continue

            overlap_ratio = overlap_count / max(len(original_norms), 1)
            jaccard_ratio = overlap_count / max(len(original_norms | candidate_norms), 1)
            if overlap_ratio < 0.75 or jaccard_ratio < 0.6:
                continue

            current = best_match.get(original_key)
            candidate_tuple = (matched_key, completed_count, overlap_ratio)
            if current is None:
                best_match[original_key] = candidate_tuple
                continue

            _, current_completed, current_ratio = current
            if overlap_ratio > current_ratio or (overlap_ratio == current_ratio and completed_count > current_completed):
                best_match[original_key] = candidate_tuple

        if not best_match:
            return {}

        stats_by_matched: dict[str, list] = {}
        for row in stats_rows:
            stats_by_matched.setdefault(row['question_key'], []).append(row)

        result: dict[str, Any] = {}
        for original_key, (matched_key, completed_count, overlap_ratio) in best_match.items():
            rows = stats_by_matched.get(matched_key, [])
            verified = []
            incorrect = []
            fallback = []
            for row in rows:
                v = int(row['verified_count'])
                i = int(row['incorrect_count'])
                f = int(row['fallback_count'])
                if v > 0:
                    verified.append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': v})
                if i > 0:
                    incorrect.append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': i})
                if f > 0:
                    fallback.append({'answerKey': row['answer_key'], 'answerText': row['answer_text'], 'count': f})

            if not verified and not incorrect and not fallback:
                continue

            result[original_key] = {
                'completedCount': completed_count,
                'verifiedAnswers': verified,
                'incorrectAnswers': incorrect,
                'fallbackAnswers': fallback,
                'similarMatch': True,
                'matchedBy': 'similar',
                'matchedScore': round(overlap_ratio, 3),
                'matchedQuestionKey': matched_key,
            }

        return result

    # ── Logs (retired — no-op, kept for interface compat) ──────────

    async def write_log(self, kind: str, payload: dict[str, Any], system: dict[str, Any]) -> None:
        pass

    # ── Admin queries ──────────────────────────────────────────────

    async def get_admin_overview(self) -> dict[str, Any]:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            counters = await conn.fetchrow(
                """
                SELECT
                    (SELECT COUNT(*) FROM users) AS users_count,
                    (SELECT COUNT(*) FROM users WHERE last_active_at > NOW() - INTERVAL '24 hours') AS active_users_24h,
                    (SELECT COUNT(*) FROM users WHERE last_active_at > NOW() - INTERVAL '7 days') AS active_users_7d,
                    (SELECT COUNT(*) FROM openedu_tests) AS tests_count,
                    (SELECT COUNT(*) FROM openedu_questions) AS questions_count,
                    (SELECT COUNT(*) FROM openedu_attempts) AS attempts_count,
                    (SELECT COUNT(*) FROM openedu_attempts WHERE created_at > NOW() - INTERVAL '24 hours') AS attempts_24h,
                    (SELECT COALESCE(SUM(verified_count), 0) FROM openedu_answer_stats) AS verified_answers_count,
                    (SELECT COALESCE(SUM(incorrect_count), 0) FROM openedu_answer_stats) AS incorrect_answers_count,
                    (SELECT COALESCE(SUM(fallback_count), 0) FROM openedu_answer_stats) AS fallback_answers_count,
                    (SELECT COUNT(*) FROM openedu_v2_courses) AS v2_courses_count,
                    (SELECT COUNT(*) FROM openedu_v2_tests) AS v2_tests_count,
                    (SELECT COUNT(*) FROM openedu_v2_questions) AS v2_questions_count,
                    (SELECT COUNT(*) FROM openedu_v2_attempts) AS v2_attempts_count,
                    (SELECT COUNT(*) FROM openedu_v2_parse_reports) AS v2_parse_reports_count
                """
            )
            top_tests = await conn.fetch(
                """
                SELECT t.test_key, t.host, t.path, t.title,
                       COALESCE(SUM(q.completed_count), 0) AS completed_count,
                       COUNT(DISTINCT q.question_key) AS question_count
                FROM openedu_tests t
                LEFT JOIN openedu_questions q ON q.test_key = t.test_key
                GROUP BY t.test_key, t.host, t.path, t.title
                ORDER BY completed_count DESC, t.updated_at DESC
                LIMIT 20
                """
            )
            latest_users = await conn.fetch(
                """
                SELECT id, telegram_id, telegram_username, telegram_first_name, is_active, last_active_at
                FROM users
                ORDER BY last_active_at DESC
                LIMIT 8
                """
            )
            latest_attempts = await conn.fetch(
                """
                SELECT a.id, a.test_key, a.completed, a.created_at, t.host, t.path, t.title,
                       u.id AS user_id, u.telegram_username, u.telegram_first_name, u.telegram_id
                FROM openedu_attempts a
                LEFT JOIN openedu_tests t ON t.test_key = a.test_key
                LEFT JOIN users u ON u.id = a.user_id
                ORDER BY a.created_at DESC
                LIMIT 10
                """
            )
        return {
            'counters': dict(counters or {}),
            'top_tests': [dict(r) for r in top_tests],
            'latest_users': [dict(r) for r in latest_users],
            'latest_attempts': [dict(r) for r in latest_attempts],
        }

    async def get_admin_v2_courses_page(self, search: str = '', limit: int = 50, offset: int = 0) -> dict[str, Any]:
        assert self.pool is not None
        search_clean = search.strip()
        needle = '%' + search_clean + '%' if search_clean else ''
        async with self.pool.acquire() as conn:
            if needle:
                total = await conn.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM openedu_v2_courses
                    WHERE course_id ILIKE $1 OR title ILIKE $1 OR host ILIKE $1
                    """,
                    needle,
                )
                rows = await conn.fetch(
                    """
                    SELECT c.course_id, c.host, c.title, c.updated_at,
                           COUNT(DISTINCT ch.chapter_id) AS chapter_count,
                           COUNT(DISTINCT s.sequential_id) AS sequential_count,
                           COUNT(DISTINCT v.vertical_id) AS vertical_count,
                           COUNT(DISTINCT q.question_key) AS question_count,
                           COUNT(DISTINCT a.id) AS attempt_count
                    FROM openedu_v2_courses c
                    LEFT JOIN openedu_v2_chapters ch ON ch.course_id = c.course_id
                    LEFT JOIN openedu_v2_sequentials s ON s.course_id = c.course_id
                    LEFT JOIN openedu_v2_verticals v ON v.course_id = c.course_id
                    LEFT JOIN openedu_v2_questions q ON q.course_id = c.course_id
                    LEFT JOIN openedu_v2_attempts a ON a.test_key IN (SELECT test_key FROM openedu_v2_tests WHERE course_id = c.course_id)
                    WHERE c.course_id ILIKE $3 OR c.title ILIKE $3 OR c.host ILIKE $3
                    GROUP BY c.course_id, c.host, c.title, c.updated_at
                    ORDER BY c.updated_at DESC
                    LIMIT $1 OFFSET $2
                    """,
                    limit, offset, needle,
                )
            else:
                total = await conn.fetchval("SELECT COUNT(*) FROM openedu_v2_courses")
                rows = await conn.fetch(
                    """
                    SELECT c.course_id, c.host, c.title, c.updated_at,
                           COUNT(DISTINCT ch.chapter_id) AS chapter_count,
                           COUNT(DISTINCT s.sequential_id) AS sequential_count,
                           COUNT(DISTINCT v.vertical_id) AS vertical_count,
                           COUNT(DISTINCT q.question_key) AS question_count,
                           COUNT(DISTINCT a.id) AS attempt_count
                    FROM openedu_v2_courses c
                    LEFT JOIN openedu_v2_chapters ch ON ch.course_id = c.course_id
                    LEFT JOIN openedu_v2_sequentials s ON s.course_id = c.course_id
                    LEFT JOIN openedu_v2_verticals v ON v.course_id = c.course_id
                    LEFT JOIN openedu_v2_questions q ON q.course_id = c.course_id
                    LEFT JOIN openedu_v2_attempts a ON a.test_key IN (SELECT test_key FROM openedu_v2_tests WHERE course_id = c.course_id)
                    GROUP BY c.course_id, c.host, c.title, c.updated_at
                    ORDER BY c.updated_at DESC
                    LIMIT $1 OFFSET $2
                    """,
                    limit, offset,
                )

            if needle:
                unmapped_exists = await conn.fetchval(
                    """
                    SELECT
                        EXISTS (
                            SELECT 1 FROM openedu_v2_tests
                            WHERE course_id = ''
                              AND (test_key ILIKE $1 OR host ILIKE $1 OR path ILIKE $1 OR title ILIKE $1)
                        )
                        OR EXISTS (
                            SELECT 1 FROM openedu_v2_questions
                            WHERE course_id = ''
                              AND (test_key ILIKE $1 OR question_key ILIKE $1 OR prompt ILIKE $1 OR vertical_id ILIKE $1)
                        )
                        OR EXISTS (
                            SELECT 1 FROM openedu_v2_parse_reports
                            WHERE course_id = ''
                              AND (test_key ILIKE $1 OR question_key ILIKE $1 OR prompt_preview ILIKE $1 OR vertical_id ILIKE $1)
                        )
                    """,
                    needle,
                )
            else:
                unmapped_exists = await conn.fetchval(
                    """
                    SELECT
                        EXISTS (SELECT 1 FROM openedu_v2_tests WHERE course_id = '')
                        OR EXISTS (SELECT 1 FROM openedu_v2_questions WHERE course_id = '')
                        OR EXISTS (SELECT 1 FROM openedu_v2_parse_reports WHERE course_id = '')
                    """,
                )

            row_items = [dict(r) for r in rows]
            if unmapped_exists:
                total = int(total or 0) + 1
                if offset == 0:
                    unmapped = await conn.fetchrow(
                        """
                        WITH test_keys AS (
                            SELECT test_key FROM openedu_v2_tests WHERE course_id = ''
                            UNION
                            SELECT test_key FROM openedu_v2_questions WHERE course_id = ''
                            UNION
                            SELECT test_key FROM openedu_v2_parse_reports WHERE course_id = ''
                        ),
                        timestamps AS (
                            SELECT updated_at FROM openedu_v2_tests WHERE course_id = ''
                            UNION ALL
                            SELECT updated_at FROM openedu_v2_questions WHERE course_id = ''
                            UNION ALL
                            SELECT created_at AS updated_at FROM openedu_v2_parse_reports WHERE course_id = ''
                            UNION ALL
                            SELECT created_at AS updated_at FROM openedu_v2_attempts WHERE test_key IN (SELECT test_key FROM test_keys)
                        )
                        SELECT
                            $1::text AS course_id,
                            COALESCE((SELECT host FROM openedu_v2_tests WHERE course_id = '' AND host != '' ORDER BY updated_at DESC LIMIT 1), '') AS host,
                            'Без курса / unmapped' AS title,
                            (SELECT MAX(updated_at) FROM timestamps) AS updated_at,
                            0 AS chapter_count,
                            0 AS sequential_count,
                            COUNT(DISTINCT NULLIF(COALESCE(q.vertical_id, t.vertical_id), '')) AS vertical_count,
                            COUNT(DISTINCT (q.test_key, q.question_key)) FILTER (WHERE q.test_key IS NOT NULL AND q.question_key IS NOT NULL) AS question_count,
                            (SELECT COUNT(*) FROM openedu_v2_attempts WHERE test_key IN (SELECT test_key FROM test_keys)) AS attempt_count
                        FROM openedu_v2_questions q
                        FULL OUTER JOIN openedu_v2_tests t ON t.test_key = q.test_key AND t.course_id = ''
                        WHERE COALESCE(q.course_id, '') = '' OR COALESCE(t.course_id, '') = ''
                        """,
                        OPENEDU_V2_UNMAPPED_COURSE_ID,
                    )
                    if unmapped:
                        row_items.insert(0, dict(unmapped))

        return {'total': int(total or 0), 'courses': row_items, 'search': search_clean}

    async def get_admin_v2_course_detail(self, course_id: str) -> dict[str, Any]:
        assert self.pool is not None
        course_filter = self._v2_admin_course_filter(course_id)
        async with self.pool.acquire() as conn:
            if course_id == OPENEDU_V2_UNMAPPED_COURSE_ID:
                unmapped_exists = await conn.fetchval(
                    """
                    SELECT
                        EXISTS (SELECT 1 FROM openedu_v2_tests WHERE course_id = '')
                        OR EXISTS (SELECT 1 FROM openedu_v2_questions WHERE course_id = '')
                        OR EXISTS (SELECT 1 FROM openedu_v2_parse_reports WHERE course_id = '')
                    """,
                )
                course = {
                    'course_id': OPENEDU_V2_UNMAPPED_COURSE_ID,
                    'host': await conn.fetchval(
                        "SELECT host FROM openedu_v2_tests WHERE course_id = '' AND host != '' ORDER BY updated_at DESC LIMIT 1",
                    ) or '',
                    'title': 'Без курса / unmapped',
                    'updated_at': await conn.fetchval(
                        """
                        SELECT MAX(updated_at)
                        FROM (
                            SELECT updated_at FROM openedu_v2_tests WHERE course_id = ''
                            UNION ALL
                            SELECT updated_at FROM openedu_v2_questions WHERE course_id = ''
                            UNION ALL
                            SELECT created_at AS updated_at FROM openedu_v2_parse_reports WHERE course_id = ''
                        ) x
                        """,
                    ),
                    'created_at': None,
                } if unmapped_exists else None
            else:
                course = await conn.fetchrow(
                    "SELECT * FROM openedu_v2_courses WHERE course_id = $1",
                    course_filter,
                )
            if not course:
                return {'course': None}
            counters = await conn.fetchrow(
                """
                SELECT
                    (SELECT COUNT(*) FROM openedu_v2_chapters WHERE course_id = $1) AS chapters,
                    (SELECT COUNT(*) FROM openedu_v2_sequentials WHERE course_id = $1) AS sequentials,
                    (SELECT COUNT(*) FROM openedu_v2_verticals WHERE course_id = $1) AS verticals,
                    (SELECT COUNT(*) FROM openedu_v2_questions WHERE course_id = $1) AS questions,
                    (SELECT COUNT(*) FROM openedu_v2_parse_reports WHERE course_id = $1) AS parse_reports
                """,
                course_filter,
            )
            chapters = await conn.fetch(
                """
                SELECT ch.chapter_id, ch.title,
                       COUNT(DISTINCT s.sequential_id) AS sequential_count,
                       COUNT(DISTINCT v.vertical_id) AS vertical_count,
                       COUNT(DISTINCT q.question_key) AS question_count
                FROM openedu_v2_chapters ch
                LEFT JOIN openedu_v2_sequentials s ON s.course_id = ch.course_id AND s.chapter_id = ch.chapter_id
                LEFT JOIN openedu_v2_verticals v ON v.course_id = ch.course_id AND v.chapter_id = ch.chapter_id
                LEFT JOIN openedu_v2_questions q ON q.course_id = ch.course_id AND q.chapter_id = ch.chapter_id
                WHERE ch.course_id = $1
                GROUP BY ch.chapter_id, ch.title, ch.order_index
                ORDER BY ch.order_index, ch.title, ch.chapter_id
                """,
                course_filter,
            )
            sequentials = await conn.fetch(
                """
                SELECT s.chapter_id, s.sequential_id, s.title,
                       COUNT(DISTINCT v.vertical_id) AS vertical_count,
                       COUNT(DISTINCT q.question_key) AS question_count
                FROM openedu_v2_sequentials s
                LEFT JOIN openedu_v2_verticals v ON v.course_id = s.course_id AND v.sequential_id = s.sequential_id
                LEFT JOIN openedu_v2_questions q ON q.course_id = s.course_id AND q.sequential_id = s.sequential_id
                WHERE s.course_id = $1
                GROUP BY s.chapter_id, s.sequential_id, s.title, s.order_index
                ORDER BY s.order_index, s.title, s.sequential_id
                """,
                course_filter,
            )
            verticals = await conn.fetch(
                """
                SELECT v.chapter_id, v.sequential_id, v.vertical_id, v.title,
                       COUNT(DISTINCT q.question_key) AS question_count,
                       COUNT(DISTINCT t.test_key) AS test_count
                FROM openedu_v2_verticals v
                LEFT JOIN openedu_v2_questions q ON q.course_id = v.course_id AND q.vertical_id = v.vertical_id
                LEFT JOIN openedu_v2_tests t ON t.course_id = v.course_id AND t.vertical_id = v.vertical_id
                WHERE v.course_id = $1
                GROUP BY v.chapter_id, v.sequential_id, v.vertical_id, v.title, v.order_index
                ORDER BY v.order_index, v.title, v.vertical_id
                """,
                course_filter,
            )
            recent_questions = await conn.fetch(
                """
                SELECT q.test_key, q.question_key, q.prompt, q.question_type, q.question_fingerprint,
                       q.extension_version, q.build_id, q.parser_version, q.parser_source,
                       q.parse_confidence, q.chapter_id, q.sequential_id, q.vertical_id,
                       q.updated_at, q.completed_count,
                       COUNT(a.answer_key) AS answer_count,
                       COALESCE(SUM(a.verified_count), 0) AS verified_count,
                       COALESCE(SUM(a.incorrect_count), 0) AS incorrect_count,
                       COALESCE(SUM(a.fallback_count), 0) AS fallback_count
                FROM openedu_v2_questions q
                LEFT JOIN openedu_v2_answers a ON a.test_key = q.test_key AND a.question_key = q.question_key
                WHERE q.course_id = $1
                GROUP BY q.test_key, q.question_key, q.prompt, q.question_type, q.question_fingerprint,
                         q.extension_version, q.build_id, q.parser_version, q.parser_source,
                         q.parse_confidence, q.chapter_id, q.sequential_id, q.vertical_id,
                         q.updated_at, q.completed_count
                ORDER BY q.updated_at DESC
                LIMIT 300
                """,
                course_filter,
            )
            recent_answer_rows = await conn.fetch(
                """
                WITH recent AS (
                    SELECT test_key, question_key
                    FROM openedu_v2_questions
                    WHERE course_id = $1
                    ORDER BY updated_at DESC
                    LIMIT 300
                )
                SELECT a.test_key, a.question_key, a.answer_key, a.answer_text,
                       a.extension_version, a.build_id, a.parser_version,
                       a.verified_count, a.incorrect_count, a.fallback_count, a.updated_at
                FROM openedu_v2_answers a
                JOIN recent r ON r.test_key = a.test_key AND r.question_key = a.question_key
                ORDER BY a.verified_count DESC, a.fallback_count DESC, a.updated_at DESC
                """,
                course_filter,
            )
            version_stats = await conn.fetch(
                """
                SELECT COALESCE(NULLIF(extension_version, ''), 'unknown') AS extension_version,
                       COALESCE(NULLIF(parser_version, ''), 'unknown') AS parser_version,
                       COALESCE(NULLIF(build_id, ''), 'unknown') AS build_id,
                       COUNT(*) AS question_count,
                       AVG(parse_confidence) AS avg_confidence
                FROM openedu_v2_questions
                WHERE course_id = $1
                GROUP BY COALESCE(NULLIF(extension_version, ''), 'unknown'),
                         COALESCE(NULLIF(parser_version, ''), 'unknown'),
                         COALESCE(NULLIF(build_id, ''), 'unknown')
                ORDER BY question_count DESC, extension_version DESC
                LIMIT 30
                """,
                course_filter,
            )
            type_stats = await conn.fetch(
                """
                SELECT question_type,
                       COUNT(*) AS question_count,
                       AVG(parse_confidence) AS avg_confidence,
                       SUM(CASE WHEN parse_confidence < 0.45 THEN 1 ELSE 0 END) AS low_confidence_count
                FROM openedu_v2_questions
                WHERE course_id = $1
                GROUP BY question_type
                ORDER BY question_count DESC, question_type
                """,
                course_filter,
            )
            reports = await conn.fetch(
                """
                SELECT id, question_key, vertical_id, reason, prompt_preview, question_type,
                       parser_version, parser_source, parse_confidence, created_at
                FROM openedu_v2_parse_reports
                WHERE course_id = $1
                ORDER BY created_at DESC
                LIMIT 40
                """,
                course_filter,
            )
        answers_by_question: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in recent_answer_rows:
            item = dict(row)
            answers_by_question.setdefault((item['test_key'], item['question_key']), []).append(item)

        recent_question_items: list[dict[str, Any]] = []
        for row in recent_questions:
            item = dict(row)
            item['answers'] = answers_by_question.get((item['test_key'], item['question_key']), [])[:8]
            recent_question_items.append(item)

        questions_by_vertical: dict[str, list[dict[str, Any]]] = {}
        orphan_questions: list[dict[str, Any]] = []
        for item in recent_question_items:
            vertical_id = str(item.get('vertical_id') or '')
            if vertical_id:
                questions_by_vertical.setdefault(vertical_id, []).append(item)
            else:
                orphan_questions.append(item)

        vertical_items = [dict(r) for r in verticals]
        known_vertical_ids = {str(item.get('vertical_id') or '') for item in vertical_items}
        for vertical_id, question_items in questions_by_vertical.items():
            if not vertical_id or vertical_id in known_vertical_ids:
                continue
            first_question = question_items[0] if question_items else {}
            vertical_items.append({
                'chapter_id': str(first_question.get('chapter_id') or ''),
                'sequential_id': str(first_question.get('sequential_id') or ''),
                'vertical_id': vertical_id,
                'title': '',
                'question_count': len(question_items),
                'test_count': len({str(q.get('test_key') or '') for q in question_items if q.get('test_key')}),
            })

        verticals_by_seq: dict[str, list[dict[str, Any]]] = {}
        for item in vertical_items:
            item['questions'] = questions_by_vertical.get(str(item.get('vertical_id') or ''), [])
            verticals_by_seq.setdefault(item.get('sequential_id') or '', []).append(item)

        sequential_items = [dict(r) for r in sequentials]
        known_sequential_ids = {str(item.get('sequential_id') or '') for item in sequential_items}
        for sequential_id, seq_verticals in verticals_by_seq.items():
            if sequential_id in known_sequential_ids:
                continue
            first_vertical = seq_verticals[0] if seq_verticals else {}
            sequential_items.append({
                'chapter_id': str(first_vertical.get('chapter_id') or ''),
                'sequential_id': sequential_id,
                'title': 'Без sequence' if not sequential_id else sequential_id,
                'vertical_count': len(seq_verticals),
                'question_count': sum(int(v.get('question_count') or 0) for v in seq_verticals),
            })

        chapter_items = [dict(r) for r in chapters]
        known_chapter_ids = {str(item.get('chapter_id') or '') for item in chapter_items}
        for item in sequential_items:
            chapter_id = str(item.get('chapter_id') or '')
            if chapter_id in known_chapter_ids:
                continue
            known_chapter_ids.add(chapter_id)
            chapter_items.append({
                'chapter_id': chapter_id,
                'title': 'Без раздела' if not chapter_id else chapter_id,
                'sequential_count': 0,
                'vertical_count': 0,
                'question_count': 0,
            })

        def is_synthetic_hierarchy_id(value: Any) -> bool:
            return str(value or '').startswith(('chapter@', 'sequential@', 'vertical@'))

        def chapter_group_key(item: dict[str, Any]) -> str:
            title = collapse_whitespace(item.get('title') or '')
            if title and title != 'Без раздела':
                return 'title:' + title.casefold()
            return 'id:' + str(item.get('chapter_id') or '')

        chapter_groups: dict[str, dict[str, Any]] = {}
        for item in chapter_items:
            chapter_id = str(item.get('chapter_id') or '')
            key = chapter_group_key(item)
            existing = chapter_groups.get(key)
            if not existing:
                chapter_groups[key] = {
                    'chapter_id': chapter_id,
                    'title': item.get('title') or ('Без раздела' if not chapter_id else chapter_id),
                    'sequential_count': 0,
                    'vertical_count': 0,
                    'question_count': 0,
                    'sequentials': [],
                    '_aliases': [chapter_id],
                }
                continue

            existing_id = str(existing.get('chapter_id') or '')
            existing.setdefault('_aliases', []).append(chapter_id)
            if is_synthetic_hierarchy_id(existing_id) and chapter_id and not is_synthetic_hierarchy_id(chapter_id):
                existing['chapter_id'] = chapter_id
                existing_id = chapter_id
            if not existing.get('title') or str(existing.get('title')) == existing_id:
                existing['title'] = item.get('title') or existing.get('title') or chapter_id

        chapter_aliases: dict[str, str] = {}
        for item in chapter_groups.values():
            canonical_id = str(item.get('chapter_id') or '')
            for alias in item.get('_aliases') or []:
                chapter_aliases[str(alias or '')] = canonical_id

        canonical_chapter_ids = {str(item.get('chapter_id') or '') for item in chapter_groups.values()}
        sequentials_by_chapter: dict[str, list[dict[str, Any]]] = {}
        for item in sequential_items:
            item['verticals'] = verticals_by_seq.get(item.get('sequential_id') or '', [])
            item['vertical_count'] = len(item['verticals'])
            item['question_count'] = sum(int(v.get('question_count') or 0) for v in item['verticals'])
            raw_chapter_id = str(item.get('chapter_id') or '')
            chapter_id = chapter_aliases.get(raw_chapter_id, raw_chapter_id)
            item['chapter_id'] = chapter_id
            for vertical in item['verticals']:
                vertical['chapter_id'] = chapter_id
            if chapter_id not in canonical_chapter_ids:
                chapter_groups['id:' + chapter_id] = {
                    'chapter_id': chapter_id,
                    'title': 'Без раздела' if not chapter_id else chapter_id,
                    'sequential_count': 0,
                    'vertical_count': 0,
                    'question_count': 0,
                    'sequentials': [],
                    '_aliases': [chapter_id],
                }
                canonical_chapter_ids.add(chapter_id)
            sequentials_by_chapter.setdefault(chapter_id, []).append(item)

        chapter_items = list(chapter_groups.values())
        for item in chapter_items:
            item.pop('_aliases', None)
            seqs = sequentials_by_chapter.get(str(item.get('chapter_id') or ''), [])
            item['sequentials'] = seqs
            item['sequential_count'] = len(seqs)
            item['vertical_count'] = sum(int(seq.get('vertical_count') or 0) for seq in seqs)
            item['question_count'] = sum(int(seq.get('question_count') or 0) for seq in seqs)

        counters_dict = dict(counters or {})
        counters_dict['chapters'] = len(chapter_items)
        counters_dict['sequentials'] = len(sequential_items)
        counters_dict['verticals'] = len(vertical_items)

        return {
            'course': dict(course),
            'counters': counters_dict,
            'chapters': chapter_items,
            'sequentials': sequential_items,
            'verticals': vertical_items,
            'recent_questions': recent_question_items,
            'orphan_questions': orphan_questions,
            'version_stats': [dict(r) for r in version_stats],
            'type_stats': [dict(r) for r in type_stats],
            'reports': [dict(r) for r in reports],
        }

    async def delete_admin_v2_question(self, test_key: str, question_key: str) -> dict[str, int]:
        assert self.pool is not None
        test_key = str(test_key or '').strip()
        question_key = str(question_key or '').strip()
        if not test_key or not question_key:
            return {}

        deleted: dict[str, int] = {}
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                deleted['parse_reports'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_parse_reports WHERE test_key = $1 AND question_key = $2",
                    test_key, question_key,
                ))
                deleted['participant_state'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_participant_question_state WHERE test_key = $1 AND question_key = $2",
                    test_key, question_key,
                ))
                deleted['answers'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_answers WHERE test_key = $1 AND question_key = $2",
                    test_key, question_key,
                ))
                deleted['questions'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_questions WHERE test_key = $1 AND question_key = $2",
                    test_key, question_key,
                ))
        return deleted

    async def delete_admin_v2_course(self, course_id: str) -> dict[str, int]:
        assert self.pool is not None
        course_filter = self._v2_admin_course_filter(course_id)
        deleted: dict[str, int] = {}
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                test_rows = await conn.fetch(
                    """
                    SELECT test_key FROM openedu_v2_tests WHERE course_id = $1
                    UNION
                    SELECT test_key FROM openedu_v2_questions WHERE course_id = $1
                    UNION
                    SELECT test_key FROM openedu_v2_parse_reports WHERE course_id = $1
                    """,
                    course_filter,
                )
                test_keys = [str(row['test_key']) for row in test_rows if row['test_key']]

                deleted['parse_reports'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_parse_reports WHERE course_id = $1 OR test_key = ANY($2::text[])",
                    course_filter, test_keys,
                ))
                deleted['participant_state'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_participant_question_state WHERE test_key = ANY($1::text[])",
                    test_keys,
                ))
                deleted['answers'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_answers WHERE test_key = ANY($1::text[])",
                    test_keys,
                ))
                deleted['questions'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_questions WHERE course_id = $1 OR test_key = ANY($2::text[])",
                    course_filter, test_keys,
                ))
                deleted['attempts'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_attempts WHERE test_key = ANY($1::text[])",
                    test_keys,
                ))
                deleted['frames'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_frames WHERE course_id = $1 OR test_key = ANY($2::text[])",
                    course_filter, test_keys,
                ))
                deleted['tests'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_tests WHERE course_id = $1 OR test_key = ANY($2::text[])",
                    course_filter, test_keys,
                ))
                deleted['verticals'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_verticals WHERE course_id = $1",
                    course_filter,
                ))
                deleted['sequentials'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_sequentials WHERE course_id = $1",
                    course_filter,
                ))
                deleted['chapters'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_chapters WHERE course_id = $1",
                    course_filter,
                ))
                deleted['courses'] = 0 if course_id == OPENEDU_V2_UNMAPPED_COURSE_ID else self._command_count(await conn.execute(
                    "DELETE FROM openedu_v2_courses WHERE course_id = $1",
                    course_filter,
                ))
        return deleted

    async def delete_admin_v2_all(self) -> dict[str, int]:
        assert self.pool is not None
        deleted: dict[str, int] = {}
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                for table in (
                    'openedu_v2_parse_reports',
                    'openedu_v2_participant_question_state',
                    'openedu_v2_answers',
                    'openedu_v2_questions',
                    'openedu_v2_attempts',
                    'openedu_v2_frames',
                    'openedu_v2_tests',
                    'openedu_v2_verticals',
                    'openedu_v2_sequentials',
                    'openedu_v2_chapters',
                    'openedu_v2_courses',
                ):
                    deleted[table.replace('openedu_v2_', '')] = self._command_count(await conn.execute(f'DELETE FROM {table}'))
        return deleted

    async def get_admin_users_page(self, search: str = '', limit: int = 50, offset: int = 0) -> dict[str, Any]:
        assert self.pool is not None
        needle = '%' + search.strip() + '%' if search.strip() else ''
        async with self.pool.acquire() as conn:
            if needle:
                total = await conn.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM users
                    WHERE telegram_username ILIKE $1
                       OR telegram_first_name ILIKE $1
                       OR telegram_id::text ILIKE $1
                       OR id::text ILIKE $1
                    """,
                    needle,
                )
                where_clause = """
                    WHERE u.telegram_username ILIKE $3
                       OR u.telegram_first_name ILIKE $3
                       OR u.telegram_id::text ILIKE $3
                       OR u.id::text ILIKE $3
                """
                rows = await conn.fetch(
                    f"""
                    SELECT u.id, u.telegram_id, u.telegram_username, u.telegram_first_name,
                           u.is_active, u.created_at, u.last_active_at,
                           COUNT(DISTINCT ps.test_key) AS tests_count,
                           COUNT(ps.question_key) AS questions_count,
                           COUNT(*) FILTER (WHERE ps.is_correct) AS completions_count
                    FROM users u
                    LEFT JOIN openedu_participant_question_state ps ON ps.user_id = u.id
                    {where_clause}
                    GROUP BY u.id
                    ORDER BY u.last_active_at DESC
                    LIMIT $1 OFFSET $2
                    """,
                    limit, offset, needle,
                )
                return {'total': total, 'users': [dict(r) for r in rows], 'search': search.strip()}

            total = await conn.fetchval("SELECT COUNT(*) FROM users")
            rows = await conn.fetch(
                """
                SELECT u.id, u.telegram_id, u.telegram_username, u.telegram_first_name,
                       u.is_active, u.created_at, u.last_active_at,
                       COUNT(DISTINCT ps.test_key) AS tests_count,
                       COUNT(ps.question_key) AS questions_count,
                       COUNT(*) FILTER (WHERE ps.is_correct) AS completions_count
                FROM users u
                LEFT JOIN openedu_participant_question_state ps ON ps.user_id = u.id
                GROUP BY u.id
                ORDER BY u.last_active_at DESC
                LIMIT $1 OFFSET $2
                """,
                limit, offset,
            )
        return {'total': total, 'users': [dict(r) for r in rows], 'search': search.strip()}

    async def get_admin_user_detail(self, user_id: int) -> dict[str, Any]:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            user = await conn.fetchrow(
                """
                SELECT id, telegram_id, telegram_username, telegram_first_name,
                       is_active, created_at, last_active_at
                FROM users
                WHERE id = $1
                """,
                user_id,
            )
            if not user:
                return {'user': None}

            counters = await conn.fetchrow(
                """
                SELECT
                    (SELECT COUNT(DISTINCT test_key) FROM openedu_participant_question_state WHERE user_id = $1) AS tests_count,
                    (SELECT COUNT(*) FROM openedu_participant_question_state WHERE user_id = $1) AS questions_count,
                    (SELECT COUNT(*) FROM openedu_participant_question_state WHERE user_id = $1 AND is_correct) AS completions_count,
                    (SELECT COUNT(*) FROM openedu_attempts WHERE user_id = $1) AS attempts_count,
                    (SELECT COUNT(*) FROM openedu_attempts WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours') AS attempts_24h
                """,
                user_id,
            )
            tests = await conn.fetch(
                """
                SELECT t.test_key, t.host, t.path, t.title,
                       COUNT(ps.question_key) AS questions_count,
                       COUNT(*) FILTER (WHERE ps.is_correct) AS completions_count,
                       MAX(ps.updated_at) AS last_activity_at
                FROM openedu_participant_question_state ps
                JOIN openedu_tests t ON t.test_key = ps.test_key
                WHERE ps.user_id = $1
                GROUP BY t.test_key, t.host, t.path, t.title
                ORDER BY last_activity_at DESC
                LIMIT 30
                """,
                user_id,
            )
            attempts = await conn.fetch(
                """
                SELECT a.id, a.test_key, a.completed, a.created_at, t.host, t.path, t.title
                FROM openedu_attempts a
                LEFT JOIN openedu_tests t ON t.test_key = a.test_key
                WHERE a.user_id = $1
                ORDER BY a.created_at DESC
                LIMIT 30
                """,
                user_id,
            )

        return {
            'user': dict(user),
            'counters': dict(counters or {}),
            'tests': [dict(r) for r in tests],
            'attempts': [dict(r) for r in attempts],
        }

    async def get_admin_tests_page(self, search: str = '', limit: int = 50, offset: int = 0) -> dict[str, Any]:
        assert self.pool is not None
        needle = '%' + search.strip() + '%' if search.strip() else ''
        async with self.pool.acquire() as conn:
            if needle:
                total = await conn.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM openedu_tests
                    WHERE test_key ILIKE $1 OR host ILIKE $1 OR path ILIKE $1 OR title ILIKE $1
                    """,
                    needle,
                )
                where_clause = "WHERE t.test_key ILIKE $3 OR t.host ILIKE $3 OR t.path ILIKE $3 OR t.title ILIKE $3"
                rows = await conn.fetch(
                    f"""
                    SELECT t.test_key, t.host, t.path, t.title, t.updated_at,
                           (SELECT COUNT(*) FROM openedu_questions q WHERE q.test_key = t.test_key) AS question_count,
                           (SELECT COALESCE(SUM(q.completed_count), 0) FROM openedu_questions q WHERE q.test_key = t.test_key) AS completed_count,
                           (SELECT COUNT(DISTINCT a.user_id) FROM openedu_attempts a WHERE a.test_key = t.test_key AND a.user_id IS NOT NULL) AS unique_users,
                           (SELECT COUNT(*) FROM openedu_attempts a WHERE a.test_key = t.test_key) AS attempts_count
                    FROM openedu_tests t
                    {where_clause}
                    ORDER BY t.updated_at DESC
                    LIMIT $1 OFFSET $2
                    """,
                    limit, offset, needle,
                )
                return {'total': total, 'tests': [dict(r) for r in rows], 'search': search.strip()}

            total = await conn.fetchval("SELECT COUNT(*) FROM openedu_tests")
            rows = await conn.fetch(
                """
                SELECT t.test_key, t.host, t.path, t.title, t.updated_at,
                       (SELECT COUNT(*) FROM openedu_questions q WHERE q.test_key = t.test_key) AS question_count,
                       (SELECT COALESCE(SUM(q.completed_count), 0) FROM openedu_questions q WHERE q.test_key = t.test_key) AS completed_count,
                       (SELECT COUNT(DISTINCT a.user_id) FROM openedu_attempts a WHERE a.test_key = t.test_key AND a.user_id IS NOT NULL) AS unique_users,
                       (SELECT COUNT(*) FROM openedu_attempts a WHERE a.test_key = t.test_key) AS attempts_count
                FROM openedu_tests t
                ORDER BY t.updated_at DESC
                LIMIT $1 OFFSET $2
                """,
                limit, offset,
            )
        return {'total': total, 'tests': [dict(r) for r in rows], 'search': search.strip()}

    async def get_admin_test_detail(self, test_key: str, limit: int = 50, offset: int = 0) -> dict[str, Any]:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            test = await conn.fetchrow(
                "SELECT test_key, host, path, title, created_at, updated_at FROM openedu_tests WHERE test_key = $1",
                test_key,
            )
            if not test:
                return {'test': None}

            counters = await conn.fetchrow(
                """
                SELECT
                    (SELECT COUNT(*) FROM openedu_questions WHERE test_key = $1) AS questions_count,
                    (SELECT COALESCE(SUM(completed_count), 0) FROM openedu_questions WHERE test_key = $1) AS completed_count,
                    (SELECT COUNT(*) FROM openedu_attempts WHERE test_key = $1) AS attempts_count,
                    (SELECT COUNT(DISTINCT user_id) FROM openedu_attempts WHERE test_key = $1 AND user_id IS NOT NULL) AS unique_users
                """,
                test_key,
            )
            total_questions = await conn.fetchval(
                "SELECT COUNT(*) FROM openedu_questions WHERE test_key = $1",
                test_key,
            )
            questions = await conn.fetch(
                """
                SELECT q.test_key, q.question_key, q.prompt, q.completed_count, q.updated_at,
                       COUNT(a.answer_key) AS answers_count,
                       COALESCE(SUM(a.verified_count), 0) AS verified_count,
                       COALESCE(SUM(a.incorrect_count), 0) AS incorrect_count,
                       COALESCE(SUM(a.fallback_count), 0) AS fallback_count
                FROM openedu_questions q
                LEFT JOIN openedu_answer_stats a
                    ON a.test_key = q.test_key AND a.question_key = q.question_key
                WHERE q.test_key = $1
                GROUP BY q.test_key, q.question_key, q.prompt, q.completed_count, q.updated_at
                ORDER BY q.updated_at DESC
                LIMIT $2 OFFSET $3
                """,
                test_key, limit, offset,
            )
            users = await conn.fetch(
                """
                SELECT u.id, u.telegram_id, u.telegram_username, u.telegram_first_name,
                       COUNT(ps.question_key) AS questions_count,
                       COUNT(*) FILTER (WHERE ps.is_correct) AS completions_count,
                       MAX(ps.updated_at) AS last_activity_at
                FROM openedu_participant_question_state ps
                JOIN users u ON u.id = ps.user_id
                WHERE ps.test_key = $1
                GROUP BY u.id
                ORDER BY last_activity_at DESC
                LIMIT 20
                """,
                test_key,
            )

        return {
            'test': dict(test),
            'counters': dict(counters or {}),
            'total_questions': total_questions,
            'questions': [dict(r) for r in questions],
            'users': [dict(r) for r in users],
        }

    async def get_admin_questions_page(self, search: str = '', limit: int = 50, offset: int = 0) -> dict[str, Any]:
        assert self.pool is not None
        needle = '%' + search.strip() + '%' if search.strip() else ''

        async with self.pool.acquire() as conn:
            if needle:
                total = await conn.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM openedu_questions q
                    LEFT JOIN openedu_tests t ON t.test_key = q.test_key
                    WHERE q.prompt ILIKE $1
                       OR q.question_key ILIKE $1
                       OR t.path ILIKE $1
                       OR t.title ILIKE $1
                    """,
                    needle,
                )
                rows = await conn.fetch(
                    """
                    SELECT
                        q.test_key,
                        q.question_key,
                        q.prompt,
                        q.completed_count,
                        q.updated_at,
                        t.host,
                        t.path,
                        t.title,
                        COUNT(a.answer_key) AS answers_count,
                        COALESCE(SUM(a.verified_count), 0) AS verified_count,
                        COALESCE(SUM(a.incorrect_count), 0) AS incorrect_count,
                        COALESCE(SUM(a.fallback_count), 0) AS fallback_count
                    FROM openedu_questions q
                    LEFT JOIN openedu_tests t ON t.test_key = q.test_key
                    LEFT JOIN openedu_answer_stats a
                        ON a.test_key = q.test_key
                        AND a.question_key = q.question_key
                    WHERE q.prompt ILIKE $1
                       OR q.question_key ILIKE $1
                       OR t.path ILIKE $1
                       OR t.title ILIKE $1
                    GROUP BY q.test_key, q.question_key, q.prompt, q.completed_count, q.updated_at, t.host, t.path, t.title
                    ORDER BY q.updated_at DESC
                    LIMIT $2 OFFSET $3
                    """,
                    needle,
                    limit,
                    offset,
                )
            else:
                total = await conn.fetchval("SELECT COUNT(*) FROM openedu_questions")
                rows = await conn.fetch(
                    """
                    SELECT
                        q.test_key,
                        q.question_key,
                        q.prompt,
                        q.completed_count,
                        q.updated_at,
                        t.host,
                        t.path,
                        t.title,
                        COUNT(a.answer_key) AS answers_count,
                        COALESCE(SUM(a.verified_count), 0) AS verified_count,
                        COALESCE(SUM(a.incorrect_count), 0) AS incorrect_count,
                        COALESCE(SUM(a.fallback_count), 0) AS fallback_count
                    FROM openedu_questions q
                    LEFT JOIN openedu_tests t ON t.test_key = q.test_key
                    LEFT JOIN openedu_answer_stats a
                        ON a.test_key = q.test_key
                        AND a.question_key = q.question_key
                    GROUP BY q.test_key, q.question_key, q.prompt, q.completed_count, q.updated_at, t.host, t.path, t.title
                    ORDER BY q.updated_at DESC
                    LIMIT $1 OFFSET $2
                    """,
                    limit,
                    offset,
                )

        return {'total': total, 'questions': [dict(r) for r in rows], 'search': search.strip()}

    async def delete_admin_question(self, test_key: str, question_key: str) -> dict[str, int]:
        assert self.pool is not None
        test_key = str(test_key or '').strip()
        question_key = str(question_key or '').strip()
        if not test_key or not question_key:
            return {}

        deleted: dict[str, int] = {}
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                deleted['participant_state'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_participant_question_state WHERE test_key = $1 AND question_key = $2",
                    test_key, question_key,
                ))
                deleted['answers'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_answer_stats WHERE test_key = $1 AND question_key = $2",
                    test_key, question_key,
                ))
                deleted['questions'] = self._command_count(await conn.execute(
                    "DELETE FROM openedu_questions WHERE test_key = $1 AND question_key = $2",
                    test_key, question_key,
                ))
        return deleted


database = Database()
