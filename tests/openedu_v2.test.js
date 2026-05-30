const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
