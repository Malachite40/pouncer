FROM rust:1.93-slim-bookworm AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY apps/scraper-rs/Cargo.toml apps/scraper-rs/Cargo.lock ./
COPY apps/scraper-rs/src/ src/
COPY apps/scraper-rs/tests/ tests/
COPY apps/scraper-rs/scripts/ scripts/

RUN cargo build --release

FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    chromium-driver \
    curl && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup appuser

COPY --from=builder /app/target/release/pounce-scraper-rs /usr/local/bin/pounce-scraper-rs

ENV PORT=8002
ENV CHROME_BINARY_PATH=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver

USER appuser

EXPOSE 8002

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8002/health || exit 1

CMD ["pounce-scraper-rs"]
