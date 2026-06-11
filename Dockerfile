# syntax=docker/dockerfile:1

# --------------------------------------------------------------------------- #
# Stage 1: build the React frontend into static files.
# --------------------------------------------------------------------------- #
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build          # -> /web/dist

# --------------------------------------------------------------------------- #
# Stage 2: Python runtime serving the API + the built frontend, with Stockfish.
# --------------------------------------------------------------------------- #
FROM python:3.12-slim AS app
WORKDIR /app

# Stockfish engine (Linux). avx2 covers most x86-64 cloud hosts; if the
# container dies with "Illegal instruction", rebuild with a different variant,
# e.g. --build-arg SF_VARIANT=x86-64-sse41-popcnt
ARG SF_VARIANT=x86-64-avx2
ARG SF_VERSION=sf_18
ADD https://github.com/official-stockfish/Stockfish/releases/download/${SF_VERSION}/stockfish-ubuntu-${SF_VARIANT}.tar /tmp/sf.tar
RUN tar -xf /tmp/sf.tar -C /tmp \
    && mv /tmp/stockfish/stockfish-ubuntu-${SF_VARIANT} /app/stockfish \
    && chmod +x /app/stockfish \
    && rm -rf /tmp/sf.tar /tmp/stockfish

# Python dependencies.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code + the built frontend (server.py serves frontend/dist).
COPY server.py blindfold_chess.py ./
COPY --from=web /web/dist ./frontend/dist

# APP_PASSWORD must be supplied at runtime — the server refuses to start without it.
# Set it in your hosting dashboard (Render > Environment) or via -e APP_PASSWORD=...
# APP_SECRET is optional; if omitted it is derived from APP_PASSWORD.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
