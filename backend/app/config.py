"""应用配置（pydantic-settings）。

全部带本地默认值，零 .env 也能启动；云端通过环境变量覆盖。
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ---- 数据库 ----
    # 本地默认 SQLite；云端切 postgresql+asyncpg://sfmini:***@postgres:5432/sfmini
    database_url: str = "sqlite+aiosqlite:///./sfmini.db"

    # ---- 事件总线 ----
    # memory（默认，进程内）| redis（设置 redis_url 后可用）
    event_backend: str = "memory"
    redis_url: str = "redis://localhost:6379/0"

    # 强制 NullPool（测试用：每次新连接、用完即关，避免跨事件循环复用连接）
    db_null_pool: bool = False

    # ---- 工件 blob 存储 ----
    blob_dir: str = "./data/blob"

    # ---- 鉴权（单工作区 Bearer）----
    auth_bearer_token: str = "dev-single-workspace-token"

    # ---- 密钥加密（AES-256-GCM 主密钥，base64 的 32 字节）----
    # 支持 "base64:xxxx" 或纯 base64。本地默认 dev key，生产务必覆盖。
    secrets_master_key: str = "base64:c2ZtaW5pLWRldi1tYXN0ZXIta2V5LTMyYnl0ZXMhISE="

    # ---- LLM Provider ----
    # stub（默认，离线确定性）| anthropic | pi（内嵌 pi-agent-core 的 agent-service）
    # 默认保持 stub：本地零依赖 + CI 回归底线。需 Pi 时显式设 LLM_PROVIDER=pi。
    llm_provider: str = "stub"
    llm_api_key: str = ""
    llm_model: str = "claude-3-5-sonnet-20241022"

    # ---- Pi agent-service 基址（Phase 1+ pi provider 用）----
    # 本地默认 localhost；云端 docker-compose 覆盖为 http://agent-service:9100/v1
    pi_base: str = "http://localhost:9100/v1"
    pi_ws_base: str = "ws://localhost:9100/v1"


settings = Settings()
