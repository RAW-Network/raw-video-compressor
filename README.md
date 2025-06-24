# ✨ RAW Video Compressor

A fast, self-hosted video compressor with smart GPU acceleration, built on Node.js, FFmpeg, and Docker. Clean UI. Instant results. Fully yours.

---

## 🔍 Preview

![App Preview](https://i.imgur.com/NDPLsRT.png)

---

## ✨ Features

* 🎯 **Target-Size Compression**: Set a maximum file size, and the app intelligently adjusts quality to meet your target.
* 🚀 **GPU Hardware Acceleration**: Leverages FFmpeg with VA-API for blazing-fast encoding on supported Intel & AMD GPUs, drastically reducing CPU load.
* 💻 **Modern & Professional UI**: A clean, responsive, and user-friendly interface for a seamless experience.
* 📂 **Flexible Uploads**: Supports both file selection and an intuitive drag-and-drop mechanism.
* 📊 **Dual-Stage Progress Bar**: Clear visual feedback for both Uploading and Compressing stages.
* 🌙 **Smart Theme Modes**: Features 3 themes (Light, Dark, System) with preferences saved locally.
* 📦 **Dockerized & Portable**: Packaged in a lightweight Alpine Linux Docker image for maximum portability and easy deployment.
* 🧹 **Auto-Cleanup**: Compressed files are automatically deleted from the server after one hour to save space.

---

## 🚀 Installation and Usage Guide

Follow these steps to download and run the project on your machine.

### 🔧 Prerequisites

* Git
* Node.js (v18 or later)
* FFmpeg *(Only required for local runs without Docker)*
* Docker & Docker Compose

### ▶️ Run with Docker (Recommended)

```yaml
services:
  raw-video-compressor:
    image: ghcr.io/raw-network/raw-video-compressor:latest
    container_name: raw-video-compressor
    ports:
      - 3000:3000
    devices:
      - /dev/dri
    volumes:
      - ./compressed:/usr/src/app/compressed
      - ./uploads:/usr/src/app/uploads
    environment:
      - MAX_VIDEO_UPLOAD_SIZE=512M
      - FORCE_CPU_ENCODER=true
      - TZ=Asia/Makassar
    restart: unless-stopped
```

2. Run the application:

```bash
docker compose up -d
```

3. Access the application at:

```
http://localhost:3000
```

4. To stop the application:

```bash
docker compose down
```

---

## 💡 Hardware Acceleration (VA-API)

To enable GPU acceleration, you must pass your host machine's DRI devices to the container.

> ⚠️ Ensure the Docker user has permission to access `/dev/dri` (typically by being in the `render` or `video` group).

---

## ⚙️ Configuration

Customize the application using environment variables in `docker-compose.yml`.

| Variable                | Description                              | Default |
| ----------------------- | ---------------------------------------- | ------- |
| `MAX_VIDEO_UPLOAD_SIZE` | Maximum allowed size for uploads         | 1024M   |
| `TZ`                    | Sets the container's timezone            | UTC     |
| `FORCE_CPU_ENCODER`     | Set to `true` to force software encoding | false   |

Example:

```yaml
environment:
  - MAX_VIDEO_UPLOAD_SIZE=2G
  - FORCE_CPU_ENCODER=true
  - TZ=Asia/Makassar
```

---

## 💻 Option 2: Run Locally with Node.js (Development)

1. Make sure FFmpeg is installed and available globally:

```bash
ffmpeg -version
```

2. Clone the repository:

```bash
git clone https://github.com/raw-network/raw-video-compressor.git
cd raw-video-compressor
```

3. Install dependencies:

```bash
npm install
```

4. Start the server:

```bash
node server.js
```

5. Open your browser at:
   [http://localhost:3000](http://localhost:3000)

---

## 🛠️ Tech Stack

* **Backend**: Node.js, Express.js
* **Frontend**: HTML5, CSS3, Vanilla JavaScript
* **Video Processing**: FFmpeg (VA-API supported)
* **Real-time UI**: Server-Sent Events (SSE)
* **Containerization**: Docker, Docker Compose
* **File Handling**: Multer

---

## 📂 Project Structure

```
.
├── public/                # Frontend assets (HTML, CSS, JS)
│   ├── index.html
│   └── style.css
├── .dockerignore          # Specifies files to ignore in Docker context
├── docker-compose.yml     # Orchestration file for Docker
├── Dockerfile             # Recipe for building the Docker image
├── entrypoint.sh          # Custom startup script for container
├── LICENSE                # Project's MIT License
├── package.json           # Project dependencies and scripts
└── server.js              # Core backend logic (server, FFmpeg, SSE)
```

---

## 📄 License

This project is licensed under the **MIT License**.
See the [LICENSE](./LICENSE) file for details.
