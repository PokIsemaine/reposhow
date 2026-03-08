import { NextRequest, NextResponse } from 'next/server';
import { cloneVoice } from '@/lib/elevenlabs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { audioBase64, name } = body;

    if (!audioBase64) {
      return NextResponse.json(
        { error: 'audioBase64 is required' },
        { status: 400 }
      );
    }

    // Create voice clone
    const voiceId = await cloneVoice(audioBase64, name || 'Cloned Voice');

    return NextResponse.json({ voiceId }, { status: 201 });
  } catch (error) {
    console.error('Error cloning voice:', error);

    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
