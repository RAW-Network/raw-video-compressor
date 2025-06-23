const express = require('express');
const multer = require('multer');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
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
        case 'G':
            return size * 1024 * 1024 * 1024;
        case 'M':
            return size * 1024 * 1024;
        case 'K':
            return size * 1024;
        default:
            return size;
    }
};

const maxUploadSize = process.env.MAX_VIDEO_UPLOAD_SIZE || '1024M';
const maxUploadSizeBytes = parseSizeToBytes(maxUploadSize);

const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) => cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'))
});

const upload = multer({
    storage,
    limits: {
        fileSize: maxUploadSizeBytes
    }
});

const jobs = {};
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
            if (error) {
                return resolve(null);
            }
            const output = stdout.toLowerCase();
            if (output.includes('nvidia')) {
                return resolve('NVIDIA');
            }
            if (output.includes('amd') || output.includes('advanced micro devices') || output.includes('radeon')) {
                return resolve('AMD');
            }
            if (output.includes('intel')) {
                return resolve('INTEL');
            }
            resolve(null);
        });
    });
};

const detectGpuAndEncoder = async () => {
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
                    return { codec: 'h264_amf', hwaccel: 'd3d11va', type: 'AMD GPU' };
                }
                if (process.platform === 'linux' && ffmpegEncoders.includes('h264_vaapi')) {
                    console.log("✅ Found AMD GPU with h264_vaapi encoder for Linux.");
                    return { codec: 'h264_vaapi', hwaccel: 'vaapi', type: 'AMD GPU' };
                }
            }

            if (vendor === 'INTEL' && ffmpegEncoders.includes('h264_qsv')) {
                console.log("✅ Found Intel GPU with h264_qsv encoder.");
                return { codec: 'h264_qsv', hwaccel: 'qsv', type: 'Intel GPU' };
            }
        } catch (error) {
        }
    }

    console.log("🟡 GPU not detected or encoder not compatible. Using CPU.");
    return { codec: 'libx264', hwaccel: null, type: 'CPU' };
};

app.use(express.static('public'));
app.use('/compressed', express.static(path.join(__dirname, 'compressed')));

app.get('/config', (req, res) => {
    res.json({
        maxUploadSize: maxUploadSize
    });
});

app.post('/upload', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video was uploaded.' });
    }
    try {
        const inputPath = req.file.path;

        const getDuration = new Promise((resolve, reject) => {
            const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
            exec(durationCmd, (error, stdout, stderr) => {
                if (error) {
                    console.error(`ffprobe error: ${stderr}`);
                    return reject(new Error('Failed to analyze video.'));
                }
                const duration = parseFloat(stdout);
                if (isNaN(duration)) {
                    return reject(new Error('Invalid video duration.'));
                }
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
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
             console.error(`Upload Error: ${err.message}. File size exceeds the ${maxUploadSize} limit.`);
             return res.status(413).json({ error: `File is too large. Maximum size is ${maxUploadSize}.` });
        }
        
        console.error('Upload Error:', err.message);
        if (req.file) fs.unlink(req.file.path, () => { });
        res.status(500).json({ error: err.message });
    }
});

app.get('/stream/:jobId', (req, res) => {
    req.setTimeout(0);

    const job = jobs[req.params.jobId];
    if (!job || job.status !== 'pending') {
        return res.status(404).send('Job not found or already running.');
    }

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

    if (encoderSettings.codec === 'h264_qsv') {
        inputArgs.push('-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw');
        filterArgs.push('-vf', 'hwupload=extra_hw_frames=64');
    } else if (encoderSettings.hwaccel) {
        inputArgs.push('-hwaccel', encoderSettings.hwaccel);
    }
    
    const ffmpegArgs = [
        '-y',
        ...inputArgs,
        '-i', job.inputPath,
        ...filterArgs,
        '-c:v', encoderSettings.codec,
        '-b:v', `${videoBitrate}k`,
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
        fs.unlink(job.inputPath, (err) => {
            if (err) console.error(`Failed to delete uploaded file ${job.inputPath}:`, err.message);
        });
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

            const oneHourInMs = 60 * 60 * 1000;
            console.log(`File ${outputFilename} is scheduled for deletion in 1 hour.`);
            setTimeout(() => {
                fs.unlink(outputPath, (err) => {
                    if (err) {
                        console.error(`Failed to delete scheduled file ${outputFilename}: ${err.message}`);
                        return;
                    }
                    console.log(`File ${outputFilename} was automatically deleted.`);
                });
            }, oneHourInMs);
        } else {
            fs.unlink(outputPath, () => { });
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
    });
})();
