import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { findRun } from '@/lib/run-manager';

/**
 * Detect the real Content-Type based on file magic bytes
 * This handles cases where the file extension doesn't match the actual content
 */
function detectContentType(buffer: Buffer, ext: string): string {
  // Need at least a few bytes to detect
  if (buffer.length < 4) {
    return getContentTypeFromExt(ext);
  }

  // Detect MP3 (ID3v2 tag or MP3 sync word)
  // ID3v2 starts with "ID3" (0x49 0x44 0x33)
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return 'audio/mpeg';
  }

  // MP3 sync word: 0xFF followed by 0xE0-0xFF (frame sync)
  if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) {
    return 'audio/mpeg';
  }

  // Detect WAV (RIFF header)
  // RIFF file starts with "RIFF" (0x52 0x49 0x46 0x46)
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    // Check for WAVE format (0x57 0x41 0x56 0x45) at offset 8
    if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
      return 'audio/wav';
    }
  }

  // Detect PNG (PNG signature: 0x89 0x50 0x4E 0x47)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }

  // Detect JPEG (JPEG signature: 0xFF 0xD8 0xFF)
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }

  // Detect GIF (GIF87a: 0x47 0x49 0x46 0x38 0x37 0x61 or GIF89a)
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }

  // Detect WebP (RIFF....WEBP)
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return 'image/webp';
    }
  }

  // Fallback to extension-based detection
  return getContentTypeFromExt(ext);
}

/**
 * Get Content-Type based on file extension (fallback)
 */
function getContentTypeFromExt(ext: string): string {
  const contentTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.srt': 'text/plain',
  };
  return contentTypes[ext] || 'application/octet-stream';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  try {
    const { id, path: pathParts } = await params;

    if (!pathParts || pathParts.length === 0) {
      return NextResponse.json(
        { error: 'Asset path required' },
        { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const assetPath = pathParts.join('/');

    // Debug: Log the asset request
    console.log(`[Assets API] Requesting asset: ${assetPath} for run: ${id}`);

    // Use findRun to get the correct baseDir (supports both runs/ and projects/*/runs/)
    const found = await findRun(id);
    if (!found) {
      console.error(`[Assets API] Run not found: ${id}`);
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }
    const { baseDir } = found;
    const runsDir = path.join(baseDir, id);

    console.log(`[Assets API] Run directory: ${runsDir}`);

    // Helper function to check if path is within runsDir (security check)
    const isPathSafe = (filePath: string): boolean => {
      const resolved = path.resolve(filePath);
      const resolvedRunsDir = path.resolve(runsDir);
      return resolved.startsWith(resolvedRunsDir);
    };

    // Try multiple locations for the asset - check correct directory first based on extension
    const ext = path.extname(assetPath).toLowerCase();
    const isAudio = ['.wav', '.mp3', '.ogg'].includes(ext);

    const searchPaths = isAudio
      ? [
          { path: path.join(runsDir, 'audio', assetPath), location: 'audio' },
          { path: path.join(runsDir, 'assets', assetPath), location: 'assets' },
          { path: path.join(runsDir, assetPath), location: 'root' },
        ]
      : [
          { path: path.join(runsDir, 'assets', assetPath), location: 'assets' },
          { path: path.join(runsDir, 'audio', assetPath), location: 'audio' },
          { path: path.join(runsDir, assetPath), location: 'root' },
        ];

    let fileBuffer: Buffer | null = null;
    let foundLocation: string | null = null;

    for (const search of searchPaths) {
      const filePath = search.path;

      if (!isPathSafe(filePath)) {
        console.warn(`[Assets API] Path security check failed: ${filePath}`);
        continue;
      }

      try {
        const stats = await fs.stat(filePath);
        console.log(`[Assets API] Checking ${search.location}/${assetPath}: exists=${true}, size=${stats.size}`);

        fileBuffer = await fs.readFile(filePath);
        foundLocation = search.location;
        console.log(`[Assets API] Found asset at ${search.location}/${assetPath}, size=${fileBuffer.length}`);
        break;
      } catch (err: any) {
        // File doesn't exist at this location, continue to next
        console.log(`[Assets API] Not found at ${search.location}/${assetPath}: ${err.message}`);
      }
    }

    if (!fileBuffer) {
      // List available files for debugging
      let availableFiles = '';
      try {
        const audioDir = path.join(runsDir, 'audio');
        const files = await fs.readdir(audioDir);
        availableFiles = files.join(', ');
        console.log(`[Assets API] Available files in audio/: ${availableFiles}`);
      } catch {
        availableFiles = '(audio directory not found)';
      }

      return NextResponse.json(
        {
          error: 'Asset not found',
          requested: assetPath,
          runDir: runsDir,
          availableInAudio: availableFiles,
        },
        { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Convert Buffer to Uint8Array for NextResponse
    const uint8Array = new Uint8Array(fileBuffer);

    // Detect content type based on file magic bytes, fallback to extension
    const contentType = detectContentType(fileBuffer, ext);

    console.log(`[Assets API] Serving ${assetPath} as ${contentType}, size=${uint8Array.length} (detected from magic bytes + extension: ${ext})`);

    return new NextResponse(uint8Array, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('[Assets API] Error serving asset:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

// Handle CORS preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
