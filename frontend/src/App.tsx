import React, { useState } from 'react';
import { Navigation } from './components/Navigation';
import { StudioScreen } from './components/StudioScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { Job } from './services/api';

export const App: React.FC = () => {
  const [activeScreen, setActiveScreen] = useState<'studio' | 'history'>('studio');
  const [saveStatus, setSaveStatus] = useState<string>('Saved on this device');
  const [toastMessage, setToastMessage] = useState<string>('');
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [inProgressCount, setInProgressCount] = useState<number>(0);

  // Cross-component triggers
  const [exportTrigger, setExportTrigger] = useState<{
    type: 'png' | 'svg' | 'logo' | 'editor' | 'zip';
    timestamp: number;
  } | null>(null);
  const [openTrigger, setOpenTrigger] = useState<number>(0);
  const [saveTrigger, setSaveTrigger] = useState<number>(0);
  const [activeJobToLoad, setActiveJobToLoad] = useState<Job | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage('');
    }, 4500);
  };

  const handleContinueJobFromHistory = (job: Job) => {
    setActiveJobToLoad(job);
    setActiveScreen('studio');
    showToast(`Continuing job: ${job.filename}`);
  };

  return (
    <div className="app-root">
      <Navigation
        activeScreen={activeScreen}
        onScreenChange={setActiveScreen}
        saveStatus={saveStatus}
        onOpen={() => setOpenTrigger(Date.now())}
        onSave={() => setSaveTrigger(Date.now())}
        onExportPng={() => setExportTrigger({ type: 'png', timestamp: Date.now() })}
        onExportSvg={() => setExportTrigger({ type: 'svg', timestamp: Date.now() })}
        onExportLogo={() => setExportTrigger({ type: 'logo', timestamp: Date.now() })}
        onExportEditor={() => setExportTrigger({ type: 'editor', timestamp: Date.now() })}
        onExportZip={() => setExportTrigger({ type: 'zip', timestamp: Date.now() })}
        onOpenHelp={() => setShowHelpModal(true)}
        inProgressJobCount={inProgressCount}
      />

      {activeScreen === 'studio' ? (
        <StudioScreen
          onNotifySave={setSaveStatus}
          showHelpModal={showHelpModal}
          onCloseHelpModal={() => setShowHelpModal(false)}
          onOpenHelpModal={() => setShowHelpModal(true)}
          activeJobToLoad={activeJobToLoad}
          onClearActiveJob={() => setActiveJobToLoad(null)}
          onToast={showToast}
          exportTrigger={exportTrigger}
          onOpenTrigger={openTrigger}
          onSaveTrigger={saveTrigger}
        />
      ) : (
        <HistoryScreen
          onContinueJob={handleContinueJobFromHistory}
          onRefreshNotification={setInProgressCount}
        />
      )}

      {/* Toast popup */}
      <div className="toast" id="toast" role="status" aria-live="polite">
        {toastMessage}
      </div>
    </div>
  );
};

export default App;
