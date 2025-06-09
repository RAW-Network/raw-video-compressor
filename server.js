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

const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) => cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'))
});
const upload = multer({ storage });

const jobs = {};

app.use(express.static('public'));
app.use('/compressed', express.static(path.join(__dirname, 'compressed')));

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
        console.error('Upload Error:', err.message);
        if (req.file) fs.unlink(req.file.path, () => {});
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
    
    const outputFilename = `compressed-${path.parse(job.originalName).name}-${Date.now()}.mp4`;
    const outputPath = path.join(compressedDir, outputFilename);

    const ffmpeg = spawn('ffmpeg', [
        '-y', '-i', job.inputPath,
        '-c:v', 'libx264', '-b:v', `${videoBitrate}k`,
        '-c:a', 'aac', '-b:a', `${audioBitrate}k`,
        '-progress', 'pipe:1',
        outputPath
    ]);

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
        for (const line of lines) {
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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
