<h1 align="center">
  <img src="logo_main.png" alt="MooDuSh" width="38" height="38" style="vertical-align: middle;">
  MooDuSh — Enhanced SyncShare
</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome%20Web%20Store-Available-brightgreen?style=flat-square" alt="Chrome Web Store">
  <img src="https://img.shields.io/badge/Manifest%20V3-Compatible-blue?style=flat-square" alt="Manifest Version">
  <img src="https://img.shields.io/badge/Version-2.9.6-orange?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/License-MIT%20with%20Attribution-green?style=flat-square" alt="License">
</p>

> **MooDuSh** — расширенная версия SyncShare для автоматизации тестов на **Moodle** и **OpenEdu**.

---

## Возможности

### Moodle

| Режим | Описание |
|-------|----------|
| **Палочка (Wand)** | Показывает кнопку рядом с каждым вопросом. Нажмите, чтобы увидеть статистику и выбрать ответ. |
| **Авто-вставка (Auto-Insert)** | Автоматически заполняет ответы на основе статистики сразу при открытии теста. |
| **Авто-прорешивание (Auto-Solve)** | Решает весь тест и автоматически переходит на следующие страницы. |

### OpenEdu

| Режим | Описание |
|-------|----------|
| **Палочка** | Inline-кнопки рядом с каждым вопросом — показывает проверенные ответы и статистику. |
| **Авто-вставка** | Вставляет найденные ответы и подводит к вопросам, где нужен ручной ввод. |
| **Автоматический режим** | Полностью автоматическое решение с авто-переходом между разделами. |

### Дополнительные функции OpenEdu

- Авто-переход после прохождения раздела
- Обновление состояния активного раздела
- Боковая панель со статистикой по всем вопросам
- Резервная статистика (как в Moodle)
- Опциональная проверка ответов в режиме авто-вставки без нажатия «Отправить»
- Настраиваемая задержка авто-перехода
- Горячие клавиши для показа/скрытия палочки
- Поддержка обычных вопросов, текстовых полей, медиа-вариантов и MatchingTable-задач OpenEdu

---

## Установка расширения

### Шаг 1: Скачайте расширение

