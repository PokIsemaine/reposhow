import { NextRequest, NextResponse } from 'next/server';
import { getMusicLibrary } from '@/lib/elevenlabs';

export async function GET(request: NextRequest) {
  try {
    const music = await getMusicLibrary();
    return NextResponse.json({ music });
  } catch (error) {
    console.error('Error fetching music library:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch music library' },
      { status: 500 }
    );
  }
}
