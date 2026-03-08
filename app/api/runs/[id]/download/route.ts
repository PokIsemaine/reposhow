import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getRun, getRunStatus, findRun, getRunDir } from '@/lib/run-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file');

    if (!file) {
      return NextResponse.json(
        { error: 'Missing file parameter' },
        { status: 400 }
      );
    }

    // Find the run (supports both top-level and project runs)
    const found = await findRun(id);
    if (!found) {
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404 }
      );
    }

    const { baseDir } = found;

    const [run, status] = await Promise.all([
      getRun(id, baseDir),
      getRunStatus(id, baseDir),
    ]);

    if (!run || !status) {
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404 }
      );
    }

    const runsDir = getRunDir(id, baseDir);

    // Map file types to actual paths
    let filePath: string | null = null;
    let contentType = 'application/octet-stream';
    let filename = `${id}_${file}`;
    let contentDisposition: 'inline' | 'attachment' = 'attachment';

    switch (file) {
      case 'mp4':
        filePath = path.join(runsDir, 'output.mp4');
        contentType = 'video/mp4';
        filename = 'video.mp4';
        // Use inline for video playback
        contentDisposition = 'inline';
        break;
      case 'srt':
        filePath = path.join(runsDir, 'subtitles.srt');
        contentType = 'text/plain';
        filename = 'subtitles.srt';
        break;
      case 'script':
        filePath = path.join(runsDir, `script_v${run.version}.md`);
        contentType = 'text/markdown';
        filename = 'script.md';
        break;
      case 'storyboard':
        filePath = path.join(runsDir, `storyboard_v${run.version}.json`);
        contentType = 'application/json';
        filename = 'storyboard.json';
        break;
      case 'analysis':
        filePath = path.join(runsDir, `analysis_v${run.version}.json`);
        contentType = 'application/json';
        filename = 'analysis.json';
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid file type' },
          { status: 400 }
        );
    }

    if (!filePath) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    try {
      const fileBuffer = await fs.readFile(filePath);

      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': contentDisposition === 'inline'
            ? 'inline'
            : `attachment; filename="${filename}"`,
        },
      });
    } catch {
      return NextResponse.json(
        { error: 'File not available yet' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Error downloading file:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
