import { getConfig } from './config';

export interface ImageGenerationOptions {
  prompt: string;
  aspectRatio?: string; // e.g., "16:9", "9:16", "1:1"
  imageSize?: string; // e.g., "1024x768", "768x1024"
  sceneNumber?: number; // Used for mock data mode
}

export interface ImageGenerationResult {
  success: boolean;
  imageBase64?: string;
  imageUrl?: string;
  error?: string;
}

/**
 * DMXAPI model mapping
 */
const MODEL_MAPPING: Record<string, string> = {
  'nanobana2': 'gemini-3.1-flash-image-preview',
  'gpt-image-1-mini': 'gpt-image-1-mini',
};

/**
 * Generate image using DMXAPI or direct banana API
 */
export async function generateImage(
  options: ImageGenerationOptions
): Promise<ImageGenerationResult> {
  const config = getConfig();

  // Mock mode: return mock image path
  if (config.USE_MOCK_DATA) {
    // Generate a consistent scene number from the prompt hash or use default
    const sceneNum = options.sceneNumber || 1;
    return {
      success: true,
      imageUrl: `/mocks/images/scene_${String(sceneNum).padStart(3, '0')}.png`,
    };
  }

  // Check if DMXAPI is configured
  const useDMXAPI = !!config.DMXAPI_API_KEY;

  if (useDMXAPI) {
    return generateWithDMXAPI(options);
  } else {
    return generateWithBanana(options);
  }
}

/**
 * Generate image using DMXAPI with fallback and retry
 */
