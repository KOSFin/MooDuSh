(function () {
    const KEY = 'moodushOpeneduReminders';
    const list = document.getElementById('reminders');
    const status = document.getElementById('status');
    let revision = 0;

    function safeUrl(value) {
        try {
            const url = new URL(value);
            if (url.protocol === 'https:' && /(^|\.)openedu\.ru$/i.test(url.hostname)
                && !url.username && !url.password) return url;
        } catch (_) { /* Ignore invalid stored links. */ }
        return null;
    }

    function render(values) {
        const links = [...new Set(Array.isArray(values) ? values : [])].filter(value => typeof value === 'string' && safeUrl(value));
        list.replaceChildren();
        document.getElementById('count').textContent = 'Сохранено: ' + links.length;
        document.getElementById('empty').hidden = links.length !== 0;
        links.forEach((value, index) => {
            const url = safeUrl(value);
            const item = document.createElement('li');
            const content = document.createElement('div');
            content.className = 'task';
            const link = document.createElement('a');
            link.className = 'task-title';
            link.href = url.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'Задание ' + (index + 1);
            const address = document.createElement('span');
            address.className = 'task-url';
            address.textContent = value;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = 'Убрать';
            remove.setAttribute('aria-label', 'Убрать задание ' + (index + 1) + ' из напоминаний');
            remove.addEventListener('click', async () => {
                remove.disabled = true;
                try {
                    const result = await chrome.runtime.sendMessage({ type: 'MOODUSH_REMOVE_REMINDER', url: value });
                    if (!result?.ok) throw new Error(result?.error || 'Попробуйте ещё раз.');
                } catch (error) {
                    status.textContent = 'Не удалось убрать ссылку. ' + error.message;
                    remove.disabled = false;
                }
            });
            content.append(link, address);
            item.append(content, remove);
            list.appendChild(item);
        });
        status.textContent = '';
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, KEY)) {
            revision++;
            render(changes[KEY].newValue);
        }
    });
    const initialRevision = revision;
    chrome.storage.local.get(KEY).then(stored => {
        if (initialRevision === revision) render(stored[KEY]);
    }).catch(error => { status.textContent = 'Не удалось загрузить напоминания. ' + error.message; });
})();
