// Simple script to generate mock data files
const fs = require('fs');
const path = require('path');

const mocksDir = path.join(__dirname, '..', 'mocks');

// Create a simple 1x1 PNG (minimal valid PNG)
function createSimplePNG() {
  // This is a minimal valid PNG (1x1 pixel, gray)
  // PNG signature + IHDR + IDAT + IEND
  const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk (13 bytes of data)
  const ihdrData = Buffer.from([
    0x00, 0x00, 0x00, 0x10, // width: 16
    0x00, 0x00, 0x00, 0x10, // height: 16
    0x08, // bit depth: 8
    0x02, // color type: RGB
    0x00, // compression: deflate
    0x00, // filter: standard
    0x00  // interlace: none
  ]);
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR');
  const ihdrCrc = crc32(Buffer.concat([ihdrType, ihdrData]));
  const ihdrCrcBuf = Buffer.alloc(4);
  ihdrCrcBuf.writeUInt32BE(ihdrCrc, 0);

  // Create a simple 16x16 RGB image (768 bytes)
  const imageData = [];
  for (let y = 0; y < 16; y++) {
    imageData.push(0); // filter byte
    for (let x = 0; x < 16; x++) {
      // Create a gradient effect based on scene number
      imageData.push((x * 16) % 256); // R
      imageData.push((y * 16) % 256); // G
      imageData.push(128); // B
    }
  }

  // Compress with zlib (use simple deflate)
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(Buffer.from(imageData));

  const idatLength = Buffer.alloc(4);
  idatLength.writeUInt32BE(compressed.length, 0);
  const idatType = Buffer.from('IDAT');
  const idatCrc = crc32(Buffer.concat([idatType, compressed]));
  const idatCrcBuf = Buffer.alloc(4);
  idatCrcBuf.writeUInt32BE(idatCrc, 0);

  // IEND chunk
  const iendLength = Buffer.alloc(4);
  iendLength.writeUInt32BE(0, 0);
  const iendType = Buffer.from('IEND');
  const iendCrc = crc32(iendType);
  const iendCrcBuf = Buffer.alloc(4);
  iendCrcBuf.writeUInt32BE(iendCrc, 0);

  return Buffer.concat([
    pngSignature,
    ihdrLength, ihdrType, ihdrData, ihdrCrcBuf,
    idatLength, idatType, compressed, idatCrcBuf,
    iendLength, iendType, iendCrcBuf
  ]);
}

// Simple CRC32 implementation
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = makeCrcTable();
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xEDB88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }
  return table;
}

// Create a simple WAV file
function createSimpleWAV(durationSeconds = 1, sampleRate = 44100) {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = numSamples * numChannels * bitsPerSample / 8;

  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk size
  buffer.writeUInt16LE(1, 20); // audio format (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate a simple sine wave tone
  const frequency = 440; // A4 note
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.3;
    const intSample = Math.floor(sample * 32767);
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

// Generate scene images
console.log('Creating mock images...');
const png = createSimplePNG();
for (let i = 1; i <= 5; i++) {
  const filename = `scene_${String(i).padStart(3, '0')}.png`;
  fs.writeFileSync(path.join(mocksDir, 'images', filename), png);
  console.log(`Created ${filename}`);
}

// Generate audio files
console.log('Creating mock audio files...');
const voiceWav = createSimpleWAV(2); // 2 seconds
fs.writeFileSync(path.join(mocksDir, 'audio', 'voice.wav'), voiceWav);
console.log('Created voice.wav');

const bgmWav = createSimpleWAV(5); // 5 seconds
fs.writeFileSync(path.join(mocksDir, 'audio', 'bgm.wav'), bgmWav);
console.log('Created bgm.wav');

const mixedWav = createSimpleWAV(5); // 5 seconds (same as BGM)
fs.writeFileSync(path.join(mocksDir, 'audio', 'mixed.wav'), mixedWav);
console.log('Created mixed.wav');

// Create storyboard.json
console.log('Creating storyboard.json...');
const storyboard = {
  scenes: [
    {
      id: 'scene-001',
      sceneNumber: 1,
      durationSec: 5,
      narrationText: 'Welcome to this amazing project.',
      visualPrompt: 'A beautiful code editor showing a modern software project with syntax highlighting and a clean UI design.',
      transition: 'fade'
    },
    {
      id: 'scene-002',
      sceneNumber: 2,
      durationSec: 5,
      narrationText: 'This project features cutting-edge technology.',
      visualPrompt: 'Technical diagram showing architecture with connected nodes and arrows, modern tech stack icons.',
      transition: 'slide'
    },
    {
      id: 'scene-003',
      sceneNumber: 3,
      durationSec: 5,
      narrationText: 'Easy to use and highly customizable.',
      visualPrompt: 'Hands typing on keyboard with code on screen, developer workflow illustration.',
      transition: 'fade'
    },
    {
      id: 'scene-004',
      sceneNumber: 4,
      durationSec: 5,
      narrationText: 'Join thousands of developers using this project.',
      visualPrompt: 'Open source community illustration with GitHub contributors, collaboration icons.',
      transition: 'wipe'
    },
    {
      id: 'scene-005',
      sceneNumber: 5,
      durationSec: 5,
      narrationText: 'Thanks for watching. Star the repo to support us!',
      visualPrompt: 'Celebration with stars and fireworks, gratitude message displayed.',
      transition: 'fade'
    }
  ],
  totalDurationSec: 25
};

fs.writeFileSync(
  path.join(mocksDir, 'storyboard.json'),
  JSON.stringify(storyboard, null, 2)
);
console.log('Created storyboard.json');

// Create script.md
console.log('Creating script.md...');
const script = `# RepoShow Video Script

Welcome to this amazing project. This repository contains cutting-edge technology built with modern best practices.

This project features cutting-edge technology. The architecture is designed for scalability and maintainability.

Easy to use and highly customizable. With extensive documentation and examples, you can get started in minutes.

Join thousands of developers using this project. Check the README for installation instructions and contribute to the community.

Thanks for watching. Star the repo to support us!
`;

fs.writeFileSync(path.join(mocksDir, 'script.md'), script);
console.log('Created script.md');

console.log('\nMock data generation complete!');
