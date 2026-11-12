import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ProcessVideoOptions {
  mode: 'reels' | 'circle';
  mirror?: boolean;
  inputMimeType?: string;
}

export interface ProcessedVideoResult {
  outputPath: string;
  cleanup: () => void;
  wasConverted: boolean;
}

/**
 * Resolves ffmpeg binary path on macOS / Linux
 */
function getFfmpegCommand(): string {
  const candidates = [
    process.env.FFMPEG_PATH,
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    'ffmpeg',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === 'ffmpeg' || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'ffmpeg';
}

/**
 * Processes recorded video buffer (WebM or MP4) into a Telegram/iOS compatible H.264 MP4 file.
 * - For 'circle' mode: crops to 1:1 square (640x640) and caps at 60s for Telegram Video Note.
 * - For 'reels' mode: keeps aspect ratio (9:16) with even dimensions and faststart.
 */
export async function processRecordedVideo(
  inputBuffer: Buffer,
  options: ProcessVideoOptions
): Promise<ProcessedVideoResult> {
  const tmpDir = os.tmpdir();
  const id = `prompter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ext = options.inputMimeType?.includes('mp4') ? 'mp4' : 'webm';
  const inputPath = path.join(tmpDir, `${id}_in.${ext}`);
  const outputPath = path.join(tmpDir, `${id}_out.mp4`);

  await fs.promises.writeFile(inputPath, inputBuffer);

  const cleanup = () => {
    fs.promises.unlink(inputPath).catch(() => {});
    fs.promises.unlink(outputPath).catch(() => {});
  };

  const vfFilters: string[] = [];

  if (options.mode === 'circle') {
    // Center crop to 1:1 square and scale to 640x640 (Telegram Video Note standard)
    vfFilters.push("crop='min(iw,ih)':'min(iw,ih)'", 'scale=640:640');
  } else {
    // Ensure dimensions are divisible by 2 for yuv420p H.264 encoder
    vfFilters.push("scale='trunc(iw/2)*2':'trunc(ih/2)*2'");
  }

  if (options.mirror) {
    vfFilters.push('hflip');
  }

  vfFilters.push('format=yuv420p');

  const args: string[] = [
    '-y',
    '-i',
    inputPath,
    '-vf',
    vfFilters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-r',
    '30',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '1',
    '-movflags',
    '+faststart',
  ];

  if (options.mode === 'circle') {
    // Telegram Video Notes strictly max 60 seconds
    args.push('-t', '60');
  }

  args.push(outputPath);

  try {
    const ffmpegBin = getFfmpegCommand();
    await execFileAsync(ffmpegBin, args, { timeout: 60000 });

    if (fs.existsSync(outputPath)) {
      return {
        outputPath,
        cleanup,
        wasConverted: true,
      };
    }
  } catch (err: any) {
    console.warn('[VideoProcessor] FFmpeg processing warning, using raw input fallback:', err.message);
  }

  // Fallback to raw input file if ffmpeg is unavailable
  return {
    outputPath: inputPath,
    cleanup,
    wasConverted: false,
  };
}
