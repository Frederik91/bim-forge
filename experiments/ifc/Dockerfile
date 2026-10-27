FROM python:3.12.11-slim-bookworm
COPY requirements.txt /opt/w2/requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: -r /opt/w2/requirements.txt
WORKDIR /workspace
ENV PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["python", "experiments/ifc/run.py"]
