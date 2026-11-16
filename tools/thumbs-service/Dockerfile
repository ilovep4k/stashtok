FROM python:3.12-slim

RUN pip install --no-cache-dir pillow

WORKDIR /app
COPY app.py /app/app.py

ENV PORT=8080 CACHE_DIR=/cache MAX_WIDTH=1280
EXPOSE 8080
CMD ["python", "-u", "/app/app.py"]