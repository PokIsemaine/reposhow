import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';

/**
 * Get WAV file duration by parsing the header directly
 * WAV format: RIFF header + fmt chunk + data chunk
 */
function getWavDuration(filePath: string): number | null {
  try {
    // Read larger buffer (8KB) to ensure we can find fmt and data chunks
    // Some WAV files have additional chunks like LIST, INFO, smpl before data
    const bufferSize = 8192;
    const buffer = Buffer.alloc(bufferSize);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, bufferSize, 0);
    fs.closeSync(fd);

    console.log(`[audio-utils] Reading WAV file: ${filePath}, bytes read: ${bytesRead}`);

    if (bytesRead < 44) {
      console.log(`[audio-utils] File too small: ${bytesRead} bytes`);
      return null;
    }

    // Check RIFF header
    const riff = buffer.toString('ascii', 0, 4);
    if (riff !== 'RIFF') {
      console.log(`[audio-utils] Invalid RIFF header: ${riff}`);
      return null;
    }

    // Check WAVE format
    const wave = buffer.toString('ascii', 8, 12);
    if (wave !== 'WAVE') {
      console.log(`[audio-utils] Invalid WAVE format: ${wave}`);
      return null;
    }

    // Find fmt chunk (starts at offset 12)
    // fmt chunk: chunkID (4) + chunkSize (4) + audioFormat (2) + numChannels (2) + sampleRate (4) + byteRate (4) + blockAlign (2) + bitsPerSample (2)
    let offset = 12;
    let foundFmt = false;
    let numChannels = 2;
    let sampleRate = 44100;
    let bitsPerSample = 16;

    // Search for fmt chunk within the buffer
    while (offset < bytesRead - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      console.log(`[audio-utils] Found chunk: '${chunkId}' at offset ${offset}, size: ${chunkSize}`);

      if (chunkId === 'fmt ') {
        numChannels = buffer.readUInt16LE(offset + 10);
        sampleRate = buffer.readUInt32LE(offset + 12);
        bitsPerSample = buffer.readUInt16LE(offset + 22);
        foundFmt = true;
        console.log(`[audio-utils] Found fmt chunk: channels=${numChannels}, sampleRate=${sampleRate}, bitsPerSample=${bitsPerSample}`);
        break;
      }

      // Move to next chunk (chunk size + 8 bytes for ID and size)
      offset += 8 + chunkSize;
    }

    if (!foundFmt) {
      console.log(`[audio-utils] Could not find fmt chunk`);
      return null;
    }

    // Find data chunk after fmt chunk
    const fmtChunkEnd = offset + 8 + 16; // fmt chunk header + 16 bytes of fmt data
    let dataOffset = fmtChunkEnd;

    while (dataOffset < bytesRead - 8) {
      const dataChunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
      const chunkSize = buffer.readUInt32LE(dataOffset + 4);

      if (dataChunkId === 'data') {
        const dataSize = chunkSize;
        // Duration = data size / (sample rate * channels * bytes per sample)
        const bytesPerSample = bitsPerSample / 8;
        const duration = dataSize / (sampleRate * numChannels * bytesPerSample);
        console.log(`[audio-utils] Found data chunk: size=${dataSize}, calculated duration: ${duration}s`);
        return duration;
      }

      console.log(`[audio-utils] Skipping chunk: '${dataChunkId}' at offset ${dataOffset}, size: ${chunkSize}`);
      dataOffset += 8 + chunkSize;
    }

    console.log(`[audio-utils] Could not find data chunk`);
    return null;
  } catch (error) {
    console.log(`[audio-utils] Error parsing WAV: ${error}`);
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
