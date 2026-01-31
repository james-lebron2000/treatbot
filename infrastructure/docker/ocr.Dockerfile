# OCR Service Dockerfile (Python Flask)
FROM python:3.11-slim

WORKDIR /app

# Install curl for health checks and other dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY python_ocr_service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy service source code
COPY python_ocr_service/ ./

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 5002

CMD ["python", "ocr_server.py"]
