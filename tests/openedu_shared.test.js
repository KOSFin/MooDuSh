const test = require('node:test');
const assert = require('node:assert/strict');

const openeduShared = require('../js/openedu_shared.js');

test('deriveOptionAnswerText keeps visible text answers unchanged', () => {
    const answerText = openeduShared.deriveOptionAnswerText({
        text: '  Верный   ответ  '
    });

    assert.equal(answerText, 'Верный ответ');
});

test('deriveOptionAnswerText builds stable token for image-only answers', () => {
    const answerText = openeduShared.deriveOptionAnswerText({
        text: '',
        mediaDescriptors: [{
            kind: 'img',
            src: '//cdn2.openedu.ru/assets/courseware/v1/69ef4e29da38c45dd48f9b0a90a2d277/asset-v1:urfu+GEOM+spring_2026+type@asset+block/t1.1.1.jpg'
        }]
    });

    assert.equal(answerText, 'img:t1.1.1.jpg');
});

test('deriveOptionAnswerText builds stable token for inline svg answers', () => {
    const answerText = openeduShared.deriveOptionAnswerText({
        text: '',
        mediaDescriptors: [{
            kind: 'svg',
            signature: 'hdiagram123',
            title: 'Схема'
        }]
    });

    assert.equal(answerText, 'svg:hdiagram123 | Схема');
});

test('matchesQuestionReference falls back to prompt and options when question key changes', () => {
    const candidate = {
        questionKey: 'new-key',
        domId: 'problem_1::n:input',
        prompt: 'Отметьте чертежи, полученные ортогональным проецированием',
        options: [
            { answerText: 'img:t1.1.1.jpg' },
            { answerText: 'img:t1.1.2.jpg' }
        ]
    };
    const reference = {
        questionKey: 'old-key',
        domId: '',
        prompt: 'Отметьте чертежи, полученные ортогональным проецированием',
        options: [
            { answerText: 'img:t1.1.2.jpg' },
            { answerText: 'img:t1.1.1.jpg' }
        ]
    };

    assert.equal(openeduShared.matchesQuestionReference(candidate, reference), true);
});

test('buildStableQuestionKeyBase stays stable for the same question content', () => {
    const first = openeduShared.buildStableQuestionKeyBase({
        sourcePath: '/courses/1',
        prompt: 'Что такое FLOPS?',
        answerTexts: ['количество операций в секунду', 'частота процессора'],
        choiceCount: 2,
        textInputCount: 0,
        allowsMultipleAnswers: false
    });
    const second = openeduShared.buildStableQuestionKeyBase({
        sourcePath: '/courses/1',
        prompt: 'Что такое FLOPS',
        answerTexts: ['частота процессора', 'количество операций в секунду'],
        choiceCount: 2,
        textInputCount: 0,
        allowsMultipleAnswers: false
    });

    assert.equal(first, second);
});

test('buildStableQuestionKeyBase ignores document path changes for the same question', () => {
    const first = openeduShared.buildStableQuestionKeyBase({
        sourcePath: '/xblock/block-v1:demo+course+type@problem+block@123',
        prompt: 'Кто считается отцом информатики?',
        answerTexts: ['Алан Тьюринг', 'Чарльз Бэббидж'],
        choiceCount: 2,
        textInputCount: 0,
        allowsMultipleAnswers: false
    });
    const second = openeduShared.buildStableQuestionKeyBase({
        sourcePath: '/courses/demo/courseware/unit/test/',
        prompt: 'Кто считается отцом информатики?',
        answerTexts: ['Чарльз Бэббидж', 'Алан Тьюринг'],
        choiceCount: 2,
        textInputCount: 0,
        allowsMultipleAnswers: false
    });

    assert.equal(first, second);
});