async function generateWithDMXAPI(
  options: ImageGenerationOptions
): Promise<ImageGenerationResult> {
  const config = getConfig();
  const { prompt, aspectRatio = '16:9', imageSize } = options;

  // Retry configuration
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;

  // Determine size based on aspect ratio or explicit size
  let size = imageSize;
  if (!size) {
    switch (aspectRatio) {
      case '16:9':
        size = '1536x1024';
        break;
      case '9:16':
        size = '1024x1536';
        break;
      case '1:1':
        size = '1024x1024';
        break;
      default:
        size = '1536x1024';
    }
  }

  // Try primary model first, then fallback to gpt-image-1-mini
  const modelsToTry = [config.IMAGE_MODEL, 'gpt-image-1-mini'];

  for (const model of modelsToTry) {
    const modelId = MODEL_MAPPING[model] || model;
    const isGptImage = modelId === 'gpt-image-1-mini';

    // Build request body based on model type
    const requestBody: Record<string, unknown> = {
      model: modelId,
      prompt: prompt,
    };

    // gpt-image-1-mini uses different parameter names
    if (isGptImage) {
      requestBody.n = 1;
      requestBody.size = size;
    } else {
      requestBody.image_size = size;
      requestBody.aspect_ratio = aspectRatio;
      requestBody.number_of_images = 1;
    }

    console.log(`[DMXAPI] Trying model: ${modelId}`);

    // Retry loop for 502 errors
    let lastError: string = '';
    for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
      try {
        const response = await fetch(`${config.DMXAPI_BASE_URL}/v1/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.DMXAPI_API_KEY}`,
            // Only add goog-api-key for Google models
            ...(!isGptImage && { 'x-goog-api-key': config.DMXAPI_API_KEY! }),
          },
          body: JSON.stringify(requestBody),
        });

        // Handle 502 with retry
        if (response.status === 502) {
          if (retryCount < MAX_RETRIES) {
            console.log(`[DMXAPI] Received 502 error, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            continue;
          } else {
            lastError = '502 Bad Gateway after all retries';
            break;
          }
        }

        if (!response.ok) {
          const errorText = await response.text();
          // If 503 and we have more models to try, continue to next model
          if (response.status === 503 && modelsToTry.indexOf(model) < modelsToTry.length - 1) {
            console.log(`[DMXAPI] Model ${modelId} unavailable, trying fallback...`);
            continue;
          }
          return {
            success: false,
            error: `DMXAPI error (${response.status}): ${errorText}`,
          };
        }

      const data = await response.json();

      // Debug: log the actual response
      console.log('[DMXAPI] Response:', JSON.stringify(data, null, 2));

    // Try various common response formats
    let imageUrl: string | undefined;
    let imageBase64: string | undefined;

    // Format 1: data[0].b64_json (DMXAPI format)
    if (data.data && data.data[0]?.b64_json) {
      imageBase64 = data.data[0].b64_json;
    }
    // Format 2: data[0].image_url
    else if (data.data && data.data[0]?.image_url) {
      imageUrl = data.data[0].image_url;
    }
    // Format 3: data[0].base64
    else if (data.data && data.data[0]?.base64) {
      imageBase64 = data.data[0].base64;
    }
    // Format 4: data[0].url
    else if (data.data && data.data[0]?.url) {
      imageUrl = data.data[0].url;
    }
    // Format 5: data.images[0].url
    else if (data.data?.images?.[0]?.url) {
      imageUrl = data.data.images[0].url;
    }
    // Format 6: data.images[0].base64
    else if (data.data?.images?.[0]?.base64) {
      imageBase64 = data.data.images[0].base64;
    }
    // Format 7: data[0].output_url
    else if (data.data && data.data[0]?.output_url) {
      imageUrl = data.data[0].output_url;
    }
    // Format 8: data.output?.[0]
    else if (data.output?.[0]) {
      imageUrl = data.output[0];
    }
    // Format 9: data.result?.[0]?.url
    else if (data.result?.[0]?.url) {
      imageUrl = data.result[0].url;
    }

    // If we have a URL, fetch and convert to base64
    if (imageUrl) {
      console.log('[DMXAPI] Fetching image from URL:', imageUrl);
      const imageResponse = await fetch(imageUrl);
      const imageBuffer = await imageResponse.arrayBuffer();
      imageBase64 = Buffer.from(imageBuffer).toString('base64');

      return {
        success: true,
        imageBase64,
        imageUrl,
      };
    }

    // If we already have base64
    if (imageBase64) {
      return {
        success: true,
        imageBase64,
      };
    }

    // Log the full response for debugging
    console.error('[DMXAPI] Unrecognized response format. Full response:', JSON.stringify(data, null, 2));

    return {
      success: false,
      error: `Unexpected DMXAPI response format: ${JSON.stringify(data).substring(0, 500)}`,
    };
      } catch (error) {
        // If this was a 502 retry failure, don't fall through to model fallback
        if (lastError && lastError.includes('502')) {
          if (modelsToTry.indexOf(model) < modelsToTry.length - 1) {
            console.log(`[DMXAPI] Model ${modelId} failed with 502, trying fallback...`);
            continue;
          }
          return {
            success: false,
            error: `DMXAPI error: ${lastError}`,
          };
        }
        // If error and we have more models to try, continue to next model
        if (modelsToTry.indexOf(model) < modelsToTry.length - 1) {
          console.log(`[DMXAPI] Model ${modelId} failed with error, trying fallback...`);
          continue;
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  }

  // All models failed
  return {
    success: false,
    error: 'All image generation models failed',
  };
}

/**
 * Generate image using direct banana API
 */
async function generateWithBanana(
  options: ImageGenerationOptions
): Promise<ImageGenerationResult> {
  const config = getConfig();
  const { prompt, aspectRatio = '16:9', imageSize } = options;

  // Determine size
  let size = imageSize;
  if (!size) {
    switch (aspectRatio) {
      case '16:9':
        size = '1536x1024';
        break;
      case '9:16':
        size = '1024x1536';
        break;
      case '1:1':
        size = '1024x1024';
        break;
      default:
        size = '1536x1024';
    }
  }

  try {
    const response = await fetch('https://api.banana.dev/v4/image/generation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.BANANA_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'nanobana2',
        prompt: prompt,
        image_size: size,
        aspect_ratio: aspectRatio,
        num_images: 1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Banana API error (${response.status}): ${errorText}`,
      };
    }

    const data = await response.json();

    // Parse banana API response
    if (data.generations && data.generations[0]) {
      const generation = data.generations[0];
      if (generation.base64) {
        return {
          success: true,
          imageBase64: generation.base64,
        };
      } else if (generation.url) {
        // Fetch image from URL and convert to base64
        const imageResponse = await fetch(generation.url);
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBase64 = Buffer.from(imageBuffer).toString('base64');

        return {
          success: true,
          imageBase64,
          imageUrl: generation.url,
        };
      }
    }

    return {
      success: false,
      error: 'Unexpected banana API response format',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get available image models
 */
export function getAvailableModels(): Array<{ id: string; name: string }> {
  return [
    { id: 'nanobana2', name: 'Nano Banana 2' },
  ];
}
