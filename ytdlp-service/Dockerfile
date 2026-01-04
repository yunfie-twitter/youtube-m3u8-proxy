FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including Deno
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    unzip \
    ffmpeg && \
    # Install Deno (required for yt-dlp YouTube support)
    curl -fsSL https://deno.land/install.sh | sh && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Add Deno to PATH
ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"

# Verify Deno installation
RUN deno --version

# Install Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Start server
CMD ["python", "app.py"]
