const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

const uploadsDir = path.join(__dirname, 'uploads');
const compressedDir = path.join(__dirname, 'compressed');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(compressedDir, { recursive: true });

const parseSizeToBytes = (sizeStr) => {
    const size = parseFloat(sizeStr);
    const unit = sizeStr.toUpperCase().slice(-1);
    switch (unit) {
        case 'G': return size * 1024 * 1024 * 1024;
        case 'M': return size * 1024 * 1024;
        case 'K': return size * 1024;
        default: return size;
    }
};

const maxUploadSize = process.env.MAX_VIDEO_UPLOAD_SIZE || '1024M';
const maxUploadSizeBytes = parseSizeToBytes(maxUploadSize);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const randomName = crypto.randomBytes(16).toString('hex');
        const extension = path.extname(file.originalname);
        cb(null, `${randomName}${extension}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: maxUploadSizeBytes },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type! Only video files are allowed.'), false);
        }
    }
});

let jobs = {};
let encoderSettings;

const getGpuVendor = () => {
    return new Promise((resolve) => {
        const platform = process.platform;
        let command;
        if (platform === 'win32') {
            command = 'powershell -command "Get-CimInstance -ClassName Win32_VideoController | Select-Object -ExpandProperty Name"';
        } else if (platform === 'linux') {
            command = 'lspci | grep -i vga';
        } else {
            return resolve(null);
        }
        exec(command, (error, stdout) => {
            if (error) return resolve(null);
            const output = stdout.toLowerCase();
            if (output.includes('nvidia')) return resolve('NVIDIA');
            if (output.includes('amd') || output.includes('radeon')) return resolve('AMD');
            if (output.includes('intel')) return resolve('INTEL');
            resolve(null);
        });
    });
};

const detectGpuAndEncoder = async () => {
    if (process.env.FORCE_CPU_ENCODER === 'true') {
        console.log("🚫 FORCE_CPU_ENCODER is set, using CPU-based encoder.");
        return { codec: 'libx264', hwaccel: null, type: 'CPU (forced)' };
    }

    const vendor = await getGpuVendor();
    if (vendor) {
        try {
            const ffmpegEncoders = await new Promise((resolve, reject) => {
                exec('ffmpeg -encoders', (error, stdout) => {
                    if (error) return reject();
                    resolve(stdout);
                });
            });

            if (vendor === 'NVIDIA' && ffmpegEncoders.includes('h264_nvenc')) {
                console.log("✅ Found NVIDIA GPU with h264_nvenc encoder.");
                return { codec: 'h264_nvenc', hwaccel: 'cuda', type: 'NVIDIA GPU' };
            }

            if (vendor === 'AMD') {
                if (process.platform === 'win32' && ffmpegEncoders.includes('h264_amf')) {
                    console.log("✅ Found AMD GPU with h264_amf encoder for Windows.");
                    return { codec: 'h264_amf', hwaccel: 'd3d11va', type: 'AMD GPU (Windows)' };
                }
                if (process.platform === 'linux' && ffmpegEncoders.includes('h264_vaapi')) {
                    console.log("✅ Found AMD GPU with h264_vaapi encoder for Linux.");
                    return { codec: 'h264_vaapi', hwaccel: 'vaapi', type: 'AMD GPU (Linux)' };
                }
            }

            if (vendor === 'INTEL') {
                if (process.platform === 'win32' && ffmpegEncoders.includes('h264_qsv')) {
                    console.log("✅ Found Intel GPU with h264_qsv encoder on Windows.");
                    return { codec: 'h264_qsv', hwaccel: 'qsv', type: 'Intel GPU (Windows)' };
                }
                if (process.platform === 'linux' && ffmpegEncoders.includes('h264_vaapi')) {
                    console.log("✅ Found Intel GPU using h264_vaapi on Linux.");
                    return { codec: 'h264_vaapi', hwaccel: 'vaapi', type: 'Intel GPU (Linux)' };
                }
            }
        } catch (error) {}
    }

    console.log("🟡 GPU not detected or encoder not compatible. Using CPU.");
    return { codec: 'libx264', hwaccel: null, type: 'CPU' };
};

const clearCompressedDirectoryOnStartup = async () => {
    console.log(`🧹 Clearing all files in compressed directory on startup`);

    try {
        const files = await fsp.readdir(compressedDir);
        for (const file of files) {
            const filePath = path.join(compressedDir, file);
            try {
                await fsp.unlink(filePath);
                console.log(`🗑️ Deleted file: ${file}`);
            } catch (fileErr) {
                console.error(`Could not delete file ${file}:`, fileErr);
            }
        }
    } catch (err) {
        console.error('Error while clearing compressed directory:', err);
    }
};

app.use(express.static('public'));
app.use('/compressed', express.static(path.join(__dirname, 'compressed')));

app.get('/config', (req, res) => {
    res.json({ maxUploadSize: maxUploadSize });
});

const uploaderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many upload requests from this IP, please try again after 15 minutes." }
});

const handleUploadErrors = (req, res, next) => {
    const uploadMiddleware = upload.single('video');

    uploadMiddleware(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: `File is too large. Maximum size is ${maxUploadSize}.` });
            }
            return res.status(400).json({ error: err.message });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
};

app.post('/upload', uploaderLimiter, handleUploadErrors, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video was uploaded.' });
    }

    try {
        const inputPath = req.file.path;
        const getDuration = new Promise((resolve, reject) => {
            const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
            exec(durationCmd, (error, stdout, stderr) => {
                if (error) return reject(new Error('Failed to analyze video.'));
                const duration = parseFloat(stdout);
                if (isNaN(duration)) return reject(new Error('Invalid video duration.'));
                resolve(duration);
            });
        });
        const totalDuration = await getDuration;
        const jobId = crypto.randomBytes(16).toString('hex');
        jobs[jobId] = {
            inputPath,
            totalDuration,
            targetSizeMB: parseFloat(req.body.maxSize),
            originalName: req.file.originalname,
            status: 'pending'
        };
        res.json({ jobId });
    } catch (err) {
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(500).json({ error: err.message });
    }
});

app.get('/stream/:jobId', (req, res) => {
    req.setTimeout(0);
    const job = jobs[req.params.jobId];
    if (!job || job.status !== 'pending') return res.status(404).send('Job not found or already running.');
    job.status = 'processing';
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const sendEvent = (data) => {
        if (!res.finished) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const totalBitrate = (job.targetSizeMB * 8192) / job.totalDuration;
    const videoBitrate = Math.floor(totalBitrate * 0.8);
    const audioBitrate = Math.min(128, Math.floor(totalBitrate * 0.2));
    const originalNameWithoutExt = path.basename(job.originalName, path.extname(job.originalName));
    const sanitizedName = originalNameWithoutExt.replace(/[^a-zA-Z0-9 .-]/g, '').trim();
    const outputFilename = `${sanitizedName}_RAW-VideoCompress.mp4`;
    const outputPath = path.join(compressedDir, outputFilename);
    const inputArgs = [];
    const filterArgs = [];
    if (encoderSettings.codec === 'h264_vaapi') {
        inputArgs.push('-vaapi_device', '/dev/dri/renderD128');
        filterArgs.push('-vf', 'format=nv12,hwupload');
    } else if (encoderSettings.codec === 'h264_qsv') {
        inputArgs.push('-hwaccel', 'qsv');
    } else if (encoderSettings.hwaccel) {
        inputArgs.push('-hwaccel', encoderSettings.hwaccel);
    }
    const ffmpegArgs = [
        '-y',
        ...inputArgs,
        '-i', job.inputPath,
        ...filterArgs,
        '-c:v', encoderSettings.codec,
        ...(encoderSettings.codec === 'h264_vaapi' && encoderSettings.type.includes('Intel')
            ? ['-qp', '24']
            : ['-b:v', `${videoBitrate}k`]),
        '-c:a', 'aac',
        '-b:a', `${audioBitrate}k`,
        '-progress', 'pipe:1',
        outputPath
    ];
    console.log(`[Job ${req.params.jobId}] Spawning ffmpeg with method: ${encoderSettings.type}`);
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let lastProgress = -1;
    const cleanup = () => {
        if (!jobs[req.params.jobId]) return;
        fs.unlink(job.inputPath, () => {});
        delete jobs[req.params.jobId];
        if (!res.finished) res.end();
    };
    let progressData = '';
    ffmpeg.stdout.on('data', (chunk) => {
        progressData += chunk.toString();
        const lines = progressData.split('\n');
        for (const line of lines.slice(0, -1)) {
            const match = line.match(/out_time_ms=(\d+)/);
            if (match) {
                const currentTime = parseInt(match[1], 10) / 1000000;
                const progress = Math.round((currentTime / job.totalDuration) * 100);
                if (progress > lastProgress) {
                    sendEvent({ type: 'progress', value: progress });
                    lastProgress = progress;
                }
            }
        }
        progressData = lines[lines.length - 1];
    });
    ffmpeg.stderr.on('data', (data) => {
        console.log(`FFmpeg stderr: ${data}`);
    });
    ffmpeg.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
            sendEvent({ type: 'progress', value: 100 });
            sendEvent({ type: 'done', downloadUrl: `/compressed/${outputFilename}` });
            const deleteAt = new Date(Date.now() + 60 * 60 * 1000);
            console.log(`[Job ${req.params.jobId}] File "${outputFilename}" scheduled for deletion at: ${deleteAt.toLocaleString()}`);
            setTimeout(() => {
                fs.unlink(outputPath, () => {
                    console.log(`[Job ${req.params.jobId}] File "${outputFilename}" deleted at: ${new Date().toLocaleString()}`);
                });
            }, 60 * 60 * 1000);
        } else {
            fs.unlink(outputPath, () => {});
            sendEvent({ type: 'error', message: 'Compression failed or was cancelled. Check server logs.' });
        }
        cleanup();
    });
    req.on('close', () => {
        console.log(`Client connection for job ${req.params.jobId} closed, stopping ffmpeg...`);
        ffmpeg.kill('SIGINT');
    });
});

(async () => {
    encoderSettings = await detectGpuAndEncoder();
    app.listen(PORT, () => {
        console.log(`\n🚀 Server is running on http://localhost:${PORT}`);
        console.log(`🎥 Using video encoder: ${encoderSettings.codec} (Type: ${encoderSettings.type})`);
        console.log(`🔒 Maximum upload size set to: ${maxUploadSize}`);

        clearCompressedDirectoryOnStartup();
    });
})();
