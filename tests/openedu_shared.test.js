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

test('deriveOptionAnswerText unwraps simple TeX inline answers', () => {
    assert.equal(openeduShared.deriveOptionAnswerText({ text: '\\(Y\\)' }), 'Y');
    assert.equal(openeduShared.deriveOptionAnswerText({ text: '\\(\\Omega\\)' }), 'Ω');
    assert.equal(openeduShared.deriveOptionAnswerText({ text: '\\(A(20,10,0)\\)' }), 'A(20,10,0)');
});

test('sanitizeQuestionPrompt unwraps TeX inline fragments', () => {
    const prompt = openeduShared.sanitizeQuestionPrompt(
        'Проекция точки, которая задана координатами \\(X\\) и \\(Y\\)',
        []
    );

    assert.equal(prompt, 'Проекция точки, которая задана координатами X и Y');
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

test('sanitizeQuestionPrompt removes MooDuSh inline widget artifacts', () => {
    const prompt = openeduShared.sanitizeQuestionPrompt(
        '|*?MooDuShВставить правильные ответыВставить популярные ответыОтветыорганизация и проведение спортивных соревнований1организация культурного досуга1Методы досуговой реабилитации людей с ограниченными возможностями:',
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
        '|*?MooDuShВставить правильные ответыВставить популярные ответыОтветыорганизация и проведение спортивных соревнований1организация культурного досуга1Методы досуговой реабилитации людей с ограниченными возможностями:',
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

test('shouldDelayAutoAdvanceForParsing waits for first iframe sync', () => {
    const shouldWait = openeduShared.shouldDelayAutoAdvanceForParsing({
        waitMs: 9000,
        elapsedMs: 1800,
        syncedAfterNavigation: false,
        questionCount: 0,
        answerEvidenceCount: 0
    });

    assert.equal(shouldWait, true);
});

test('shouldDelayAutoAdvanceForParsing waits for answer evidence on parsed questions', () => {
    const shouldWait = openeduShared.shouldDelayAutoAdvanceForParsing({
        waitMs: 9000,
        elapsedMs: 3000,
        syncedAfterNavigation: true,
        questionCount: 2,
        answerEvidenceCount: 1
    });

    assert.equal(shouldWait, true);
});

test('shouldDelayAutoAdvanceForParsing allows empty parsed sections', () => {
    const shouldWait = openeduShared.shouldDelayAutoAdvanceForParsing({
        waitMs: 9000,
        elapsedMs: 3000,
        syncedAfterNavigation: true,
        questionCount: 0,
        answerEvidenceCount: 0
    });

    assert.equal(shouldWait, false);
});

test('shouldDelayAutoAdvanceForParsing releases after timeout', () => {
    const shouldWait = openeduShared.shouldDelayAutoAdvanceForParsing({
        waitMs: 9000,
        elapsedMs: 9500,
        syncedAfterNavigation: true,
        questionCount: 2,
        answerEvidenceCount: 0
    });

    assert.equal(shouldWait, false);
});

test('parsePythonishDataLiteral reads OpenEdu advanced component payloads', () => {
    const parsed = openeduShared.parsePythonishDataLiteral("{'ok': True, 'title': '\\u0424\\u0430\\u043b\\u0435\\u0441', 'items': [None, {'id': 'a'}]}");

    assert.equal(parsed.ok, true);
    assert.equal(parsed.title, 'Фалес');
    assert.equal(parsed.items[0], null);
    assert.equal(parsed.items[1].id, 'a');
});

test('parsePythonishDataLiteral decodes html-escaped OpenEdu payloads', () => {
    const parsed = openeduShared.parsePythonishDataLiteral('{&#39;answer&#39;: {&#39;cell&#39;: [&#39;ans&#39;]}}');

    assert.deepEqual(parsed, { answer: { cell: ['ans'] } });
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

test('buildMatchingTablePairs supports matching tables without a header row', () => {
    const initialData = openeduShared.parsePythonishDataLiteral(
        "{'table': [[{'isFixed': true, 'value': ['Что есть прекрасное?']}, {'isFixed': false, 'id': 'cell_a'}]], 'answers': [{'id': 'ans_a', 'title': 'Эстетика'}]}"
    );

    const pairs = openeduShared.buildMatchingTablePairs(
        initialData,
        '{"answer":{"cell_a":["ans_a"]}}',
        true
    );

    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].cellId, 'cell_a');
    assert.equal(pairs[0].answerId, 'ans_a');
    assert.equal(pairs[0].answerText, 'Что есть прекрасное?: Эстетика');
    assert.equal(pairs[0].selected, true);
});
