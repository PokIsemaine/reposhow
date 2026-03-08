import { NextResponse } from 'next/server';
import { getVoices, getVoiceLibrary } from '@/lib/elevenlabs';

export async function GET() {
  try {
    // Fetch user's voices
    let userVoices: Array<{ voice_id: string; name: string }> = [];
    try {
      userVoices = await getVoices();
    } catch (err) {
      console.error('Failed to get user voices:', err);
      // Continue with empty array if user voices fail
    }

    // Fetch voice library
    let libraryVoices: Array<{ voice_id: string; name: string }> = [];
    try {
      libraryVoices = await getVoiceLibrary();
    } catch (err) {
      console.error('Failed to get voice library:', err);
      // Continue with empty array if library fails
    }

    // Mark source for each voice
    const voices = [
      ...userVoices.map(v => ({ ...v, source: 'user' as const })),
      ...libraryVoices.map(v => ({ ...v, source: 'library' as const })),
    ];

    return NextResponse.json({ voices });
  } catch (error) {
    console.error('Failed to fetch voices:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch voices' },
      { status: 500 }
    );
  }
}
