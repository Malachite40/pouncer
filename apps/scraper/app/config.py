from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    port: int = 8001
    cors_origins: list[str] = ["http://localhost:3000"]
    scrape_workers: int = Field(default=2, ge=1, le=8)
    scrape_queue_size: int = Field(default=16, ge=1, le=256)
    scrape_enqueue_wait_ms: int = Field(default=3000, ge=0, le=30000)
    scrape_job_timeout_ms: int = Field(default=45000, ge=1000, le=300000)
    scrape_timeout: int = 15
    dynamic_timeout_ms: int = 30000
    dynamic_wait_ms: int = 1500
    dynamic_fetch_retries: int = Field(default=2, ge=1, le=5)
    dynamic_retry_backoff_ms: int = Field(default=1000, ge=0, le=10000)
    dynamic_wait_selector_state: str = "visible"
    dynamic_default_wait_selector: str = "body"
    max_content_length: int = 5000
    health_stuck_grace_ms: int = Field(default=5000, ge=0, le=60000)


settings = Settings()
