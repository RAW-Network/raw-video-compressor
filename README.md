# RAW Video Compressor 🎬

A simple, self-hosted video compressor application. Built with Node.js, FFmpeg, and Docker. 🎬

---

## ✨ Features

* **🎯 Target-Size Compression**: Set a maximum output file size, and the application will automatically adjust the compression quality to meet the target.
* **💫 Modern & Professional UI**: A clean, responsive, and user-friendly interface with refined typography.
* **📄 Easy Uploads**: Supports file selection via a button or an intuitive drag-and-drop mechanism.
* **📊 Dual-Stage Progress Bar**: Provides clear visual feedback for both Uploading and Compressing stages.
* **🌙 Smart Dark Mode**: Features 3 theme modes (Light, Dark, and System) with preferences saved in the browser.
* **📦 Dockerized & Portable**: Packaged in a lightweight Alpine Linux Docker image for maximum portability.
* **🧹 Auto-Cleanup**: Compressed files are automatically deleted from the server after one hour.

---

## 🛠️ Tech Stack

* **Backend**: Node.js, Express.js
* **Frontend**: HTML5, CSS3, Vanilla JavaScript
* **Video Processing**: FFmpeg
* **Real-time Communication**: Server-Sent Events (SSE)
* **Containerization**: Docker, Docker Compose
* **File Handling**: Multer

---

## 🚀 Installation and Usage Guide

Follow these steps to download and run the project on your machine.

### 🔧 Prerequisites

Make sure you have the following installed:

* Git
* Node.js (v18 or later)
* FFmpeg *(Only required for local runs without Docker)*
* Docker & Docker Compose

---

### 📅 Initial Setup

Clone the repository:

```bash
git clone https://github.com/raw-network/raw-video-compressor.git
cd raw-video-compressor
```

---

### 🐳 Option 1: Run with Docker (Recommended)

This is the easiest and most consistent method.

1. Make sure Docker is running.
2. Build and run the container:

```bash
docker compose up --build -d
```

* `--build`: Builds the image on first run or after changes.
* `-d`: Runs the container in detached mode.

3. Open your browser at:
   [http://localhost:3000](http://localhost:3000)

To stop the application:

```bash
docker compose down
```

---

### 💻 Option 2: Run Locally with Node.js (Development)

1. Make sure FFmpeg is installed and available globally:

```bash
ffmpeg -version
```

2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
node server.js
```

4. Open your browser at:
   [http://localhost:3000](http://localhost:3000)

---

## 📂 Project Structure

```
.
├── docker-compose.yml     # Orchestration file for Docker
├── Dockerfile             # Recipe for building the Docker image
├── package.json           # Project dependencies and scripts
├── server.js              # Backend logic (server, FFmpeg, SSE)
└── public/                # Frontend assets
    ├── index.html         # Web page structure
    └── style.css          # Web page styling
```

---

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](./LICENSE) file for details.
