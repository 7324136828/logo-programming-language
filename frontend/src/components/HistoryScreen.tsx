import React, { useEffect, useState } from 'react';
import { Job, discardJob, deleteJob, downloadZipUrl, getJobs } from '../services/api';
import { Icon } from './Icons';

interface HistoryScreenProps {
  onContinueJob: (job: Job) => void;
  onRefreshNotification?: (count: number) => void;
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({
  onContinueJob,
  onRefreshNotification,
}) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = async () => {
    try {
      const data = await getJobs();
      setJobs(data);
      setError(null);
      const activeCount = data.filter(
        j => j.status === 'in_progress' || j.status === 'queued'
      ).length;
      if (onRefreshNotification) onRefreshNotification(activeCount);
    } catch (err: any) {
      setError(err.message || 'Failed to refresh job history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 3500);
    return () => clearInterval(interval);
  }, []);

  const handleDiscard = async (jobId: string) => {
    if (!window.confirm('Are you sure you want to discard this in-progress job? The temporary directory will be purged.')) {
      return;
    }
    try {
      await discardJob(jobId);
      await loadJobs();
    } catch (err: any) {
      alert(err.message || 'Failed to discard job');
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!window.confirm('Delete this job record?')) return;
    try {
      await deleteJob(jobId);
      await loadJobs();
    } catch (err: any) {
      alert(err.message || 'Failed to delete job');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString();
    } catch {
      return iso;
    }
  };

  const activeJobs = jobs.filter(j => j.status === 'in_progress' || j.status === 'queued');
  const completedJobs = jobs.filter(j => j.status === 'completed');

  return (
    <div className="history-screen">
      <div className="history-header">
        <div>
          <h2>Conversion & Workspace History</h2>
          <div className="history-summary" style={{ marginTop: 6 }}>
            <span>Total records: <strong>{jobs.length}</strong></span>
            <span>Completed: <strong>{completedJobs.length}</strong></span>
            {activeJobs.length > 0 && (
              <span style={{ color: '#0284c7' }}>
                Active / Running: <strong>{activeJobs.length}</strong>
              </span>
            )}
          </div>
        </div>
        <button className="button" onClick={loadJobs} title="Refresh records">
          <Icon name="reset" size={13} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && jobs.length === 0 ? (
        <div className="history-empty">
          <span className="spinner-icon" style={{ width: 20, height: 20, color: '#3b82f6' }} />
          <p>Loading conversion history...</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="jobs-table-card">
          <div className="history-empty">
            <Icon name="turtle" size={36} style={{ color: '#94a3b8' }} />
            <p><strong>No conversions yet.</strong></p>
            <p>Save or export a workspace from the Studio, or drop a .logo file to start an isolated conversion job.</p>
          </div>
        </div>
      ) : (
        <div className="jobs-table-card">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Workspace / File</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Created</th>
                <th>File Size</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <tr key={job.id} className={`row-status-${job.status}`}>
                  <td>
                    <div style={{ fontWeight: 600, color: '#1f2937' }}>{job.filename}</div>
                    <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>ID: {job.id.slice(0, 8)}...</div>
                  </td>
                  <td>
                    <span className={`badge badge-${job.status}`}>
                      {(job.status === 'in_progress' || job.status === 'queued') && (
                        <span className="spinner-icon" />
                      )}
                      {job.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{job.progress}%</span>
                      <div className="progress-bar-wrap">
                        <div
                          className="progress-bar-fill"
                          style={{
                            width: `${job.progress}%`,
                            background:
                              job.status === 'failed'
                                ? '#ef4444'
                                : job.status === 'completed'
                                ? '#22c55e'
                                : '#0284c7',
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td style={{ color: '#4b5563' }}>{formatDate(job.created_at)}</td>
                  <td style={{ color: '#4b5563', fontFamily: 'monospace' }}>{formatSize(job.file_size)}</td>
                  <td>
                    <div className="btn-group">
                      {(job.status === 'in_progress' || job.status === 'queued') && (
                        <>
                          <button
                            className="btn-continue"
                            onClick={() => onContinueJob(job)}
                            title="Continue / monitor in Studio"
                          >
                            Continue
                          </button>
                          <button
                            className="btn-discard"
                            onClick={() => handleDiscard(job.id)}
                            title="Discard job and purge temporary folder"
                          >
                            Discard
                          </button>
                        </>
                      )}

                      {job.status === 'completed' && (
                        <>
                          <a
                            className="btn-download"
                            href={downloadZipUrl(job.id)}
                            download
                            title="Download consolidated output ZIP"
                          >
                            <Icon name="download" size={12} />
                            Download ZIP
                          </a>
                          <button
                            className="button quiet"
                            style={{ height: 28, fontSize: 11, padding: '0 8px' }}
                            onClick={() => onContinueJob(job)}
                            title="Open in Studio"
                          >
                            Open
                          </button>
                        </>
                      )}

                      {(job.status === 'failed' || job.status === 'discarded') && (
                        <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 8 }}>
                          {job.status}
                        </span>
                      )}

                      <button
                        className="btn-delete"
                        onClick={() => handleDelete(job.id)}
                        title="Delete record"
                        aria-label="Delete record"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
