from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    port: int = 8001
    cors_origins: list[str] = ["http://localhost:3000"]
    scrape_workers: int = Field(default=1, ge=1, le=8)
    scrape_queue_size: int = Field(default=16, ge=1, le=256)
    scrape_enqueue_wait_ms: int = Field(default=3000, ge=0, le=30000)
    scrape_job_timeout_ms: int = Field(default=45000, ge=1000, le=300000)
    scrape_timeout: int = 15
    dynamic_wait_ms: int = 1500
    dynamic_wait_selector_state: str = "attached"
    dynamic_default_wait_selector: str = "body"
    browser_user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    )
    browser_accept_language: str = "en-US,en;q=0.9"
    browser_launch_timeout_ms: int = Field(default=15000, ge=1000, le=120000)
    page_navigation_timeout_ms: int = Field(default=30000, ge=1000, le=120000)
    page_selector_timeout_ms: int = Field(default=5000, ge=1000, le=60000)
    browser_restart_attempts: int = Field(default=2, ge=1, le=10)
    browser_restart_backoff_ms: int = Field(default=1000, ge=0, le=30000)
    max_content_length: int = 5000
    health_stuck_grace_ms: int = Field(default=5000, ge=0, le=60000)


settings = Settings()
