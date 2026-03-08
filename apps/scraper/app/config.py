from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    port: int = 8001
    cors_origins: list[str] = ["http://localhost:3000"]
    scrape_timeout: int = 15
    dynamic_timeout_ms: int = 30000
    dynamic_wait_ms: int = 1500
    dynamic_wait_selector_state: str = "visible"
    dynamic_default_wait_selector: str = "body"
    max_content_length: int = 5000


settings = Settings()
