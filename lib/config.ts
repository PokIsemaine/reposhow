import { z } from 'zod';

// Config schema for validation
const ConfigSchema = z.object({
  // MiniMax API
  MINIMAX_API_KEY: z.string().min(1, 'MINIMAX_API_KEY is required'),
  MINIMAX_BASE_URL: z.string().url().default('https://api.minimax.chat/v1'),

  // banana API (direct)
  BANANA_API_KEY: z.string().min(1, 'BANANA_API_KEY is required'),

  // DMXAPI (optional alternative)
  DMXAPI_API_KEY: z.string().optional(),
  DMXAPI_BASE_URL: z.string().url().default('https://www.dmxapi.cn'),

  // Image generation model (default: nanobana2)
  IMAGE_MODEL: z.enum(['nanobana2', 'gpt-image-1-mini']).default('nanobana2'),

  // ElevenLabs API
  ELEVENLABS_API_KEY: z.string().min(1, 'ELEVENLABS_API_KEY is required'),

  // Optional
  GITHUB_TOKEN: z.string().optional(),

  // Mock data mode for development
  USE_MOCK_DATA: z.boolean().default(false),
});

// Environment variables type
export type Config = z.infer<typeof ConfigSchema>;

// Cached config
let cachedConfig: Config | null = null;

/**
 * Get validated configuration from environment variables
 */
export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = {
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY || '',
    MINIMAX_BASE_URL: process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1',
    BANANA_API_KEY: process.env.BANANA_API_KEY || '',
    DMXAPI_API_KEY: process.env.DMXAPI_API_KEY || undefined,
    DMXAPI_BASE_URL: process.env.DMXAPI_BASE_URL || 'https://www.dmxapi.cn',
    IMAGE_MODEL: (process.env.IMAGE_MODEL as 'nanobana2' | 'gpt-image-1-mini') || 'nanobana2',
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    USE_MOCK_DATA: process.env.USE_MOCK_DATA === 'true',
  };

  const result = ConfigSchema.safeParse(env);

  if (!result.success) {
    const missingKeys = result.error.issues.map(e => e.message).join(', ');
    throw new Error(`Configuration error: ${missingKeys}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

/**
 * Check if all required API keys are configured
 */
export function getMissingKeys(): string[] {
  const required = ['MINIMAX_API_KEY', 'BANANA_API_KEY', 'ELEVENLABS_API_KEY'];
  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  return missing;
}

/**
 * Check if config is ready (all required keys present)
 */
export function isConfigReady(): boolean {
  return getMissingKeys().length === 0;
}

// Default values for the app
export const DEFAULTS = {
  duration: 60, // seconds
  resolution: 'youtube' as const,
  aspectRatio: '16:9' as const,
  voicePreset: '', // Empty - voice must be selected by user
  bgmPreset: 'upbeat',
  bgmVolume: 0.3,
  imagePromptStyle: 'none' as ImagePromptStyle,
  customImagePrompt: '',
};

// Image style presets for prompt engineering
export const IMAGE_STYLE_PRESETS = {
  'none': '',  // No additional prompt, use AI default style
  'flat-illustration': `Generate a flat vector illustration with bold black outlines. Style: editorial infographic, clean 2D vector, no gradients, no shadows, solid color fills. Use modular panel layout with information charts.`,
  'tech-dashboard': `Generate a modern tech dashboard UI. Style: clean interface design, data visualization charts, dark or light mode, sleek professional look. Include code editor panels, terminal windows, metrics displays.`,
  '3d-render': `Generate a professional 3D rendered illustration. Style: isometric view, clean geometric shapes, soft lighting, modern tech aesthetic, high quality render.`,
  'minimal': `Generate a minimalist illustration. Style: clean white background, simple geometric shapes, limited color palette, plenty of negative space, modern and elegant.`,
  'custom': '',  // User provides custom prompt
} as const;

export type ImagePromptStyle = keyof typeof IMAGE_STYLE_PRESETS;

/**
 * Get the style template based on selected style
 */
export function getStyleTemplate(
  style: ImagePromptStyle,
  customPrompt?: string
): string {
  if (style === 'custom') {
    return customPrompt || '';
  }
  return IMAGE_STYLE_PRESETS[style] || '';
}

export const RESOLUTION_MAP = {
  'youtube': { width: 1920, height: 1080, aspectRatio: '16:9' },
  'x': { width: 1280, height: 720, aspectRatio: '16:9' },
  'tiktok': { width: 1080, height: 1920, aspectRatio: '9:16' },
} as const;

export type Resolution = keyof typeof RESOLUTION_MAP;
