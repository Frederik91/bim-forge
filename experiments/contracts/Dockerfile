FROM bim-issue-109-candidate:latest
USER 0:0
RUN apt-get update \
    && apt-get install -y --no-install-recommends git postgresql-client python3 python3-venv ca-certificates libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
