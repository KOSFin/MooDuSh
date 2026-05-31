const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const courseApi = require('../js/openedu_course_api.js');
const parser = require('../js/openedu_parser.js');

function readHar() {
    const harPath = path.join(__dirname, '..', 'test-files', 'response', 'apps.openedu.ru.har');
    if (!fs.existsSync(harPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(harPath, 'utf8'));
}

function sampleBlocksPayload() {
    return {
        blocks: {
            'course-v1:urfu+PHILOSOPHY+spring_2026': {
                id: 'course-v1:urfu+PHILOSOPHY+spring_2026',
                type: 'course',
                display_name: 'Философия',
                children: ['block-v1:urfu+PHILOSOPHY+spring_2026+type@chapter+block@intro']
            },
            'block-v1:urfu+PHILOSOPHY+spring_2026+type@chapter+block@intro': {
                id: 'block-v1:urfu+PHILOSOPHY+spring_2026+type@chapter+block@intro',
                type: 'chapter',
                display_name: 'Раздел',
                children: ['block-v1:urfu+PHILOSOPHY+spring_2026+type@sequential+block@test']
            },
            'block-v1:urfu+PHILOSOPHY+spring_2026+type@sequential+block@test': {
                id: 'block-v1:urfu+PHILOSOPHY+spring_2026+type@sequential+block@test',
                type: 'sequential',
                display_name: 'Тестовые задания',
                children: ['block-v1:urfu+PHILOSOPHY+spring_2026+type@vertical+block@68edf4b377694f5086aa4ed3b2a7ad9f']
            },
            'block-v1:urfu+PHILOSOPHY+spring_2026+type@vertical+block@68edf4b377694f5086aa4ed3b2a7ad9f': {
                id: 'block-v1:urfu+PHILOSOPHY+spring_2026+type@vertical+block@68edf4b377694f5086aa4ed3b2a7ad9f',
                type: 'vertical',
                display_name: 'Тест',
                graded: true,
                children: []
            }
        }
    };
}

function readCapturedCourseJsonPayloads() {
    const coursePath = path.join(__dirname, '..', 'test-files', 'response', 'course.json');
    if (!fs.existsSync(coursePath)) {
        return [];
    }
    const raw = fs.readFileSync(coursePath, 'utf8');
    return Array.from(raw.matchAll(/response:\n(\{[^\n]*\})/g))
        .map((match) => JSON.parse(match[1]));
}

test('OpenEdu V2 course map extracts graded vertical hierarchy from HAR blocks payload', () => {
    const har = readHar();
    const entry = har?.log?.entries?.find((item) => String(item.request?.url || '').includes('/api/courses/v2/blocks/'));
    const payload = entry ? JSON.parse(entry.response.content.text) : sampleBlocksPayload();
    const verticals = courseApi.buildCourseMap(payload);
    const graded = verticals.filter((item) => item.graded);

    assert.ok(verticals.length > 0);
    assert.ok(graded.length > 0);
    assert.ok(graded.some((item) => item.courseId.includes('PHILOSOPHY')));
    assert.ok(graded.every((item) => item.verticalId.includes('type@vertical')));
});

test('OpenEdu V2 course map reads captured course.json blocks and sequence payloads', { skip: !fs.existsSync(path.join(__dirname, '..', 'test-files', 'response', 'course.json')) }, () => {
    const payloads = readCapturedCourseJsonPayloads();
    const coursePayload = payloads.find((payload) => payload.id && payload.name);
    const blocksPayload = payloads.find((payload) => payload.blocks);
    const sequencePayload = payloads.find((payload) => Array.isArray(payload.items));

    const courseMap = courseApi.buildCourseMapFromCapturedPayload(
        'https://courses.openedu.ru/api/courseware/course/course-v1:urfu+PHILOSOPHY+spring_2026',
        coursePayload,
    );
    const blocksMap = courseApi.buildCourseMapFromCapturedPayload(
        'https://courses.openedu.ru/api/courses/v2/blocks/?course_id=course-v1%3Aurfu%2BPHILOSOPHY%2Bspring_2026&depth=3',
        blocksPayload,
    );
    const sequenceMap = courseApi.buildCourseMapFromCapturedPayload(
        'https://courses.openedu.ru/api/courseware/sequence/block-v1:urfu+PHILOSOPHY+spring_2026+type@sequential+block@566d47b22d3348d8ae6a0e8b2627a7bd',
        sequencePayload,
    );
    const merged = courseApi.mergeCourseMaps(courseApi.mergeCourseMaps(courseMap, blocksMap), sequenceMap);
    const target = merged.find((item) => item.verticalId === 'block-v1:urfu+PHILOSOPHY+spring_2026+type@vertical+block@68edf4b377694f5086aa4ed3b2a7ad9f');

    assert.equal(courseMap[0].courseId, 'course-v1:urfu+PHILOSOPHY+spring_2026');
    assert.equal(courseMap[0].courseTitle, 'Философия');
    assert.ok(blocksMap.length > 100);
    assert.ok(blocksMap.every((item) => item.courseId === 'course-v1:urfu+PHILOSOPHY+spring_2026'));
    assert.ok(sequenceMap.length > 0);
    assert.ok(target);
    assert.equal(target.courseId, 'course-v1:urfu+PHILOSOPHY+spring_2026');
    assert.equal(target.courseTitle, 'Философия');
    assert.equal(target.chapterTitle, 'Раздел 4. Философия Нового времени');
    assert.equal(target.sequentialTitle, 'Тема 11. Философия как теория познания');
    assert.equal(target.verticalTitle, 'Тестовые задания');
});

test('OpenEdu course id can be derived from block ids in xblock URLs', () => {
    const verticalId = 'block-v1:urfu+PHILOSOPHY+spring_2026+type@vertical+block@68edf4b377694f5086aa4ed3b2a7ad9f';
    assert.equal(
        courseApi.findCourseId('https://courses.openedu.ru/xblock/' + encodeURIComponent(verticalId)),
        'course-v1:urfu+PHILOSOPHY+spring_2026',
    );
    assert.equal(courseApi.extractBlockId(encodeURIComponent(verticalId)), verticalId);
});

test('OpenEdu V2 parser confidence quarantines unknown or empty questions', () => {
    const good = parser.confidenceFor({
        prompt: 'Определение отображенное в мышлении соответствует термину',
        answers: [],
        questionType: 'text_input',
        problemId: 'problem_1',
        questionFingerprint: 'abc'
    });
    const weak = parser.confidenceFor({
        prompt: '',
        answers: [],
        questionType: 'unknown',
        problemId: '',
        questionFingerprint: ''
    });

    assert.ok(good >= 0.8);
    assert.ok(weak < 0.45);
});

test('OpenEdu V2 parser fingerprint is stable across answer order', () => {
    const first = parser.fingerprintQuestion('Что такое истина?', ['соответствие', 'мнение']);
    const second = parser.fingerprintQuestion('Что такое истина?', ['мнение', 'соответствие']);
    assert.equal(first, second);
});

test('OpenEdu V2 parser detects single-cell drag ordering tasks', () => {
    const html = `
        <div class="xblock-student_view-problem">
            <h2 class="problem-header">Укажите порядок построения точки пересечения прямой с плоскостью</h2>
            <div class="problem">
                <textarea name="answer" hidden class="answer"></textarea>
                <table class="answerPlaceStudent drag-table"><tbody><tr><td class="cell ui-sortable" id="slot1"></td></tr></tbody></table>
                <div id="allAnswers" class="answerPlaceStudent">
                    <div class="dragAnswer" id="a1">Построить линию пересечения</div>
                    <div class="dragAnswer" id="a2">Определить участки видимости</div>
                </div>
                <button class="check Check">Проверить</button>
            </div>
        </div>`;
    const dom = new JSDOM(html, { url: 'https://apps.openedu.ru/' });
    const questions = parser.parseDocumentTree(dom.window.document, { sourceUrl: 'fixture://drag-order' });
    const drag = questions.find((question) => question.questionType === 'drag_order');

    assert.ok(drag);
    assert.equal(drag.answers.length, 2);
    assert.equal(drag.prompt, 'Укажите порядок построения точки пересечения прямой с плоскостью');
    assert.ok(drag.parseConfidence >= 0.8);
});

test('OpenEdu V2 parser ignores CSS when choosing a drag prompt', () => {
    const html = `
        <div class="xblock-student_view-problem">
            <div class="problem">
                <style>
                    .answerPlaceStudent.cell { border: 1px solid #3a3a3a!important; margin-top: 12px; }
                    #allAnswers { pointer-events: auto; display: block; }
                </style>
                <h2 class="problem-header">Установите соответствие между философами и воззрениями.</h2>
                <textarea name="answer" hidden class="answer"></textarea>
                <table class="answerPlaceStudent drag-table"><tbody><tr><td class="cell ui-sortable" id="slot1"></td></tr></tbody></table>
                <div id="allAnswers" class="answerPlaceStudent">
                    <div class="dragAnswer" id="a1">Демокрит</div>
                    <div class="dragAnswer" id="a2">Парменид</div>
                </div>
                <button class="submit btn-brand" data-value="Отправить"><span>Отправить</span></button>
            </div>
        </div>`;
    const dom = new JSDOM(html, { url: 'https://apps.openedu.ru/' });
    const questions = parser.parseDocumentTree(dom.window.document, { sourceUrl: 'fixture://css-noise' });
    const drag = questions.find((question) => question.questionType === 'drag_order');

    assert.ok(drag);
    assert.equal(drag.prompt, 'Установите соответствие между философами и воззрениями.');
    assert.doesNotMatch(drag.prompt, /answerPlaceStudent|!important|border:\s*1px|#allAnswers/i);
});

test('OpenEdu V2 parser includes adjacent HTML context for multiengine drag tasks', { skip: !fs.existsSync(path.join(__dirname, '..', 'test-files', 'test16.html')) }, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'test-files', 'test16.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'https://apps.openedu.ru/' });
    const questions = parser.parseDocumentTree(dom.window.document, { sourceUrl: 'test16.html' });
    const dragQuestions = questions.filter((question) => question.questionType === 'drag_order');

    assert.equal(dragQuestions.length, 2);
    assert.match(dragQuestions[0].prompt, /параллельными прямыми/);
    assert.match(dragQuestions[0].prompt, /t3\.5\.png/);
    assert.ok(dragQuestions[0].contextRoot);
    assert.ok(dragQuestions[0].visualRoot);
    assert.match(dragQuestions[0].contextRoot.textContent, /Прямая/);
    assert.match(dragQuestions[1].prompt, /triangle|АВС|ABC/);
    assert.match(dragQuestions[1].prompt, /t3\.6\.png/);
});
