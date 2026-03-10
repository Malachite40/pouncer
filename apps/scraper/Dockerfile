FROM python:3.12-slim-trixie

WORKDIR /app

# Install uv for fast dependency management (pinned version)
COPY --from=ghcr.io/astral-sh/uv:0.6.6 /uv /usr/local/bin/uv

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup appuser

# Install dependencies only (without the project itself)
COPY apps/scraper/pyproject.toml apps/scraper/uv.lock* ./
RUN uv sync --frozen --no-dev --no-install-project || uv sync --no-dev --no-install-project
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN uv run playwright install-deps chromium && \
    uv run playwright install chromium

# Copy app code and install the project
COPY apps/scraper/app/ app/
RUN uv sync --no-dev

# Fix ownership
RUN mkdir -p /home/appuser/.cache/uv && chown -R appuser:appgroup /home/appuser
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8001/health || exit 1

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
