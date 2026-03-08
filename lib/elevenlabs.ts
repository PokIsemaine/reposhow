import { getConfig } from './config';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { Readable } from 'stream';
import fs from 'fs/promises';
import path from 'path';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds timeout for API calls

/**
 * Fetch with timeout to prevent hanging on slow connections
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  const { timeout: _timeout, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms: ${url}`);
    }
    throw error;
  }
}

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Create a voice clone from audio sample
 * @param audioBase64 - Base64 encoded audio data (without data URL prefix)
 * @param name - Optional name for the voice
 * @returns Voice ID of the created clone
 */
export async function cloneVoice(audioBase64: string, name?: string): Promise<string> {
  const config = getConfig();

  // Mock mode: return mock voice ID
  if (config.USE_MOCK_DATA) {
    return 'mock_voice_id';
  }

  // Convert base64 to Buffer
  const audioBuffer = Buffer.from(audioBase64, 'base64');

  // Create FormData
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: 'audio/webm' });
  formData.append('files', blob, 'voice_sample.webm');
  if (name) {
    formData.append('name', name);
  }

  const response = await fetchWithTimeout(`${ELEVENLABS_BASE_URL}/voices/add`, {
    method: 'POST',
    headers: {
      'xi-api-key': config.ELEVENLABS_API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Voice cloning failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.voice_id;
}

/**
 * Generate text-to-speech audio
 * @param text - Text to convert to speech
 * @param voiceId - Voice ID to use (preset or cloned)
 * @param modelId - Model ID (default: eleven_multilingual_v2)
 * @returns Audio buffer
 */
export async function generateTTS(
  text: string,
  voiceId: string,
  modelId: string = 'eleven_multilingual_v2'
): Promise<Buffer> {
  const config = getConfig();

  // Mock mode: return mock voice audio
  if (config.USE_MOCK_DATA) {
    const mockPath = path.join(process.cwd(), 'mocks', 'audio', 'voice.wav');
    return fs.readFile(mockPath);
  }

  const response = await fetchWithTimeout(`${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': config.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TTS generation failed: ${response.status} - ${errorText}`);
  }

  // Return the audio as a buffer
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get available voices from user's account
 */
export async function getVoices(): Promise<Array<{ voice_id: string; name: string }>> {
  const config = getConfig();

  // Mock mode: return mock voices
  if (config.USE_MOCK_DATA) {
    return [
      { voice_id: 'mock_voice_1', name: 'Mock Voice 1' },
      { voice_id: 'mock_voice_2', name: 'Mock Voice 2' },
    ];
  }

  const response = await fetchWithTimeout(`${ELEVENLABS_BASE_URL}/voices`, {
    method: 'GET',
    headers: {
      'xi-api-key': config.ELEVENLABS_API_KEY,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get voices: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.voices.map((v: { voice_id: string; name: string }) => ({
    voice_id: v.voice_id,
    name: v.name,
  }));
}

/**
 * Get public/voice library voices from ElevenLabs
 *
 * Note: ElevenLabs 公开语音库 API 需要特殊订阅或已变更，不再可用
 * 返回空数组，用户只能使用自己账户中的语音（通过 getVoices() 获取）
 */
export async function getVoiceLibrary(): Promise<Array<{ voice_id: string; name: string }>> {
  // ElevenLabs 公开语音库 API 需要特殊订阅或已变更
  // 返回空数组，用户只能使用自己账户中的语音
  return [];
}

/**
 * Delete a cloned voice
 * @param voiceId - Voice ID to delete
 */
export async function deleteVoice(voiceId: string): Promise<void> {
  const config = getConfig();

  // Mock mode: do nothing
  if (config.USE_MOCK_DATA) {
    return;
  }

  const response = await fetchWithTimeout(`${ELEVENLABS_BASE_URL}/voices/${voiceId}`, {
    method: 'DELETE',
    headers: {
      'xi-api-key': config.ELEVENLABS_API_KEY,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to delete voice: ${response.status} - ${errorText}`);
  }
}

/**
 * Get background music library from ElevenLabs
 * @returns Array of available background music tracks
 *
 * Note: ElevenLabs does not have a preset music library API endpoint.
 * This function returns preset music templates that are used with generateBGM()
 * to dynamically generate background music based on the prompt.
 */
export async function getMusicLibrary(): Promise<Array<{
  music_id: string;
  title: string;
  author: string;
  duration_seconds: number;
  url?: string;
  prompt?: string;
}>> {
  // ElevenLabs has no preset music library API - return preset templates
  // These templates are used with generateBGM() to dynamically generate music
  return [
    {
      music_id: 'upbeat_corporate',
      title: 'Upbeat Corporate',
      author: 'RepoShow',
      duration_seconds: 120,
      prompt: 'Upbeat corporate background music, positive, energetic, professional'
    },
    {
      music_id: 'ambient_chill',
      title: 'Ambient Chill',
      author: 'RepoShow',
      duration_seconds: 180,
      prompt: 'Ambient chill background music, relaxed, atmospheric, calm'
    },
    {
      music_id: 'tech_innovation',
      title: 'Tech Innovation',
      author: 'RepoShow',
      duration_seconds: 90,
      prompt: 'Tech innovation music, futuristic, electronic, modern'
    },
    {
      music_id: 'cinematic_epic',
      title: 'Cinematic Epic',
      author: 'RepoShow',
      duration_seconds: 240,
      prompt: 'Cinematic epic music, orchestral, dramatic, powerful'
    },
    {
      music_id: 'soft_piano',
      title: 'Soft Piano',
      author: 'RepoShow',
      duration_seconds: 150,
      prompt: 'Soft piano background music, gentle, melodic, peaceful'
    },
    {
      music_id: 'electronic_beat',
      title: 'Electronic Beat',
      author: 'RepoShow',
      duration_seconds: 100,
      prompt: 'Electronic beat music, rhythmic, modern, energetic'
    },
  ];
}

/**
 * Generate background music from a prompt using ElevenLabs
 * @param prompt - Description of the music to generate
 * @param durationSeconds - Duration in seconds
 * @returns Audio buffer
 *
 * Uses ElevenLabs SDK: https://elevenlabs.io/docs/api-reference/music/compose
 */
export async function generateBGM(
  prompt: string,
  durationSeconds: number = 60
): Promise<Buffer> {
  const config = getConfig();

  // Mock mode: return mock BGM
  if (config.USE_MOCK_DATA) {
    const mockPath = path.join(process.cwd(), 'mocks', 'audio', 'bgm.wav');
    return fs.readFile(mockPath);
  }

  // Use ElevenLabs SDK for music generation
  const elevenlabs = new ElevenLabsClient({
    apiKey: config.ELEVENLABS_API_KEY,
  });

  const musicLengthMs = durationSeconds * 1000;
  const BGM_TIMEOUT_MS = 120000; // 2 minutes timeout for BGM generation

  try {
    // Generate music using the SDK with timeout
    const audioStream = await withTimeout(
      elevenlabs.music.compose({
        prompt,
        musicLengthMs,
      }),
      BGM_TIMEOUT_MS,
      'ElevenLabs music compose'
    );

    // Convert ReadableStream to buffer
    const chunks: Uint8Array[] = [];
    const reader = audioStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Calculate total length and create buffer
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const resultBuffer = Buffer.alloc(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      resultBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    return resultBuffer;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`BGM generation failed: ${errorMessage}`);
  }
}
