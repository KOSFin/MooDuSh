/* Runs in the LMS main world to reuse its CSRF-aware transport and CAPA renderer. */
(function () {
    const busy = new WeakSet();
    function problemRuntime(wrapper, $) {
        const runtime = Object.create(window.Problem.prototype);
        runtime.el = $(wrapper);
        runtime.inputs = runtime.el.find('input[id^="input_"], select[id^="input_"], textarea[id^="input_"]');
        runtime.submitButton = runtime.el.find('button.submit, input[type="submit"]');
        runtime.submitButtonLabel = runtime.el.find('.submit .submit-label');
        runtime.submitButtonSubmitText = runtime.submitButton.data?.('value') || runtime.submitButtonLabel.text?.() || 'Отправить';
        runtime.submitButtonSubmittingText = runtime.submitButton.data?.('submitting') || 'Отправка';
        return runtime;
    }

    window.addEventListener('message', async event => {
        if (event.source !== window || !['PARAMEXT_CAPA_SUBMIT', 'PARAMEXT_CAPA_REFRESH'].includes(event.data?.type)) return;
        const { id, marker } = event.data;
        const reply = value => window.postMessage({ type: 'PARAMEXT_CAPA_RESULT', id, ...value }, location.origin);
        const wrapper = [...document.querySelectorAll('.problems-wrapper[data-url]')]
            .find(node => node.getAttribute(event.data.type === 'PARAMEXT_CAPA_REFRESH' ? 'data-moodush-capa-id' : 'data-moodush-submit-id') === marker);
        if (!wrapper || busy.has(wrapper)) return reply({ error: 'Problem missing or already submitting' });
        const $ = window.jQuery || window.$;
        if (!$?.postWithPrefix || typeof window.Problem !== 'function') {
            return reply({ error: 'This OpenEdu problem does not expose the supported CAPA runtime' });
        }
        let runtime;
        try {
            runtime = problemRuntime(wrapper, $);
            // Use CAPA's own completeness and attempt policy. Never force-enable
            // a submit button by assigning disabled=false.
            if (typeof runtime.submitAnswersAndSubmitButton === 'function') {
                runtime.submitAnswersAndSubmitButton(false);
            }
            if (event.data.type === 'PARAMEXT_CAPA_REFRESH') return reply({ ok: true });
        } catch (error) { return reply({ error: error.message }); }
        const button = wrapper.querySelector('button.submit, input[type="submit"]');
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
            return reply({ error: 'Problem is closed, cooling down, or has no attempts left' });
        }
        if (wrapper.querySelector('input[type="file"], input[waitfor], input[data-waitfor], .xqueue')) {
            return reply({ error: 'File, asynchronous and custom-validation problems require manual submission' });
        }
        if (wrapper.parentElement.querySelectorAll('.problems-wrapper').length !== 1) {
            return reply({ error: 'Ambiguous CAPA wrapper; automatic submission stopped' });
        }
        let url;
        try {
            url = new URL(wrapper.getAttribute('data-url'), location.href);
            if (url.origin !== location.origin) throw new Error('Unexpected problem endpoint');
        } catch (error) { return reply({ error: error.message }); }
        busy.add(wrapper);
        try {
            // CAPA's refreshAnswers handles CodeMirror/schematic serialization too.
            runtime.refreshAnswers();
            if (!runtime.answers) throw new Error('No serializable CAPA answers');
            const response = await new Promise((resolve, reject) => {
                $.postWithPrefix(url.href.replace(/\/$/, '') + '/problem_check', runtime.answers, resolve)
                    .fail(() => reject(new Error('Submission outcome unknown; reload the course before retrying')));
            });
            if (!['submitted', 'correct', 'incorrect'].includes(response.success) || typeof response.contents !== 'string') {
                throw new Error('LMS did not confirm submission: ' + String(response.success || 'unknown'));
            }
            // Let the LMS initialize controls and emit progress events as it normally does.
            runtime.el.data('content', response.contents);
            runtime.el.data('attempts-used', response.attempts_used);
            if (response.attempts_used !== undefined) wrapper.setAttribute('data-attempts-used', response.attempts_used);
            runtime.el.data('problem-score', response.current_score);
            runtime.el.data('problem-total-possible', response.total_possible);
            const renderer = new window.Problem(wrapper.parentElement);
            renderer.forceUpdate(response);
            runtime.el.trigger('contentChanged', [runtime.el.data('problem-id'), response.contents, response]);
            reply({ ok: true, success: response.success, attemptsUsed: response.attempts_used, currentScore: response.current_score, totalPossible: response.total_possible, correctMap: response.correct_map || null });
        } catch (error) { reply({ error: error.message }); }
        finally { busy.delete(wrapper); }
    });
})();
