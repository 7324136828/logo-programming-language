/**
 * Backend API client service.
 */

export interface Job {
  id: string;
  filename: string;
  file_size: number;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'discarded';
  progress: number;
  created_at: string;
  completed_at?: string;
  error_message?: string;
  temp_dir?: string;
  has_zip: boolean;
  details?: Record<string, any>;
}

export interface SamplerItem {
  id: string;
  title: string;
  description: string;
  instructions: string;
  has_graphics: boolean;
  preview_command: string;
  starter_commands: string[];
  tags: string[];
}

export interface LogoValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  procedures: string[];
  token_count: number;
}

export const downloadZipUrl = (jobId: string): string => `/api/jobs/${jobId}/download-zip`;

export async function getHealth(): Promise<{ status: string; service: string }> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function getJobs(): Promise<Job[]> {
  const res = await fetch('/api/jobs');
  if (!res.ok) throw new Error('Failed to load conversion jobs');
  return res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (!res.ok) throw new Error('Failed to load job');
  return res.json();
}

export async function createConversionJob(data: {
  file?: File;
  code?: string;
  title?: string;
  svg?: string;
}): Promise<Job> {
  const formData = new FormData();
  if (data.file) formData.append('file', data.file);
  if (data.code) formData.append('code', data.code);
  if (data.title) formData.append('title', data.title);
  if (data.svg) formData.append('svg', data.svg);

  const res = await fetch('/api/jobs', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to create job' }));
    throw new Error(err.detail || 'Failed to create job');
  }
  return res.json();
}

export async function discardJob(jobId: string): Promise<{ job_id: string; status: string }> {
  const res = await fetch(`/api/jobs/${jobId}/discard`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to discard job');
  return res.json();
}

export async function deleteJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete job');
}

export async function validateLogo(source: string): Promise<LogoValidationResult> {
  const res = await fetch('/api/logo/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });
  if (!res.ok) throw new Error('Failed to validate Logo code');
  return res.json();
}

export async function getSamplers(): Promise<SamplerItem[]> {
  const res = await fetch('/api/samplers');
  if (!res.ok) throw new Error('Failed to load samplers');
  return res.json();
}

export async function exportWorkspaceZip(payload: {
  title: string;
  editor_source: string;
  workspace_json?: string;
  svg_preview?: string;
}): Promise<Blob> {
  const res = await fetch('/api/workspace/export-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to export workspace bundle');
  return res.blob();
}
