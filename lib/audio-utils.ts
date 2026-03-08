import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';

/**
 * Get WAV file duration by parsing the header directly
 * WAV format: RIFF header + fmt chunk + data chunk
 */
function getWavDuration(filePath: string): number | null {
  try {
    // Read larger buffer to ensure we can find fmt and data chunks
    // fmt chunk typically at offset 12, data chunk typically at offset 36-44+
    const buffer = Buffer.alloc(1024);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
    fs.closeSync(fd);

    if (bytesRead < 44) {
      return null;
    }

    // Check RIFF header
    const riff = buffer.toString('ascii', 0, 4);
    if (riff !== 'RIFF') {
      return null;
    }

    // Check WAVE format
    const wave = buffer.toString('ascii', 8, 12);
    if (wave !== 'WAVE') {
      return null;
    }

    // Find fmt chunk (starts at offset 12)
    // fmt chunk: chunkID (4) + chunkSize (4) + audioFormat (2) + numChannels (2) + sampleRate (4) + byteRate (4) + blockAlign (2) + bitsPerSample (2)
    let offset = 12;
    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === 'fmt ') {
        const numChannels = buffer.readUInt16LE(offset + 10);
        const sampleRate = buffer.readUInt32LE(offset + 12);
        const bitsPerSample = buffer.readUInt16LE(offset + 22);

        // Find data chunk
        let dataOffset = offset + 24 + chunkSize;
        while (dataOffset < 1024) { // Search within reasonable bounds
          const dataChunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
          if (dataChunkId === 'data') {
            const dataSize = buffer.readUInt32LE(dataOffset + 4);
            // Duration = data size / (sample rate * channels * bytes per sample)
            const bytesPerSample = bitsPerSample / 8;
            const duration = dataSize / (sampleRate * numChannels * bytesPerSample);
            return duration;
          }
          const nextChunkSize = buffer.readUInt32LE(dataOffset + 4);
          dataOffset += 8 + nextChunkSize;
        }
        break;
      }
      offset += 8 + chunkSize;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get audio file duration in seconds
 * Tries WAV parsing first (no external dependencies), falls back to ffprobe
 */
export function getAudioDuration(filePath: string): Promise<number> {
  // First try WAV parsing (no ffprobe needed)
  if (filePath.toLowerCase().endsWith('.wav')) {
    const wavDuration = getWavDuration(filePath);
    if (wavDuration !== null && wavDuration > 0) {
      return Promise.resolve(wavDuration);
    }
  }

  // Fallback to ffprobe
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(metadata.format.duration || 0);
    });
  });
}
