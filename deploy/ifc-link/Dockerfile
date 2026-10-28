FROM python:3.12-slim-bookworm
WORKDIR /converter
COPY experiments/ifc/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt
COPY experiments/ifc-link/link.py experiments/ifc-link/runtime_worker.py ./
ENV PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
USER 65032:33
ENTRYPOINT ["python", "runtime_worker.py", "/spool"]
