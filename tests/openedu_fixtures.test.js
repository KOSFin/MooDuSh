const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const parser = require('../js/openedu_parser.js');
const courseApi = require('../js/openedu_course_api.js');

const FIXTURE_DIR = path.join(__dirname, '..', 'test-files');
const NOISE_RE = /(Выберите\s+((один|несколько|все|\d+|правильн)[^.:\n]*)|Набрано\s+баллов|Сохранить|Show answer|Ответы в задаче отмечены)/i;

function hasLocalFixtures() {
    return fs.existsSync(FIXTURE_DIR);
}

test('local OpenEdu HTML fixtures parse clean accepted questions when test-files is present', { skip: !hasLocalFixtures() }, () => {
    const files = fs.readdirSync(FIXTURE_DIR).filter((file) => file.endsWith('.html')).sort();
    let parsedTotal = 0;
    let acceptedTotal = 0;
    const badPrompts = [];

    for (const file of files) {
        const html = fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8');
        const dom = new JSDOM(html, { url: 'https://apps.openedu.ru/' });
        const questions = parser.parseDocumentTree(dom.window.document, { sourceUrl: file });
        parsedTotal += questions.length;

        for (const question of questions) {
            const accepted = question.parseConfidence >= 0.45 && question.prompt;
            if (accepted) {
                acceptedTotal += 1;
            }
            if (accepted && NOISE_RE.test(question.prompt)) {
                badPrompts.push({ file, prompt: question.prompt });
            }
            assert.ok(question.questionKey.startsWith('qv2_'));
            assert.ok(typeof question.questionFingerprint === 'string');
            assert.ok(typeof question.questionType === 'string');
            assert.ok(typeof question.parseConfidence === 'number');
        }
    }

    assert.ok(parsedTotal >= 80, `expected broad fixture coverage, got ${parsedTotal}`);
    assert.ok(acceptedTotal >= 70, `expected accepted fixture questions, got ${acceptedTotal}`);
    assert.deepEqual(badPrompts, []);
});

test('OpenEdu xblock URL builder targets the vertical frame endpoint', () => {
    const verticalId = 'block-v1:urfu+PHILOSOPHY+spring_2026+type@vertical+block@68edf4b377694f5086aa4ed3b2a7ad9f';
    const url = courseApi.buildVerticalXBlockUrl(verticalId);
    assert.ok(url.startsWith('https://courses.openedu.ru/xblock/'));
    assert.ok(url.includes(encodeURIComponent(verticalId)));
    assert.ok(url.includes('view=student_view'));
});
