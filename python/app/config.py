from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    app_name: str = 'MooDuSh OpenEdu Бэкенд'
    app_env: str = 'development'
    app_host: str = '0.0.0.0'
    app_port: int = 8000

    database_host: str = Field(default='postgres', alias='DATABASE_HOST')
    database_port: int = Field(default=5432, alias='DATABASE_PORT')
    database_name: str = Field(default='paramext', alias='DATABASE_NAME')
    database_user: str = Field(default='paramext', alias='DATABASE_USER')
    database_password: str = Field(default='paramext', alias='DATABASE_PASSWORD')
    database_min_connections: int = Field(default=4, alias='DATABASE_MIN_CONNECTIONS')
    database_max_connections: int = Field(default=40, alias='DATABASE_MAX_CONNECTIONS')
    database_repair_interval_seconds: int = Field(default=300, alias='DATABASE_REPAIR_INTERVAL_SECONDS')

    api_bearer_token: str = Field(default='', alias='API_BEARER_TOKEN')
    api_token: str = Field(default='', alias='API_TOKEN')
    admin_token: str = Field(default='changeme-admin-token', alias='ADMIN_TOKEN')
    admin_secret_key: str = Field(default='change-me-admin-secret', alias='ADMIN_SECRET_KEY')

    bot_link: str = Field(default='', alias='BOT_LINK')

    telegram_bot_token: str = Field(default='', alias='TELEGRAM_BOT_TOKEN')
    telegram_chat_id: str = Field(default='', alias='TELEGRAM_CHAT_ID')
    telegram_topic_id: int = Field(default=0, alias='TELEGRAM_TOPIC_ID')
    telegram_proxy_url: str = Field(default='', alias='TELEGRAM_PROXY_URL')

    extension_latest_version: str = Field(default='2.9.4', alias='EXTENSION_LATEST_VERSION')
    extension_release_url: str = Field(default='', alias='EXTENSION_RELEASE_URL')
    extension_repository_url: str = Field(default='', alias='EXTENSION_REPOSITORY_URL')
    extension_required_version: str = Field(default='', alias='EXTENSION_REQUIRED_VERSION')
    extension_known_build_ids: str = Field(default='', alias='EXTENSION_KNOWN_BUILD_IDS')
    openedu_known_parser_versions: str = Field(default='', alias='OPENEDU_KNOWN_PARSER_VERSIONS')
    v2_rate_limit_per_minute: int = Field(default=120, alias='V2_RATE_LIMIT_PER_MINUTE')


settings = Settings()