Откройте последний [**GitHub Release**](https://github.com/KOSFin/MooDuSh/releases/latest) и скачайте `moodush-extension.zip`. Распакуйте архив в удобное место.

Для разработки можно клонировать репозиторий:

```bash
git clone https://github.com/KOSFin/MooDuSh-from-syncshare.git
cd MooDuSh-from-syncshare
npm ci
npm run build:extension
```

### Шаг 2: Загрузите в Chrome

1. Откройте `chrome://extensions/`
2. Включите **Режим разработчика** (переключатель в правом верхнем углу)
3. Нажмите **Загрузить распакованное расширение**
4. Выберите папку с файлами MooDuSh (где лежит `manifest.json`)
5. Готово — иконка MooDuSh появится на панели расширений

> **Примечание:** MooDuSh автоматически заменит оригинальное расширение SyncShare, если оно установлено, так как оба используют одинаковые ключи Chrome. Весь функционал SyncShare сохраняется.

---

## Обновление

Если расширение установлено как unpacked-папка, обновите его внешним скриптом:

```bash
./scripts/update.sh
```

На Windows:

```powershell
.\scripts\update.ps1
```

После обновления откройте `chrome://extensions/` и нажмите кнопку обновления у MooDuSh. Само расширение не перезаписывает свою папку из Chrome — это делает только внешний скрипт, запущенный пользователем.

---

## Настройка для OpenEdu (пошагово)

Для работы с OpenEdu необходим персональный токен из Telegram-бота.

### Шаг 1: Зарегистрируйтесь в боте

1. Откройте Telegram-бота: **[@paramext_bot](https://t.me/paramext_bot)**
2. Нажмите **Start** или отправьте команду `/start`
3. Бот ответит сообщением с вашим персональным токеном — скопируйте его

### Шаг 2: Настройте расширение

1. Нажмите на иконку MooDuSh на панели Chrome
2. Примите политику в первом экране popup
3. Вставьте токен в поле подключения
4. При необходимости включите **Использовать свой backend** и измените URL
5. Нажмите **Проверить** — статус должен стать **Онлайн**

### Шаг 3: Используйте на сайте

1. Откройте тест на [openedu.ru](https://openedu.ru)
2. Рядом с вопросами появятся кнопки палочки с ответами
3. Выберите подходящий режим в настройках расширения

---

## Настройка для Moodle

Moodle работает сразу после установки без дополнительной настройки токена.

1. Нажмите на иконку MooDuSh
2. Убедитесь, что выбрана вкладка **Moodle**
3. Выберите режим:
   - **Палочка** — кнопка рядом с каждым вопросом (по умолчанию)
   - **Авто-вставка** — автоматическое заполнение ответов
   - **Авто-прорешивание** — полная автоматизация (нажмите **Старт** для запуска)
4. Настройте горячую клавишу для показа/скрытия палочки (по умолчанию `Escape`)
5. Нажмите **Сохранить**

---

## Бэкенд и админ-панель

Для запуска своего OpenEdu-бэкенда:

```bash
cp env.example .env
docker compose up -d --build
```

В `.env` обязательно поменяйте:

```dotenv
POSTGRES_PASSWORD=change_me_postgres
API_TOKEN=change_me_api_token
ADMIN_TOKEN=change_me_admin_password
ADMIN_SECRET_KEY=change_me_long_random_secret
TELEGRAM_BOT_TOKEN=123456:telegram_bot_token
BOT_LINK=https://t.me/moodush_bot
```


---

## GitHub Actions и релизы

Workflow `.github/workflows/extension.yml` гоняет тесты, собирает `moodush-extension.zip` и публикует Release только по tag `v*` или ручному запуску.

### Repository Variables

| Variable | Пример | Назначение |
|----------|--------|------------|
| `OPENEDU_API_BASE_URL` | `https://paramext.ruka.me/api` | Публичный URL OpenEdu backend для popup/build config |
| `MOODLE_API_BASE_URL` | `https://syncshare.naloaty.me/api` | Публичный URL Moodle backend |
| `BOT_LINK` | `https://t.me/moodush_bot` | Ссылка на Telegram-бота для получения ключа |
| `UPDATE_CHECK_URL` | `https://paramext.ruka.me/api/v2/update` | Endpoint проверки обновлений |
| `RELEASE_PUBLIC_KEY` | публичный PEM/ключ | Публичный ключ проверки release manifest |

### Repository Secrets

| Secret | Назначение |
|--------|------------|
| `RELEASE_SIGNING_PRIVATE_KEY` | Приватный ключ для подписи `release-manifest.json` |

Во frontend build config нельзя добавлять секретные API-токены: все, что попадает в `js/build_config.js`, видно пользователю расширения.

---

## OpenEdu V2 parsing tests

Локально `npm test` дополнительно прогоняет HTML из `test-files/*.html`, если папка есть. Raw HAR/HTML могут содержать чувствительные данные, поэтому перед добавлением в репозиторий их нужно санитизировать. В CI есть fallback-fixtures, чтобы базовые тесты parser/course map работали без приватных файлов.

---

## Команды Telegram-бота

| Команда | Описание |
|---------|----------|
| `/start` | Регистрация и получение персонального токена |
| `/token` | Показать текущий токен + кнопка перегенерации |
| `/stats` | Статистика: количество тестов, вопросов и правильных ответов |
| `/help`  | Справка по командам и настройке |

---

## Настройки API

В разделе **Настройки API** (кнопка внизу popup) можно настроить подключение к бэкенду отдельно для Moodle и OpenEdu:

- **Адрес API** — URL сервера (по умолчанию `https://syncshare.naloaty.me/api` для Moodle, `https://paramext.ruka.me/api` для OpenEdu)
- **Bearer токен** — персональный токен из Telegram-бота
- **Таймаут запросов** — время ожидания ответа от сервера в миллисекундах
- **Проверить API** — проверка доступности сервера
- **Сбросить путь** — сброс адреса API к значению по умолчанию

---

## Структура проекта

```text
MooDuSh/
  manifest.json          — конфигурация расширения (Manifest V3)
  env.example            — пример переменных окружения
  scripts/update.sh      — удобное обновление через Git
  js/
    popup_new.js         — логика popup-окна расширения
    platform_settings.js — управление настройками
    content_logic.js     — контент-скрипт для Moodle
    openedu_content.js   — контент-скрипт для OpenEdu
    openedu_shared.js    — общие функции OpenEdu
    background_worker.js — фоновый Service Worker
    commons.js           — общие утилиты
    quiz_attempt.js      — обработка попыток Moodle
    quiz_board.js        — доска вопросов Moodle
    quiz_overview.js     — обзор теста Moodle
  html/
    popup/               — HTML popup-окна
  css/
    popup/               — стили popup
    widgets/             — стили виджетов (контекстное меню, палочка OpenEdu)
  python/
    app/                 — бэкенд (FastAPI + PostgreSQL + Telegram-бот)
  _locales/              — локализация (ru, en)
```

---

## FAQ

**В: Расширение не показывает ответы на OpenEdu**  
О: Проверьте, что вы зарегистрированы в [@moodush_bot](https://t.me/moodush_bot), токен вставлен в настройках API, и статус API — «Онлайн».

**В: Кнопки палочки не появляются**  
О: Убедитесь, что вы находитесь на странице теста. Попробуйте обновить страницу. Проверьте, что палочка не скрыта горячей клавишей.

**В: Как обновить расширение?**  
О: Если скачивали через Git, выполните `./scripts/update.sh`, затем обновите расширение в `chrome://extensions/`.

**В: Как вернуться на оригинальный SyncShare?**  
О: Удалите MooDuSh из `chrome://extensions/` и установите [SyncShare из Chrome Web Store](https://chromewebstore.google.com/detail/syncshare/lngijbnmdkejbgnkakeiapeppbpaapib?hl=ru&utm_source=ext_sidebar).

**В: Авто-прорешивание не переходит на следующую страницу (Moodle)**  
О: Проверьте, что текст кнопки «Далее» в настройках совпадает с текстом на странице (по умолчанию «Следующая страница»).

---

## Проблемы и предложения

Если что-то не работает или есть идеи по улучшению — создайте issue в репозитории:

**[GitHub Issues](https://github.com/KOSFin/MooDuSh-from-syncshare/issues)**

Пожалуйста, опишите:
- Что именно не работает
- На какой платформе (Moodle / OpenEdu)
- Скриншот ошибки из консоли (F12 -> Console), если есть

---

Если расширение вам помогло, поставьте звезду на GitHub — это очень мотивирует продолжать разработку!

<div align="center">

**Made with ❤️ by MooDuSh contributors**

[Оригинальный SyncShare](https://chromewebstore.google.com/detail/syncshare/lngijbnmdkejbgnkakeiapeppbpaapib?hl=ru&utm_source=ext_sidebar)

</div>
