FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
COPY data/processed/ehr_cols.json data/processed/ts_channels.json ./data/processed/
COPY data/processed/scaler_ehr.pkl data/processed/scaler_ts.pkl ./data/processed/
COPY data/demo/ ./data/raw/
COPY results/ ./results/

EXPOSE 8000
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]