test('buildStableQuestionKeyBase changes when answer set changes', () => {
    const first = openeduShared.buildStableQuestionKeyBase({
        sourcePath: '/courses/1',
        prompt: 'Что такое FLOPS?',
        answerTexts: ['количество операций в секунду', 'частота процессора'],
        choiceCount: 2,
        textInputCount: 0,
        allowsMultipleAnswers: false
    });
    const second = openeduShared.buildStableQuestionKeyBase({
        sourcePath: '/courses/1',
        prompt: 'Что такое FLOPS?',
        answerTexts: ['модель процессора', 'частота процессора'],
        choiceCount: 2,
        textInputCount: 0,
        allowsMultipleAnswers: false
    });

    assert.notEqual(first, second);
});

test('sanitizeQuestionPrompt removes paramEXT inline widget artifacts', () => {
    const prompt = openeduShared.sanitizeQuestionPrompt(
        '|*?paramEXTВставить правильные ответыВставить популярные ответыОтветыорганизация и проведение спортивных соревнований1организация культурного досуга1Методы досуговой реабилитации людей с ограниченными возможностями:',
        [
            'организация и проведение спортивных соревнований',
            'организация культурного досуга'
        ]
    );

    assert.equal(prompt, 'Методы досуговой реабилитации людей с ограниченными возможностями:');
});

test('buildQuestionFingerprint ignores stripped prompt artifacts', () => {
    const answers = [
        'организация и проведение спортивных соревнований',
        'организация культурного досуга'
    ];
    const clean = openeduShared.buildQuestionFingerprint(
        'Методы досуговой реабилитации людей с ограниченными возможностями:',
        answers
    );
    const dirty = openeduShared.buildQuestionFingerprint(
        '|*?paramEXTВставить правильные ответыВставить популярные ответыОтветыорганизация и проведение спортивных соревнований1организация культурного досуга1Методы досуговой реабилитации людей с ограниченными возможностями:',
        answers
    );

    assert.equal(dirty, clean);
});

test('shouldRetainRenderedAnswers keeps UI during transient empty rerender after submit', () => {
    const keepUi = openeduShared.shouldRetainRenderedAnswers({
        questionCount: 0,
        hadRenderedAnswers: true,
        msSinceLastMeaningfulQuestions: 1200,
        msSinceLastSubmit: 900,
        transientGraceMs: 9000,
        submitGraceMs: 15000
    });

    assert.equal(keepUi, true);
});

test('shouldRetainRenderedAnswers clears UI when page is truly empty for long enough', () => {
    const keepUi = openeduShared.shouldRetainRenderedAnswers({
        questionCount: 0,
        hadRenderedAnswers: true,
        msSinceLastMeaningfulQuestions: 25000,
        msSinceLastSubmit: 25000,
        transientGraceMs: 9000,
        submitGraceMs: 15000
    });

    assert.equal(keepUi, false);
});

test('parsePythonishDataLiteral reads OpenEdu advanced component payloads', () => {
    const parsed = openeduShared.parsePythonishDataLiteral("{'ok': True, 'title': '\\u0424\\u0430\\u043b\\u0435\\u0441', 'items': [None, {'id': 'a'}]}");

    assert.equal(parsed.ok, true);
    assert.equal(parsed.title, 'Фалес');
    assert.equal(parsed.items[0], null);
    assert.equal(parsed.items[1].id, 'a');
});

test('buildMatchingTablePairs converts MatchingTableVueApp state into stable answer texts', () => {
    const initialData = openeduShared.parsePythonishDataLiteral(
        "{'table': [[{'isFixed': true, 'value': ['__Философ__']}, {'isFixed': true, 'value': ['__Первоначало__']}], [{'isFixed': true, 'value': ['Фалес']}, {'isFixed': false, 'id': 'cell_water'}]], 'answers': [{'id': 'ans_water', 'title': 'вода'}, {'id': 'ans_fire', 'title': 'огонь'}]}"
    );

    const pairs = openeduShared.buildMatchingTablePairs(
        initialData,
        '{"answer":{"cell_water":["ans_water"]}}',
        true
    );

    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].cellId, 'cell_water');
    assert.equal(pairs[0].answerId, 'ans_water');
    assert.equal(pairs[0].answerText, 'Фалес / Первоначало: вода');
    assert.equal(pairs[0].selected, true);
});
