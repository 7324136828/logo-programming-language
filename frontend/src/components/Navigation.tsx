import React, { useRef } from 'react';
import { Icon } from './Icons';

interface NavigationProps {
  activeScreen: 'studio' | 'history';
  onScreenChange: (screen: 'studio' | 'history') => void;
  saveStatus: string;
  onOpen: () => void;
  onSave: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
  onExportLogo: () => void;
  onExportEditor: () => void;
  onExportZip: () => void;
  onOpenHelp: () => void;
  inProgressJobCount?: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeScreen,
  onScreenChange,
  saveStatus,
  onOpen,
  onSave,
  onExportPng,
  onExportSvg,
  onExportLogo,
  onExportEditor,
  onExportZip,
  onOpenHelp,
  inProgressJobCount = 0,
}) => {
  const exportDetailsRef = useRef<HTMLDetailsElement>(null);

  const handleExportSelect = (action: () => void) => {
    action();
    if (exportDetailsRef.current) {
      exportDetailsRef.current.open = false;
    }
  };

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-symbol">
          <Icon name="turtle" size={24} />
        </div>
        <div>
          <div className="brand-title">
            logo<span> / studio</span>
          </div>
          <div className="edition">An old idea. A new playground.</div>
        </div>
      </div>

      {/* Screen Navigation Tabs */}
      <nav className="nav-tabs" aria-label="Main Navigation">
        <button
          className={`nav-tab-button ${activeScreen === 'studio' ? 'active' : ''}`}
          onClick={() => onScreenChange('studio')}
        >
          <Icon name="turtle" size={14} />
          <span>Studio</span>
        </button>
        <button
          className={`nav-tab-button ${activeScreen === 'history' ? 'active' : ''}`}
          onClick={() => onScreenChange('history')}
        >
          <Icon name="history" size={14} />
          <span>History</span>
          {inProgressJobCount > 0 && (
            <span
              style={{
                marginLeft: 4,
                padding: '1px 5px',
                borderRadius: 10,
                fontSize: 10,
                background: '#0284c7',
                color: '#fff',
              }}
            >
              {inProgressJobCount}
            </span>
          )}
        </button>
      </nav>

      <div className="header-actions">
        <span className="local-badge">
          <i className="dot" />
          <span id="save-status">{saveStatus}</span>
        </span>
        <button className="button" id="open" onClick={onOpen}>
          <Icon name="open" size={14} />
          <span className="label">Open</span>
        </button>
        <button className="button" id="save" onClick={onSave}>
          <Icon name="save" size={14} />
          <span className="label">Save</span>
        </button>

        <details className="menu" id="export-menu" ref={exportDetailsRef}>
          <summary className="button">
            <Icon name="export" size={14} />
            <span className="label">Export</span>
            <Icon name="chevron" size={12} />
          </summary>
          <div className="menu-content">
            <button onClick={() => handleExportSelect(onExportPng)}>
              <Icon name="export" size={14} />
              Picture (.png)
            </button>
            <button onClick={() => handleExportSelect(onExportSvg)}>
              <Icon name="code" size={14} />
              Vector picture (.svg)
            </button>
            <button onClick={() => handleExportSelect(onExportLogo)}>
              <Icon name="code" size={14} />
              Procedures (.logo)
            </button>
            <button onClick={() => handleExportSelect(onExportEditor)}>
              <Icon name="code" size={14} />
              Editor source (.logo)
            </button>
            <button onClick={() => handleExportSelect(onExportZip)}>
              <Icon name="download" size={14} />
              Output Bundle (.zip)
            </button>
          </div>
        </details>

        <span className="header-divider" />
        <button
          className="button icon quiet"
          id="help"
          aria-label="Open Logo guide"
          title="Logo guide"
          onClick={onOpenHelp}
        >
          <Icon name="help" size={19} />
        </button>
      </div>
    </header>
  );
};
