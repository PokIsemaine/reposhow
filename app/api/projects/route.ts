import { NextRequest, NextResponse } from 'next/server';
import { createProject, listProjects, findProjectByRepoUrl } from '@/lib/project-manager';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const repoUrl = searchParams.get('repoUrl');

    // If repoUrl is provided, find project by repo URL
    if (repoUrl) {
      const project = await findProjectByRepoUrl(repoUrl);
      if (project) {
        return NextResponse.json({ project });
      }
      return NextResponse.json({ project: null });
    }

    // Otherwise, list all projects
    const projects = await listProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    console.error('Error listing projects:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    if (!body.repoUrl) {
      return NextResponse.json(
        { error: 'repoUrl is required' },
        { status: 400 }
      );
    }

    const project = await createProject({
      name: body.name,
      repoUrl: body.repoUrl,
      description: body.description,
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error('Error creating project:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
