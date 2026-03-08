import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Run, addLog, updateRunStatus, saveArtifact } from '../run-manager';

const execAsync = promisify(exec);

interface RepoTreeNode {
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

/**
 * Parse GitHub URL to get owner and repo
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Handle various GitHub URL formats
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git

  const httpsMatch = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2].replace(/\.git$/, '') };
  }
  return null;
}

/**
 * Get all files in a directory recursively
 */
async function getRepoTree(dir: string, relativePath: string = ''): Promise<RepoTreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: RepoTreeNode[] = [];

  for (const entry of entries) {
    // Skip common ignored directories
    if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__'].includes(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      nodes.push({ path: relPath, type: 'dir' });
      const subNodes = await getRepoTree(fullPath, relPath);
      nodes.push(...subNodes);
    } else {
      try {
        const stats = await fs.stat(fullPath);
        nodes.push({ path: relPath, type: 'file', size: stats.size });
      } catch {
        nodes.push({ path: relPath, type: 'file' });
      }
    }
  }

  return nodes;
}

/**
 * Read key files for corpus (README, package.json, etc.)
 */
async function getCorpus(dir: string): Promise<Record<string, string>> {
  const corpus: Record<string, string> = {};

  // Key files to read
  const keyFiles = [
    'README.md',
    'README.rst',
    'README.txt',
    'package.json',
    'Cargo.toml',
    'pyproject.toml',
    'requirements.txt',
    'Gemfile',
    'pom.xml',
    'build.gradle',
    'go.mod',
    'main.go',
    'index.js',
    'index.ts',
    'app.py',
    'src/main.rs',
  ];

  // First try to read key files from root
  for (const file of keyFiles) {
    try {
      const filePath = path.join(dir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      // Limit file size to 50KB
      corpus[file] = content.slice(0, 50000);
    } catch {
      // File doesn't exist, skip
    }
  }

  // Also try to read from common subdirectories
  const srcDirs = ['src', 'lib', 'app'];
  for (const srcDir of srcDirs) {
    const srcPath = path.join(dir, srcDir);
    try {
      const entries = await fs.readdir(srcPath, { withFileTypes: true });
      for (const entry of entries.slice(0, 5)) { // Limit to 5 files per dir
        if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts') || entry.name.endsWith('.py') || entry.name.endsWith('.go'))) {
          const filePath = path.join(srcPath, entry.name);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            corpus[`${srcDir}/${entry.name}`] = content.slice(0, 30000);
          } catch {
            // Skip
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return corpus;
}

/**
 * FETCH stage: Clone repository or copy local path
 */
export async function runFetchStage(run: Run): Promise<void> {
  const { config, id: runId, baseDir } = run as Run & { baseDir?: string };

  await addLog(runId, 'INFO', 'FETCH', 'Starting repository fetch...', baseDir);
  await updateRunStatus(runId, { stageProgress: 10 }, baseDir);

  const RUNS_DIR = baseDir || path.join(process.cwd(), 'runs');
  const runsDir = path.join(RUNS_DIR, runId);

  // Use config.localPath if provided (for shared repo in project runs), otherwise use run-specific repo
  const repoDir = config.localPath || path.join(runsDir, 'repo');

  // Create run directory if not exists
  await fs.mkdir(runsDir, { recursive: true });
  await fs.mkdir(repoDir, { recursive: true });

  const repoUrl = config.repoUrl;

  if (!repoUrl) {
    await addLog(runId, 'ERROR', 'FETCH', 'No repository URL provided', baseDir);
    throw new Error('No repository URL provided');
  }

  await addLog(runId, 'INFO', 'FETCH', `Fetching repository: ${repoUrl}`, baseDir);

  // Parse GitHub URL
  const parsed = parseGitHubUrl(repoUrl);

  if (!parsed) {
    await addLog(runId, 'ERROR', 'FETCH', 'Invalid GitHub URL', baseDir);
    throw new Error('Invalid GitHub URL');
  }

  const { owner, repo } = parsed;

  // Check if using shared localPath and repo already exists
  const isSharedRepo = !!config.localPath;
  let repoExists = false;

  if (isSharedRepo) {
    try {
      const entries = await fs.readdir(repoDir);
      repoExists = entries.length > 0;
      if (repoExists) {
        await addLog(runId, 'INFO', 'FETCH', `Using existing shared repository at ${repoDir}`, baseDir);
      }
    } catch {
      // Directory doesn't exist, will clone
    }
  }

  // Try git clone first, fallback to ZIP download
  let cloneSuccess = false;

  if (!repoExists) {

  try {
    // Clone repository using git with Windows-compatible settings
    const gitUrl = `https://github.com/${owner}/${repo}.git`;
    await addLog(runId, 'INFO', 'FETCH', `Cloning ${gitUrl}...`, baseDir);

    // Set git config to handle Windows path issues
    await execAsync(`git config --global core.protectNTFS false && git config --global core.longpaths true`, { timeout: 5000 });

    await execAsync(`git clone --depth 1 --config core.protectNTFS=false --config core.longpaths=true "${gitUrl}" "${repoDir}"`, {
      timeout: 180000,
    });

    await addLog(runId, 'INFO', 'FETCH', 'Repository cloned successfully', baseDir);
    cloneSuccess = true;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await addLog(runId, 'WARN', 'FETCH', `Git clone failed: ${errorMessage}`, baseDir);
    await addLog(runId, 'INFO', 'FETCH', 'Trying ZIP download fallback...', baseDir);

    // Try different branch names (main, master)
    const branchNames = ['main', 'master', 'develop'];
    let zipSuccess = false;

    for (const branch of branchNames) {
      try {
        const zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
        const zipPath = path.join(runsDir, 'repo.zip');

        await new Promise<void>((resolve, reject) => {
          const file = fsSync.createWriteStream(zipPath);
          const http = require('https');
          http.get(zipUrl, (response: any) => {
            if (response.statusCode === 404) {
              file.close();
              fsSync.unlinkSync(zipPath);
              reject(new Error('Branch not found'));
              return;
            }
            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          }).on('error', reject);
        });

        // Extract ZIP using PowerShell
        await execAsync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${repoDir}' -Force"`, {
          timeout: 120000,
        });

        // Move contents up one level (ZIP extracts to repo-{branch}/)
        const extractedDir = path.join(repoDir, `${repo}-${branch}`);
        const extractedExists = await fs.access(extractedDir).then(() => true).catch(() => false);

        if (extractedExists) {
          const files = await fs.readdir(extractedDir);
          for (const file of files) {
            await fs.rename(path.join(extractedDir, file), path.join(repoDir, file));
          }
          await fs.rmdir(extractedDir);
        }
        await fs.unlink(zipPath);

        await addLog(runId, 'INFO', `FETCH`, `Repository downloaded (${branch} branch)`, baseDir);
        zipSuccess = true;
        break;

      } catch (zipError) {
        await addLog(runId, 'WARN', 'FETCH', `ZIP download failed for ${branch}: ${zipError}`, baseDir);
        continue;
      }
    }

    if (!zipSuccess) {
      throw new Error('Both git clone and ZIP download failed');
    }
  }
  } // End if (!repoExists)

  await updateRunStatus(runId, { stageProgress: 40 }, baseDir);

  // Generate repoTree.json
  await addLog(runId, 'INFO', 'FETCH', 'Generating file tree...', baseDir);
  const tree = await getRepoTree(repoDir);
  const fileCount = tree.filter(n => n.type === 'file').length;

  await saveArtifact(runId, 'repoTree.json', JSON.stringify({
    tree,
    fileCount,
    repo: repo,
    owner: owner,
  }, null, 2), baseDir);

  await addLog(runId, 'INFO', 'FETCH', `Found ${fileCount} files`, baseDir);

  await updateRunStatus(runId, { stageProgress: 70 }, baseDir);

  // Generate corpus.json
  await addLog(runId, 'INFO', 'FETCH', 'Reading key files...', baseDir);
  const corpus = await getCorpus(repoDir);

  await saveArtifact(runId, 'corpus.json', JSON.stringify(corpus, null, 2), baseDir);

  await addLog(runId, 'INFO', 'FETCH', `Loaded ${Object.keys(corpus).length} key files`, baseDir);

  await updateRunStatus(runId, { stageProgress: 100 }, baseDir);

  await addLog(runId, 'INFO', 'FETCH', 'Repository fetched successfully', baseDir);
}
