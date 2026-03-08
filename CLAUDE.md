# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RepoShow is a web application that generates professional promotional videos from GitHub repositories. Users paste a repo URL, and the system automatically creates an MP4 video with code analysis, narration (TTS), background music, and Remotion-rendered visuals.

## Tech Stack

- **Frontend**: Next.js App Router with Neo-Brutalism UI design
- **Backend**: Next.js API routes + local job runner
- **AI**: MiniMax M2.5 (analysis, script, storyboard generation)
- **Image Generation**: banana (Nano Banana) API
- **Audio**: ElevenLabs API (TTS with voice clone support, BGM)
- **Video Rendering**: Remotion (local, with Lambda support planned)

## Architecture

### Pipeline Stages

The generation pipeline consists of 6 stages: `FETCH → ANALYZE → SCRIPT → STORYBOARD → ASSETS → RENDER`

### Run Data Structure

All data stored in `runs/{runId}/`:
- `run.json` - config, version, created timestamp
- `status.json` - stage status, progress, errors, artifact paths
- `repo/` - repository snapshot
- `analysis_v{N}.json` - code analysis output
- `script_v{N}.md` - narration script
- `storyboard_v{N}.json` - scene breakdown
- `assets/scene_XXX.png` - generated images
- `audio/voice.wav`, `audio/bgm.wav` - audio tracks
- `output.mp4` - final video
- `subtitles.srt` - subtitles
- `feedback.jsonl` - user feedback log

### Pages

- `/` - Landing page (paste GitHub repo URL)
- `/create` - Configure and create generation task
- `/run/:id` - Real-time progress with logs
- `/result/:id` - Video playback, download, feedback

### Key Configuration

- `.env` - API keys (MiniMax, ElevenLabs, banana)
- `.env.example` - template with required keys

## Commands

Commands to be defined after initial project setup:
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run lint` - Run linter

## Key Conventions

1. **Neo-Brutalism UI** - Only for Web UI (Landing/Create/Progress/Result pages)
2. **Professional Video Template** - Video itself uses clean, professional style (not Neo-Brutalism)
3. **Resumable Pipeline** - Each stage writes status.json; retry skips completed stages
4. **Versioned Artifacts** - analysis/script/storyboard use vN versioning for feedback loop
5. **Evidence-Based Analysis** - Each feature in analysis must reference source evidence

## Development Phases

1. **M1**: End-to-end pipeline (Landing → Result with default settings)
2. **M2**: Voice clone feature
3. **M3**: Feedback re-analysis loop
4. **M4**: Remotion Lambda support
