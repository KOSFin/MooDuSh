from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class ContextModel(BaseModel):
    host: str
    path: str
    fullUrl: str
    title: str = ''
    testKey: str
    participantKey: str = ''


class OpenEduAnswerIn(BaseModel):
    answerKey: str
    answerText: str
    selected: bool = False
    correct: bool = False
    incorrect: bool = False
    inputType: str = ''


class OpenEduQuestionIn(BaseModel):
    questionKey: str
    prompt: str = ''
    verified: bool = False
    isCorrect: bool = False
    answers: list[OpenEduAnswerIn] = Field(default_factory=list)


class OpenEduAttemptIn(BaseModel):
    source: str = 'extension'
    context: ContextModel
    completed: bool = False
    questions: list[OpenEduQuestionIn] = Field(default_factory=list)


class QuestionQueryItem(BaseModel):
    questionKey: str
    prompt: str = ''
    answers: list[str] = Field(default_factory=list)


class OpenEduSolutionsQueryIn(BaseModel):
    context: ContextModel
    questionKeys: list[str] = Field(default_factory=list)
    questions: list[QuestionQueryItem] = Field(default_factory=list)


class LogPayloadIn(BaseModel):
    kind: str
    payload: dict[str, Any] = Field(default_factory=dict)
    system: dict[str, Any] = Field(default_factory=dict)


class ClientMeta(BaseModel):
    platform: Literal['openedu', 'moodle', 'popup', 'unknown'] = 'unknown'
    extensionVersion: str = Field(..., min_length=1, max_length=32)
    buildId: str = Field(..., min_length=1, max_length=96)
    parserVersion: str = Field(..., min_length=1, max_length=64)
    clientId: str = Field(..., min_length=1, max_length=128)
    sessionId: str = Field(default='', max_length=128)
    channel: str = Field(default='stable', max_length=32)


class OpenEduV2CourseRef(BaseModel):
    courseId: str = Field(default='', max_length=256)
    courseTitle: str = Field(default='', max_length=512)
    chapterId: str = Field(default='', max_length=256)
    chapterTitle: str = Field(default='', max_length=512)
    sequentialId: str = Field(default='', max_length=256)
    sequentialTitle: str = Field(default='', max_length=512)
    verticalId: str = Field(default='', max_length=256)
    verticalTitle: str = Field(default='', max_length=512)
    problemId: str = Field(default='', max_length=256)
    frameUrl: str = Field(default='', max_length=2048)


class OpenEduV2AnswerIn(BaseModel):
    answerKey: str = Field(default='', max_length=256)
    answerText: str = Field(default='', max_length=4000)
    selected: bool = False
    correct: bool = False
    incorrect: bool = False
    inputType: str = Field(default='', max_length=64)
    answerFingerprint: str = Field(default='', max_length=128)


class OpenEduV2QuestionIn(BaseModel):
    questionKey: str = Field(..., min_length=1, max_length=256)
    prompt: str = Field(default='', max_length=12000)
    questionType: str = Field(default='unknown', max_length=96)
    questionFingerprint: str = Field(default='', max_length=128)
    parserSource: str = Field(default='dom', max_length=64)
    parseConfidence: float = Field(default=0.0, ge=0.0, le=1.0)
    rawType: str = Field(default='', max_length=128)
    verified: bool = False
    isCorrect: bool = False
    answers: list[OpenEduV2AnswerIn] = Field(default_factory=list, max_length=80)
    course: OpenEduV2CourseRef = Field(default_factory=OpenEduV2CourseRef)


class OpenEduV2AttemptIn(BaseModel):
    source: str = Field(default='extension', max_length=64)
    context: ContextModel
    client: ClientMeta
    completed: bool = False
    questions: list[OpenEduV2QuestionIn] = Field(default_factory=list, max_length=120)


class OpenEduV2QuestionQueryItem(BaseModel):
    questionKey: str = Field(..., min_length=1, max_length=256)
    prompt: str = Field(default='', max_length=12000)
    answers: list[str] = Field(default_factory=list, max_length=80)
    questionType: str = Field(default='unknown', max_length=96)
    questionFingerprint: str = Field(default='', max_length=128)
    parserSource: str = Field(default='dom', max_length=64)
    parseConfidence: float = Field(default=0.0, ge=0.0, le=1.0)
    course: OpenEduV2CourseRef = Field(default_factory=OpenEduV2CourseRef)


class OpenEduV2SolutionsQueryIn(BaseModel):
    context: ContextModel
    client: ClientMeta
    questionKeys: list[str] = Field(default_factory=list, max_length=120)
    questions: list[OpenEduV2QuestionQueryItem] = Field(default_factory=list, max_length=120)


class LogPayloadV2In(BaseModel):
    kind: str = Field(..., min_length=1, max_length=120)
    payload: dict[str, Any] = Field(default_factory=dict)
    system: dict[str, Any] = Field(default_factory=dict)
    client: Optional[ClientMeta] = None
    severity: Literal['debug', 'info', 'warning', 'error', 'critical'] = 'error'

    @field_validator('payload', 'system')
    @classmethod
    def limit_jsonish_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(str(value)) > 20000:
            return {'truncated': True, 'preview': str(value)[:2000]}
        return value
