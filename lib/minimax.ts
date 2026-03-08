import { getConfig } from './config';

/**
 * MiniMax API Client
 * Handles all interactions with MiniMax M2.5 for analysis, script, and storyboard generation
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const DEFAULT_MODEL = 'MiniMax-M2.5';

/**
 * Call MiniMax Chat Completion API
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: Partial<ChatCompletionOptions> = {}
): Promise<ChatCompletionResponse> {
  const config = getConfig();

  const requestBody = {
    model: options.model || DEFAULT_MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 8192,
    stream: false,
  };

  console.log('[MiniMax] Request:', JSON.stringify(requestBody, null, 2));

  const response = await fetch(`${config.MINIMAX_BASE_URL}/text/chatcompletion_v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.MINIMAX_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  console.log('[MiniMax] Response status:', response.status);
  console.log('[MiniMax] Response body:', responseText);

  if (!response.ok) {
    throw new Error(`MiniMax API error: ${response.status} - ${responseText}`);
  }

  try {
    const json = JSON.parse(responseText);
    return json;
  } catch (e) {
    throw new Error(`Failed to parse MiniMax response: ${responseText}`);
  }
}

/**
 * Call MiniMax API and extract JSON response
 */
export async function chatCompletionJSON<T>(
  messages: ChatMessage[],
  options: Partial<ChatCompletionOptions> = {}
): Promise<T> {
  const response = await chatCompletion(messages, options);

  if (!response.choices || response.choices.length === 0) {
    console.error('[MiniMax] Empty choices:', response);
    throw new Error(`MiniMax response has no choices: ${JSON.stringify(response)}`);
  }

  const content = response.choices[0]?.message?.content;

  if (!content) {
    console.error('[MiniMax] No message content:', response.choices[0]);
    throw new Error(`MiniMax response has no message content: ${JSON.stringify(response.choices[0])}`);
  }

  // Try to parse JSON from the response
  // Sometimes the model wraps JSON in markdown code blocks
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  }
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    console.error('Failed to parse JSON:', jsonStr);
    throw new Error(`Failed to parse JSON response: ${e}`);
  }
}

export interface StreamChunk {
  id: string;
  choices: {
    index: number;
    delta: {
      content: string;
    };
    finish_reason: string | null;
  }[];
}

/**
 * Stream completion from MiniMax API
 * Yields content chunks as they arrive
 */
export async function* streamCompletion(
  messages: ChatMessage[],
  options: Partial<ChatCompletionOptions> = {}
): AsyncGenerator<string> {
  const config = getConfig();

  const requestBody = {
    model: options.model || DEFAULT_MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 8192,
    stream: true,
  };

  console.log('[MiniMax] Streaming request:', JSON.stringify({
    ...requestBody,
    messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 100) + '...' }))
  }));

  const response = await fetch(`${config.MINIMAX_BASE_URL}/text/chatcompletion_v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.MINIMAX_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`MiniMax streaming API error: ${response.status} - ${responseText}`);
  }

  if (!response.body) {
    throw new Error('MiniMax streaming response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Split by newlines and process each line
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) {
          continue;
        }

        const dataStr = trimmed.slice(6).trim();

        // Skip heartbeat/ping lines
        if (dataStr === '[DONE]' || !dataStr) {
          continue;
        }

        try {
          const chunk: StreamChunk = JSON.parse(dataStr);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch (e) {
          // Skip malformed JSON
          console.log('[MiniMax] Skipping malformed chunk:', dataStr.slice(0, 100));
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Generate music using MiniMax Music-2.5+ API
 * @param prompt Music description (1-2000 chars)
 * @param durationSeconds Target duration in seconds
 * @param model Model to use (default: music-2.5+)
 * @returns Audio buffer
 */
export async function generateMusic(
  prompt: string,
  durationSeconds: number = 60,
  model: string = 'music-2.5+'
): Promise<Buffer> {
  const config = getConfig();

  // MiniMax Music API uses a different base URL
  const musicApiUrl = 'https://api.minimaxi.com/v1/music_generation';

  console.log(`[MiniMax Music] Generating music: "${prompt.substring(0, 100)}..." (${durationSeconds}s)`);

  const response = await fetch(musicApiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.MINIMAX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      is_instrumental: true,  // Generate pure instrumental music
      output_format: 'hex',
      audio_setting: {
        sample_rate: 44100,
        bitrate: 128000,
        format: 'wav'
      }
    }),
  });

  const responseText = await response.text();
  console.log('[MiniMax Music] Response status:', response.status);

  if (!response.ok) {
    throw new Error(`MiniMax Music API error: ${response.status} - ${responseText}`);
  }

  try {
    const data = JSON.parse(responseText);
    console.log('[MiniMax Music] Response:', JSON.stringify(data).substring(0, 200));

    if (data.base_resp?.status_code !== 0) {
      throw new Error(data.base_resp?.status_msg || 'Music generation failed');
    }

    // Convert hex to Buffer
    const audioHex = data.data.audio;
    const audioBuffer = Buffer.from(audioHex, 'hex');

    console.log(`[MiniMax Music] Generated ${audioBuffer.length} bytes of audio`);
    return audioBuffer;
  } catch (e) {
    if (e instanceof Error && e.message.includes('API error')) {
      throw e;
    }
    throw new Error(`Failed to parse MiniMax Music response: ${responseText}`);
  }
}
