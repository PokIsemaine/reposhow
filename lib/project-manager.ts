import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Directory for all projects
const PROJECTS_DIR = path.join(process.cwd(), 'projects');

// Project metadata
export interface Project {
  id: string;
  name: string;
  repoUrl: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  latestRunId?: string;
}

// Project creation input
export interface CreateProjectInput {
  name?: string;
  repoUrl: string;
  description?: string;
}

// Project update input
export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

/**
 * Ensure projects directory exists
 */
async function ensureProjectsDir(): Promise<void> {
  try {
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

/**
 * Get the path to a project's directory
 */
export function getProjectDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId);
}

/**
 * Get path to a specific file in a project's directory
 */
function getProjectFilePath(projectId: string, filename: string): string {
  return path.join(getProjectDir(projectId), filename);
}

/**
 * Extract owner/repo from GitHub URL
 */
function extractRepoInfo(url: string): { owner: string; repo: string } | null {
  const cleanUrl = url.trim().replace(/\/+$/, '');
  const patterns = [
    /(?:www\.)?github\.com\/([^\/]+)\/([^\/\s]+)/,
    /^([^\/]+)\/([^\/\s]+)$/,
  ];
  for (const pattern of patterns) {
    const match = cleanUrl.match(pattern);
    if (match && match[1] && match[2]) {
      const repo = match[2].replace(/\.git$/, '');
      return { owner: match[1], repo };
    }
  }
  return null;
}

/**
 * Create a new project
 */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  await ensureProjectsDir();

  const projectId = uuidv4();
  const projectDir = getProjectDir(projectId);

  // Extract repo name for default project name
  const repoInfo = extractRepoInfo(input.repoUrl);
  const projectName = input.name || (repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : 'Untitled Project');

  // Create project directory structure
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(path.join(projectDir, 'repo'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'runs'), { recursive: true });

  const now = new Date().toISOString();

  // Create project.json
  const project: Project = {
    id: projectId,
    name: projectName,
    repoUrl: input.repoUrl,
    description: input.description,
    createdAt: now,
    updatedAt: now,
    runCount: 0,
  };

  await fs.writeFile(
    getProjectFilePath(projectId, 'project.json'),
    JSON.stringify(project, null, 2)
  );

  return project;
}

/**
 * Get project by ID
 */
export async function getProject(projectId: string): Promise<Project | null> {
  try {
    const content = await fs.readFile(getProjectFilePath(projectId, 'project.json'), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Update project
 */
export async function updateProject(
  projectId: string,
  updates: UpdateProjectInput
): Promise<Project> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const updated: Project = {
    ...project,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    getProjectFilePath(projectId, 'project.json'),
    JSON.stringify(updated, null, 2)
  );

  return updated;
}

/**
 * Delete project and all its runs
 */
export async function deleteProject(projectId: string): Promise<void> {
  const projectDir = getProjectDir(projectId);
  await fs.rm(projectDir, { recursive: true, force: true });
}

/**
 * List all projects
 */
export async function listProjects(): Promise<Project[]> {
  await ensureProjectsDir();

  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects: Project[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const project = await getProject(entry.name);
      if (project) {
        // Update run count by checking the runs directory
        const runsDir = path.join(getProjectDir(project.id), 'runs');
        try {
          const runEntries = await fs.readdir(runsDir, { withFileTypes: true });
          const runCount = runEntries.filter(e => e.isDirectory()).length;
          project.runCount = runCount;

          // Find latest run
          if (runCount > 0) {
            const runs = await getProjectRuns(project.id);
            if (runs.length > 0) {
              project.latestRunId = runs[0].id;
            }
          }
        } catch {
          project.runCount = 0;
        }
        projects.push(project);
      }
    }
  }

  // Sort by updatedAt descending
  return projects.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Get all runs for a project
 */
export async function getProjectRuns(projectId: string): Promise<Array<{
  id: string;
  createdAt: string;
}>> {
  const runsDir = path.join(getProjectDir(projectId), 'runs');

  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    const runs: Array<{ id: string; createdAt: string }> = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          const runJsonPath = path.join(runsDir, entry.name, 'run.json');
          const content = await fs.readFile(runJsonPath, 'utf-8');
          const run = JSON.parse(content);
          runs.push({
            id: run.id,
            createdAt: run.createdAt,
          });
        } catch {
          // Skip invalid run directories
        }
      }
    }

    // Sort by createdAt descending
    return runs.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch {
    return [];
  }
}

/**
 * Get project run directory path (for creating runs within a project)
 */
export function getProjectRunDir(projectId: string, runId: string): string {
  return path.join(getProjectDir(projectId), 'runs', runId);
}

/**
 * Get project runs directory (parent of individual run directories)
 */
export function getProjectRunsDir(projectId: string): string {
  return path.join(getProjectDir(projectId), 'runs');
}

/**
 * Find a project by repository URL
 */
export async function findProjectByRepoUrl(repoUrl: string): Promise<Project | null> {
  const projects = await listProjects();

  // Normalize the repoUrl for comparison
  const normalizedUrl = repoUrl.trim().replace(/\/+$/, '').toLowerCase();

  for (const project of projects) {
    const projectUrl = project.repoUrl.trim().replace(/\/+$/, '').toLowerCase();
    if (projectUrl === normalizedUrl) {
      return project;
    }
  }

  return null;
}
