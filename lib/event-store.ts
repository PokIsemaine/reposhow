import { promises as fs } from 'fs';
import path from 'path';
import { getRunDir, getRunFilePath, getRunBaseDir } from './run-manager';

// Event types
export type EventType = 'progress' | 'thinking' | 'stage' | 'complete' | 'error';

// Event structure
export interface RunEvent {
  id: number;           // Auto-incrementing event ID
  type: EventType;
  timestamp: number;
  data: any;
}

// Append-only event file path
function getEventsFilePath(runId: string, baseDir?: string): string {
  return getRunFilePath(runId, 'events.jsonl', baseDir);
}

/**
 * Ensure events file exists
 */
async function ensureEventsFile(runId: string, baseDir?: string): Promise<void> {
  const eventsPath = getEventsFilePath(runId, baseDir);
  try {
    await fs.access(eventsPath);
  } catch {
    // File doesn't exist, create empty file
    await fs.writeFile(eventsPath, '');
  }
}

/**
 * Append an event to the event store
 * @returns The complete event with assigned ID
 */
export async function appendEvent(
  runId: string,
  event: Omit<RunEvent, 'id'>,
  baseDir?: string
): Promise<RunEvent> {
  const eventsPath = getEventsFilePath(runId, baseDir);
  await ensureEventsFile(runId, baseDir);

  // Get the next event ID by reading existing events
  const latestId = await getLatestEventId(runId, baseDir);
  const newId = latestId + 1;

  // Create complete event
  const fullEvent: RunEvent = {
    id: newId,
    ...event,
  };

  // Append to file (JSONL format)
  await fs.appendFile(eventsPath, JSON.stringify(fullEvent) + '\n');

  return fullEvent;
}

/**
 * Get events from the event store
 * @param afterId - Optional: only return events with ID > afterId
 */
export async function getEvents(
  runId: string,
  afterId?: number,
  baseDir?: string
): Promise<RunEvent[]> {
  const eventsPath = getEventsFilePath(runId, baseDir);

  try {
    const content = await fs.readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const events: RunEvent[] = [];
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as RunEvent;
        // Filter by afterId if specified
        if (afterId !== undefined && event.id <= afterId) {
          continue;
        }
        events.push(event);
      } catch {
        // Skip malformed lines
      }
    }

    return events;
  } catch {
    // File doesn't exist yet
    return [];
  }
}

/**
 * Get the latest event ID
 * @returns 0 if no events exist
 */
export async function getLatestEventId(
  runId: string,
  baseDir?: string
): Promise<number> {
  const eventsPath = getEventsFilePath(runId, baseDir);

  try {
    const content = await fs.readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    if (lines.length === 0) {
      return 0;
    }

    // Parse last line to get the latest ID
    const lastLine = lines[lines.length - 1];
    try {
      const lastEvent = JSON.parse(lastLine) as RunEvent;
      return lastEvent.id || 0;
    } catch {
      return 0;
    }
  } catch {
    // File doesn't exist yet
    return 0;
  }
}

/**
 * Get all events as a readable stream for SSE
 * This reads new events as they're appended
 */
export async function* eventStream(
  runId: string,
  afterId: number,
  baseDir?: string,
  pollInterval = 1000
): AsyncGenerator<RunEvent> {
  let currentId = afterId;

  while (true) {
    const events = await getEvents(runId, currentId, baseDir);

    for (const event of events) {
      currentId = event.id;
      yield event;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}
