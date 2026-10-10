import React, { useEffect, useRef, useState } from 'react';
import { LogoInterpreter, logoRepr } from '../core/interpreter.js';
import { LogoScene } from '../rendering/scene.js';
import { SAMPLERS, loadSampler, findSampler } from '../data/samplers.js';
import { serializeWorkspace, deserializeWorkspace, exportLogoSource } from '../core/workspace.js';
import { BUILTIN_VARIABLES } from '../core/environment.js';
import { examples } from '../data/examples.js';
import { createConversionJob, exportWorkspaceZip, Job } from '../services/api';
import { Icon } from './Icons';

interface StudioScreenProps {
  onNotifySave?: (status: string) => void;
  showHelpModal: boolean;
  onCloseHelpModal: () => void;
  onOpenHelpModal: () => void;
  activeJobToLoad?: Job | null;
  onClearActiveJob?: () => void;
  onToast: (msg: string) => void;
  exportTrigger?: { type: 'png' | 'svg' | 'logo' | 'editor' | 'zip'; timestamp: number } | null;
  onOpenTrigger?: number;
  onSaveTrigger?: number;
}

const STORAGE_KEY = 'ti-logo-studio-workspace-v1';

const escapeHTML = (value: any) =>
  String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);

const slug = (val: string) => val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';

export const StudioScreen: React.FC<StudioScreenProps> = ({
  onNotifySave,
  showHelpModal,
  onCloseHelpModal,
  onOpenHelpModal,
  activeJobToLoad,
  onClearActiveJob,
  onToast,
  exportTrigger,
  onOpenTrigger,
  onSaveTrigger,
}) => {
  // DOM Refs
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const canvasStageRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const codeHighlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const consoleLogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const helpDialogRef = useRef<HTMLDialogElement>(null);
  const libraryDialogRef = useRef<HTMLDialogElement>(null);
  const shapeDialogRef = useRef<HTMLDialogElement>(null);

  // App Core Instances
  const interpreterRef = useRef<LogoInterpreter | null>(null);
  const sceneRef = useRef<LogoScene | null>(null);

  // Studio State
  const [editorValue, setEditorValue] = useState<string>('');
  const [title, setTitle] = useState<string>('Orbital bloom');
  const [description, setDescription] = useState<string>('Small instructions. Unexpected possibilities.');
  const [tip, setTip] = useState<string>('FD moves forward. RT turns right. REPEAT makes something wonderful happen again.');
  const [activeExample, setActiveExample] = useState<string | null>('bloom');
  const [activeSampler, setActiveSampler] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'code' | 'workspace'>('code');

  const [busy, setBusy] = useState<boolean>(false);
  const [executionStatus, setExecutionStatus] = useState<string>('Logo · ready');
  const [cursorPos, setCursorPos] = useState<string>('Ln 1, Col 1');
  const [turtleInfo, setTurtleInfo] = useState<string>('X 0.0 · Y 0.0 · 0°');
  const [stageCaption, setStageCaption] = useState<string>('X / Y   CREATIVE SPACE');
  const [isFrozen, setIsFrozen] = useState<boolean>(false);
  const [gridEnabled, setGridEnabled] = useState<boolean>(true);

  // Console State
  const [consoleInput, setConsoleInput] = useState<string>('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const historyIndexRef = useRef<number>(0);
  const historyDraftRef = useRef<string>('');

  // Shape Editor State
  const [shapeId, setShapeId] = useState<number>(0);
  const [shapeBits, setShapeBits] = useState<boolean[]>(new Array(256).fill(false));

  // Drag and drop dropzone
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Workspace View State
  const [workspaceProcedures, setWorkspaceProcedures] = useState<[string, any][]>([]);
  const [workspaceVariables, setWorkspaceVariables] = useState<[string, any][]>([]);
  const [visibleSpriteCount, setVisibleSpriteCount] = useState<number>(0);

  // Selection Request tracking
  const selectionRequestRef = useRef<number>(0);
  const activeTaskRef = useRef<Promise<any> | null>(null);

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------
  const logToConsole = (text: string, type: 'info' | 'command' | 'output' | 'error' = 'info', newline = true) => {
    const container = consoleLogRef.current;
    if (!container) return;

    if (!newline && container.lastElementChild?.classList.contains('output')) {
      const span = container.lastElementChild.querySelector('span:last-child');
      if (span) span.textContent += String(text);
    } else {
      const row = document.createElement('div');
      row.className = `console-row ${type}`;
      const prefix = document.createElement('span');
      prefix.className = 'prompt';
      prefix.textContent = type === 'command' ? '›' : type === 'error' ? '!' : '·';
      const content = document.createElement('span');
      content.textContent = String(text);
      row.append(prefix, content);
      container.append(row);
    }
    while (container.children.length > 300) {
      container.firstElementChild?.remove();
    }
    container.scrollTop = container.scrollHeight;
  };

  const updateCursorPosition = () => {
    const el = editorRef.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const lines = before.split('\n');
    setCursorPos(`Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`);
  };

  const syncCodeHighlight = (source: string) => {
    if (!codeHighlightRef.current || !lineNumbersRef.current) return;
    const tokens = /(;[^\n]*|"[^\s\[\]()]+|:[\w.]+|\b(?:TO|END|REPEAT|IF|IFTRUE|IFFALSE|TEST|STOP|OUTPUT|MAKE|PRINT|FD|FORWARD|BK|BACK|RT|RIGHT|LT|LEFT|PU|PD|CS|HT|ST|SC|SXY|HOME|TELL|CARRY|SS|SH|EACH|FREEZE|THAW|WAIT)\b|-?\b\d+(?:\.\d+)?\b)/gi;
    let last = 0;
    let html = '';
    for (const match of source.matchAll(tokens)) {
      html += escapeHTML(source.slice(last, match.index));
      const part = match[0];
      const type =
        part[0] === ';'
          ? 'comment'
          : part[0] === ':'
          ? 'variable'
          : part[0] === '"'
          ? 'word'
          : /^-?\d/.test(part)
          ? 'number'
          : 'keyword';
      html += `<span class="${type}">${escapeHTML(part)}</span>`;
      last = match.index! + part.length;
    }
    codeHighlightRef.current.innerHTML = html + escapeHTML(source.slice(last)) + '\n';
    lineNumbersRef.current.textContent = source.split('\n').map((_, i) => i + 1).join('\n') + '\n';
  };

  const refreshWorkspaceData = () => {
    const interp = interpreterRef.current as any;
    if (!interp) return;
    const env = interp.environment;
    if (env?.procedures) {
      setWorkspaceProcedures([...env.procedures]);
    }
    if (env?.variables) {
      const vars = [...env.variables].filter(
        ([name, val]: [string, any]) =>
          !Object.hasOwn(BUILTIN_VARIABLES, name) ||
          JSON.stringify(val) !== JSON.stringify((BUILTIN_VARIABLES as any)[name])
      );
      setWorkspaceVariables(vars);
    }
    if (interp.sprites?.sprites) {
      setVisibleSpriteCount(interp.sprites.sprites.filter((s: any) => s.visible).length);
    }
  };

  const saveToLocal = (currentCode?: string, currentTitle?: string) => {
    const interp = interpreterRef.current;
    if (!interp || busy) return;
    try {
      const data = serializeWorkspace(interp, {
        editorSource: currentCode ?? editorValue,
        title: currentTitle ?? title,
      });
      localStorage.setItem(STORAGE_KEY, data);
      if (onNotifySave) onNotifySave('Saved on this device');
    } catch {
      if (onNotifySave) onNotifySave('Use Save to keep work');
    }
  };

  // -------------------------------------------------------------
  // Execution Engine
  // -------------------------------------------------------------
  const withTask = async (operation: () => Promise<any>) => {
    const interp = interpreterRef.current;
    if (!interp) return;
    if (busy) {
      onToast('Stop the running program to start another.');
      return;
    }

    setBusy(true);
    setExecutionStatus('Logo · running');

    const task = (async () => {
      try {
        return await operation();
      } catch (err: any) {
        setExecutionStatus('Logo · check console');
        logToConsole(err.message, 'error');
        onToast(err.message);
      } finally {
        setBusy(false);
        activeTaskRef.current = null;
        refreshWorkspaceData();
        saveToLocal();
        sceneRef.current?.render();
      }
    })();

    activeTaskRef.current = task;
    return task;
  };

  const executeCode = async (source: string, label = 'Complete') => {
    const interp = interpreterRef.current;
    if (!interp) return;
    canvasStageRef.current?.focus({ preventScroll: true });
    const result = await interp.run(source, { maxSteps: 1_000_000 });
    if (result) {
      if (result.status === 'error' || result.status === 'step-limit') {
        logToConsole(result.error || 'The program could not finish.', 'error');
        setExecutionStatus(result.status === 'step-limit' ? 'Logo · step limit' : 'Logo · check console');
      } else if (result.status === 'interrupted') {
        logToConsole('Program stopped. The workspace is ready for your next command.');
        setExecutionStatus('Logo · ready');
      } else if (label) {
        logToConsole(`${label} · ${(interp.stepCount ?? 0).toLocaleString()} steps`);
        setExecutionStatus('Logo · ready');
      }
    }
    return result;
  };

  const stopRunning = async () => {
    const interp = interpreterRef.current;
    if (!interp) return;
    interp.stop();
    if (activeTaskRef.current) {
      await activeTaskRef.current;
    }
  };

  // -------------------------------------------------------------
  // Sampler & Example Selection
  // -------------------------------------------------------------
  const chooseExample = async (id: string) => {
    const req = ++selectionRequestRef.current;
    await stopRunning();
    if (req !== selectionRequestRef.current) return;

    const example = examples.find((e: any) => e.id === id);
    if (!example) return;

    setActiveExample(id);
    setActiveSampler(null);
    setTitle(example.title);
    setDescription(example.description);
    setTip('FD moves forward. RT turns right. REPEAT makes something wonderful happen again.');

    const interp = interpreterRef.current;
    if (!interp) return;
    interp.reset();

    setEditorValue(example.source);
    syncCodeHighlight(example.source);

    await withTask(() => executeCode(example.source, example.title));
  };

  const chooseSampler = async (id: string) => {
    const req = ++selectionRequestRef.current;
    await stopRunning();
    if (req !== selectionRequestRef.current) return;

    if (libraryDialogRef.current?.open) {
      libraryDialogRef.current.close();
    }

    const item = findSampler(id);
    if (!item) return;

    setActiveExample(null);
    setActiveSampler(id);
    setTitle(item.title);
    setDescription(item.description);
    setTip(item.instructions);

    const source = `; ${item.title} — TI Logo, 1981\n; Original procedures are loaded in Workspace.\n; ${item.instructions}\n\n${item.hasGraphics ? 'PU HT\n' : ''}${item.previewCommand}\n`;
    setEditorValue(source);
    syncCodeHighlight(source);

    const interp = interpreterRef.current;
    if (!interp) return;

    await withTask(async () => {
      await loadSampler(id, interp);
      logToConsole(`${item.title} loaded · ${interp.environment?.procedures?.size ?? 0} original procedures`);
      logToConsole(item.instructions);
    });

    onToast('Sampler loaded. Press Run code to start the activity.');
  };

  const handleNewWorkspace = async () => {
    const req = ++selectionRequestRef.current;
    await stopRunning();
    if (req !== selectionRequestRef.current) return;

    const interp = interpreterRef.current;
    if (!interp) return;
    interp.reset();
    setExecutionStatus('Logo · ready');

    const freshSource = '; Your next idea starts here.\nCS\n';
    setEditorValue(freshSource);
    syncCodeHighlight(freshSource);
    setTitle('Untitled workspace');
    setDescription('Your ideas, brought to life one instruction at a time.');
    setActiveExample(null);
    setActiveSampler(null);

    refreshWorkspaceData();
    saveToLocal(freshSource, 'Untitled workspace');
    sceneRef.current?.render();
    onToast('A fresh workspace.');
  };

  // -------------------------------------------------------------
  // File Open & Ingestion
  // -------------------------------------------------------------
  const loadWorkspaceContent = async (sourceText: string, fileLabel: string) => {
    const interp = interpreterRef.current;
    if (!interp) return;
    await stopRunning();
    await withTask(async () => {
      const data = await deserializeWorkspace(sourceText, interp);
      const code = data.editorSource ?? sourceText;
      setEditorValue(code);
      syncCodeHighlight(code);
      const t = data.title && data.title !== 'Imported Logo source' ? data.title : fileLabel.replace(/\.[^.]+$/, '');
      setTitle(t);
      setActiveExample(null);
      setActiveSampler(interp.sprites.samplerId || null);
      logToConsole(`Opened ${fileLabel}`);
      onToast('Workspace opened.');
    });
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8_000_000) {
      onToast('Please choose a workspace smaller than 8 MB.');
      return;
    }
    const text = await file.text();
    await loadWorkspaceContent(text, file.name);

    // Also register job in background API for persistent history (Pillar 2)
    createConversionJob({ file }).catch(() => {});
  };

  // -------------------------------------------------------------
  // Exports & Downloads
  // -------------------------------------------------------------
  const triggerDownload = (data: any, filename: string, mime: string) => {
    const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleSaveWorkspace = async () => {
    const interp = interpreterRef.current;
    if (!interp) return;
    try {
      const data = serializeWorkspace(interp, { editorSource: editorValue, title });
      triggerDownload(data, `${slug(title)}.json`, 'application/json');
      onToast('Complete workspace saved, including drawing and sprite shapes.');

      // Also persist snapshot to backend jobs API (Pillar 2 & 3)
      createConversionJob({
        code: editorValue,
        title,
        svg: sceneRef.current?.exportSVG(),
      }).catch(() => {});
    } catch (err: any) {
      onToast(err.message);
    }
  };

  const handleExportPng = async () => {
    try {
      const scene = sceneRef.current;
      if (!scene) return;
      const png = await scene.exportPNG();
      if (typeof png !== 'string') {
        triggerDownload(png, `${slug(title)}.png`, 'image/png');
      } else {
        const res = await fetch(png);
        triggerDownload(await res.blob(), `${slug(title)}.png`, 'image/png');
      }
    } catch (err: any) {
      onToast(err.message);
    }
  };

  const handleExportSvg = () => {
    try {
      const scene = sceneRef.current;
      if (!scene) return;
      triggerDownload(scene.exportSVG(), `${slug(title)}.svg`, 'image/svg+xml');
    } catch (err: any) {
      onToast(err.message);
    }
  };

  const handleExportLogoProcedures = () => {
    const interp = interpreterRef.current;
    if (!interp) return;
    triggerDownload(exportLogoSource(interp), `${slug(title)}-procedures.logo`, 'text/plain');
  };

  const handleExportEditorSource = () => {
    triggerDownload(editorValue, `${slug(title)}.logo`, 'text/plain');
  };

  const handleExportZipBundle = async () => {
    const interp = interpreterRef.current;
    if (!interp) return;
    try {
      onToast('Packaging consolidated ZIP archive...');
      const blob = await exportWorkspaceZip({
        title,
        editor_source: editorValue,
        workspace_json: serializeWorkspace(interp, { editorSource: editorValue, title }),
        svg_preview: sceneRef.current?.exportSVG(),
      });
      triggerDownload(blob, `${slug(title)}_bundle.zip`, 'application/zip');
      onToast('Output ZIP bundle downloaded.');
    } catch (err: any) {
      onToast(err.message);
    }
  };

  // -------------------------------------------------------------
  // Sprite Shape Editor
  // -------------------------------------------------------------
  const openShapeEditor = (id: number) => {
    setShapeId(id);
    const interp = interpreterRef.current;
    if (!interp) return;
    const pattern = interp.sprites.getShapePattern(id);
    const bits = Array.from({ length: 256 }, (_, index) => {
      const x = index % 16;
      const y = Math.floor(index / 16);
      const byte = (x >= 8 ? 16 : 0) + (y >= 8 ? 8 : 0) + (y % 8);
      return Boolean(pattern[byte] & (1 << (7 - (x % 8))));
    });
    setShapeBits(bits);
    if (shapeDialogRef.current && !shapeDialogRef.current.open) {
      shapeDialogRef.current.showModal();
    }
  };

  const applyShapeEdit = () => {
    const interp = interpreterRef.current;
    if (!interp) return;
    const pattern = new Array(32).fill(0);
    shapeBits.forEach((on, index) => {
      if (!on) return;
      const x = index % 16;
      const y = Math.floor(index / 16);
      const byte = (x >= 8 ? 16 : 0) + (y >= 8 ? 8 : 0) + (y % 8);
      pattern[byte] |= 1 << (7 - (x % 8));
    });
    interp.sprites.setShapePattern(shapeId, pattern);
    shapeDialogRef.current?.close();
    saveToLocal();
    sceneRef.current?.render();
    onToast(`Shape ${shapeId} updated.`);
  };

  // -------------------------------------------------------------
  // Keyboard & Drag/Drop Ingestion Setup
  // -------------------------------------------------------------
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Ingestion via Clipboard Paste (Ctrl+V)
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === 'file') {
            const file = items[i].getAsFile();
            if (file) {
              file.text().then(text => {
                loadWorkspaceContent(text, file.name || 'pasted-workspace.logo');
                onToast('Loaded file from clipboard paste.');
              });
              return;
            }
          }
        }
      }

      // Check text paste if not focused in textarea or inputs
      if (document.activeElement !== editorRef.current && !(document.activeElement instanceof HTMLInputElement)) {
        const text = e.clipboardData?.getData('text');
        if (text && (text.includes('TO ') || text.includes('REPEAT') || text.startsWith('{'))) {
          e.preventDefault();
          loadWorkspaceContent(text, 'pasted-source.logo');
          onToast('Pasted Logo program loaded.');
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!busy) withTask(() => executeCode(editorValue));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveWorkspace();
        return;
      }
      if (e.key === 'Escape') {
        if (busy) {
          e.preventDefault();
          stopRunning();
        }
        return;
      }

      // Game / interactive keyboard keys for running Logo samplers (e.g. People, Design)
      const interp = interpreterRef.current;
      if (!interp || !busy) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.target === editorRef.current || (e.target as Element)?.closest('dialog')) {
        return;
      }

      const keyMap: Record<string, string> = {
        ArrowLeft: 'S',
        ArrowRight: 'D',
        ArrowDown: 'X',
        ArrowUp: 'E',
        Enter: '\n',
        Backspace: '\b',
      };
      const key = keyMap[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : null);
      if (key) {
        e.preventDefault();
        interp.queueInputKey(key);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setIsDraggingOver(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        file.text().then(text => {
          loadWorkspaceContent(text, file.name);
          onToast(`Loaded dropped file: ${file.name}`);
        });
      }
    };

    window.addEventListener('paste', handlePaste);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [busy, editorValue, title]);

  // -------------------------------------------------------------
  // Initialization & Animation Loop
  // -------------------------------------------------------------
  useEffect(() => {
    if (!canvasHostRef.current) return;

    const interpreter = new (LogoInterpreter as any)({
      onOutput: (text: string, { newline } = { newline: true }) =>
        logToConsole(text, 'output', newline),
      onEditShape: (id: number) => openShapeEditor(id),
    });
    interpreterRef.current = interpreter;

    const scene = new LogoScene(canvasHostRef.current, interpreter);
    scene.setGrid(gridEnabled);
    sceneRef.current = scene;

    logToConsole('Welcome to Logo Studio. Write a little code. See what happens.');

    let animationId: number;
    let previousTime = performance.now();
    let lastStatusUpdate = 0;

    const frameLoop = (now: number) => {
      const delta = Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;

      if (!interpreter.waiting) {
        interpreter.tick(delta);
      }
      scene.render();

      if (now - lastStatusUpdate > 150) {
        const turtle = interpreter.turtle;
        setTurtleInfo(`X ${turtle.x.toFixed(1)} · Y ${turtle.y.toFixed(1)} · ${Math.round(turtle.heading)}°`);
        setIsFrozen(Boolean(interpreter.frozen));

        if (busy) {
          setExecutionStatus(
            interpreter.waitingForInput
              ? 'Logo · waiting for keyboard input'
              : `Logo · ${(interpreter.stepCount ?? 0).toLocaleString()} steps`
          );
        }
        setStageCaption(interpreter.waitingForInput ? 'KEYBOARD READY · TYPE TO PLAY' : 'X / Y   CREATIVE SPACE');
        lastStatusUpdate = now;
      }

      animationId = requestAnimationFrame(frameLoop);
    };

    animationId = requestAnimationFrame(frameLoop);

    // Initial Load: check storage or load starter example bloom
    let restored = false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        deserializeWorkspace(saved, interpreter).then((data: any) => {
          setEditorValue(data.editorSource || '');
          syncCodeHighlight(data.editorSource || '');
          setTitle(data.title || 'Your workspace');
          setActiveExample(null);
          setActiveSampler(interpreter.sprites.samplerId || null);
          logToConsole('Your previous workspace is ready.');
          refreshWorkspaceData();
          scene.render();
        });
        restored = true;
      }
    } catch {
      logToConsole('A fresh workspace is ready.');
    }

    if (!restored) {
      chooseExample('bloom');
    }

    return () => {
      cancelAnimationFrame(animationId);
      interpreter.stop();
    };
  }, []);

  // External trigger reactions (from Navigation bar)
  useEffect(() => {
    if (exportTrigger) {
      if (exportTrigger.type === 'png') handleExportPng();
      else if (exportTrigger.type === 'svg') handleExportSvg();
      else if (exportTrigger.type === 'logo') handleExportLogoProcedures();
      else if (exportTrigger.type === 'editor') handleExportEditorSource();
      else if (exportTrigger.type === 'zip') handleExportZipBundle();
    }
  }, [exportTrigger]);

  useEffect(() => {
    if (onOpenTrigger) {
      fileInputRef.current?.click();
    }
  }, [onOpenTrigger]);

  useEffect(() => {
    if (onSaveTrigger) {
      handleSaveWorkspace();
    }
  }, [onSaveTrigger]);

  useEffect(() => {
    if (showHelpModal && helpDialogRef.current && !helpDialogRef.current.open) {
      helpDialogRef.current.showModal();
    }
  }, [showHelpModal]);

  // Load Job if switched from History Screen (Pillar 2 "Continue")
  useEffect(() => {
    if (activeJobToLoad) {
      if (activeJobToLoad.temp_dir) {
        // Fetch job detail or extracted logo source
        fetch(`/api/jobs/${activeJobToLoad.id}`)
          .then(r => r.json())
          .then(job => {
            if (job.details?.procedure_names) {
              onToast(`Monitoring / continuing ${job.filename}`);
            }
          })
          .catch(() => {});
      }
      if (onClearActiveJob) onClearActiveJob();
    }
  }, [activeJobToLoad]);

  return (
    <div className="workspace">
      {/* Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="dropzone-overlay">
          <Icon name="turtle" size={48} />
          <h2>Drop Logo File to Import</h2>
          <p>Drop .logo or .json workspace anywhere to stage and run</p>
        </div>
      )}

      {/* Hidden File Input for Open Action */}
      <input
        ref={fileInputRef}
        type="file"
        id="file-input"
        accept=".json,.logo,.txt"
        hidden
        onChange={handleFileInputChange}
      />

      {/* Sidebar */}
      <aside className="sidebar" aria-label="Example library">
        <section>
          <h2 className="section-label">
            Start exploring <span className="count">03</span>
          </h2>
          <div className="examples">
            {examples.map((ex: any) => (
              <button
                key={ex.id}
                className={`example ${activeExample === ex.id ? 'active' : ''}`}
                onClick={() => chooseExample(ex.id)}
              >
                <span className="example-mark">
                  <Icon name={ex.icon} size={21} />
                </span>
                <span>
                  <span className="example-title">{ex.title}</span>
                  <span className="example-caption">{ex.caption}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="library-section">
          <h2 className="section-label">
            The 1981 collection <span className="count">10</span>
          </h2>
          <div className="sampler-list">
            {SAMPLERS.map((s: any, i: number) => (
              <button
                key={s.id}
                className={`sampler ${activeSampler === s.id ? 'active' : ''}`}
                onClick={() => chooseSampler(s.id)}
              >
                <span className="index">{String(i + 1).padStart(2, '0')}</span>
                {s.title}
              </button>
            ))}
          </div>
        </section>

        <div className="sidebar-note">
          <h3>A little code.<br />A lot of possibility.</h3>
          <p>Meet the turtle. Turn an idea into a shape. See where it takes you.</p>
          <a
            href="#guide"
            id="sidebar-help"
            onClick={e => {
              e.preventDefault();
              onOpenHelpModal();
            }}
          >
            The pocket guide <Icon name="arrow" size={13} />
          </a>
        </div>
      </aside>

      {/* Main Studio Area */}
      <main className="main">
        <div className="workspace-heading">
          <div>
            <div className="eyebrow">Your creative workspace</div>
            <h1 id="workspace-title">{title}</h1>
            <p id="workspace-description">{description}</p>
          </div>
          <div className="workspace-tags">
            <span className="tag">Turtle graphics</span>
            <span className="tag">Creative coding</span>
          </div>
          <button
            className="button mobile-library"
            id="library"
            style={{ display: 'none' }}
            onClick={() => libraryDialogRef.current?.showModal()}
          >
            Collection <Icon name="chevron" size={12} />
          </button>
        </div>

        <div className="studio-grid">
          {/* Left Column: Canvas & Console */}
          <div className="left-column">
            {/* Canvas Panel */}
            <section className="panel canvas-panel" aria-label="Logo drawing canvas">
              <div className="panel-toolbar">
                <h2 className="panel-title">
                  <Icon name="turtle" size={15} />
                  The playground
                </h2>
                <div className="panel-actions">
                  <button
                    className="button"
                    id="grid"
                    aria-pressed={gridEnabled}
                    title="Toggle coordinate grid"
                    onClick={() => {
                      const next = !gridEnabled;
                      setGridEnabled(next);
                      sceneRef.current?.setGrid(next);
                      sceneRef.current?.render();
                    }}
                  >
                    <Icon name="grid" size={12} />
                    Grid
                  </button>
                  <button
                    className="button"
                    id="freeze"
                    aria-pressed={isFrozen}
                    title="Pause or resume sprite motion"
                    onClick={() => {
                      const interp = interpreterRef.current;
                      if (!interp) return;
                      interp.frozen = !interp.frozen;
                      setIsFrozen(interp.frozen);
                      saveToLocal();
                    }}
                  >
                    <Icon name={isFrozen ? 'play' : 'pause'} size={12} />
                    {isFrozen ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    className="button"
                    id="fullscreen"
                    aria-label="Expand drawing canvas"
                    title="Expand canvas"
                    onClick={async () => {
                      try {
                        if (document.fullscreenElement) {
                          await document.exitFullscreen();
                        } else if (canvasStageRef.current) {
                          await canvasStageRef.current.requestFullscreen();
                        }
                      } catch {
                        onToast('Fullscreen is unavailable in this browser.');
                      }
                    }}
                  >
                    <Icon name="expand" size={13} />
                  </button>
                </div>
              </div>

              <div
                className="canvas-stage"
                id="canvas-stage"
                ref={canvasStageRef}
                tabIndex={0}
                aria-label="Playground keyboard input"
                onPointerDown={() => canvasStageRef.current?.focus({ preventScroll: true })}
              >
                <div className="canvas-host" id="canvas-host" ref={canvasHostRef} />
                <span className="stage-corner" id="stage-caption">
                  {stageCaption}
                </span>
                <span className="stage-scale">256 × 192 LOGO UNITS</span>
              </div>

              <div className="canvas-footer">
                <span id="turtle-position">{turtleInfo}</span>
                <span className="live">
                  <i className="dot" />
                  <span id="render-status">Smooth vector graphics</span>
                </span>
              </div>
            </section>

            {/* Console Panel */}
            <section className="panel console-panel" aria-label="Interactive command console">
              <div className="panel-toolbar">
                <h2 className="panel-title">
                  <Icon name="terminal" size={14} />
                  Command line
                </h2>
                <button
                  className="button quiet"
                  id="clear-console"
                  onClick={() => {
                    if (consoleLogRef.current) consoleLogRef.current.replaceChildren();
                    interpreterRef.current?.clearOutput();
                  }}
                >
                  Clear
                </button>
              </div>

              <div
                className="console-log"
                id="console-log"
                ref={consoleLogRef}
                role="log"
                aria-label="Logo output"
                aria-live="polite"
              />

              <form
                className="console-form"
                id="console-form"
                onSubmit={e => {
                  e.preventDefault();
                  const cmd = consoleInput.trim();
                  if (!cmd || busy) return;
                  const newHist = [...commandHistory, cmd];
                  setCommandHistory(newHist);
                  historyIndexRef.current = newHist.length;
                  historyDraftRef.current = '';
                  setConsoleInput('');
                  logToConsole(cmd, 'command');
                  withTask(() => executeCode(cmd, ''));
                }}
              >
                <span className="prompt" aria-hidden="true">›</span>
                <input
                  id="command"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={busy ? 'The playground is receiving keyboard input…' : 'Try REPEAT 4 [FD 40 RT 90]'}
                  disabled={busy}
                  value={consoleInput}
                  onChange={e => setConsoleInput(e.target.value)}
                  onKeyDown={e => {
                    if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
                      e.preventDefault();
                      if (historyIndexRef.current === commandHistory.length) {
                        historyDraftRef.current = consoleInput;
                      }
                      const nextIdx = Math.min(
                        commandHistory.length,
                        Math.max(0, historyIndexRef.current + (e.key === 'ArrowUp' ? -1 : 1))
                      );
                      historyIndexRef.current = nextIdx;
                      setConsoleInput(
                        nextIdx === commandHistory.length ? historyDraftRef.current : commandHistory[nextIdx]
                      );
                    }
                  }}
                />
                <button type="submit" id="send-command" aria-label="Run command" disabled={busy}>
                  <Icon name="arrow" size={17} />
                </button>
              </form>
            </section>
          </div>

          {/* Right Column: Code & Workspace Editor */}
          <section className="panel editor-panel" aria-label="Logo source editor">
            <div className="panel-toolbar">
              <div className="editor-tabs" role="tablist">
                <button
                  className={`editor-tab ${activeTab === 'code' ? 'active' : ''}`}
                  role="tab"
                  aria-selected={activeTab === 'code'}
                  id="code-tab"
                  onClick={() => setActiveTab('code')}
                >
                  <Icon name="code" size={13} /> Code
                </button>
                <button
                  className={`editor-tab ${activeTab === 'workspace' ? 'active' : ''}`}
                  role="tab"
                  aria-selected={activeTab === 'workspace'}
                  id="workspace-tab"
                  onClick={() => {
                    setActiveTab('workspace');
                    refreshWorkspaceData();
                  }}
                >
                  Workspace {workspaceProcedures.length > 0 && `(${workspaceProcedures.length})`}
                </button>
              </div>
              <button
                className="button icon quiet"
                id="new"
                title="Start a new workspace"
                aria-label="New workspace"
                disabled={busy}
                onClick={handleNewWorkspace}
              >
                <Icon name="reset" size={14} />
              </button>
            </div>

            <div className="file-label">
              <i className="file-dot" />
              <span id="filename">{slug(title)}.logo</span>
            </div>

            {/* Code View Tab */}
            <div
              className="editor-wrap"
              id="code-view"
              role="tabpanel"
              style={{ display: activeTab === 'code' ? 'flex' : 'none' }}
            >
              <div className="line-numbers" id="line-numbers" ref={lineNumbersRef} aria-hidden="true" />
              <div className="code-area">
                <pre className="code-highlight" id="code-highlight" ref={codeHighlightRef} aria-hidden="true" />
                <textarea
                  id="editor"
                  ref={editorRef}
                  aria-label="Logo source code"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  wrap="off"
                  value={editorValue}
                  onChange={e => {
                    const next = e.target.value;
                    setEditorValue(next);
                    syncCodeHighlight(next);
                    saveToLocal(next);
                  }}
                  onScroll={() => {
                    if (editorRef.current && codeHighlightRef.current && lineNumbersRef.current) {
                      codeHighlightRef.current.scrollTop = editorRef.current.scrollTop;
                      codeHighlightRef.current.scrollLeft = editorRef.current.scrollLeft;
                      lineNumbersRef.current.scrollTop = editorRef.current.scrollTop;
                    }
                  }}
                  onClick={updateCursorPosition}
                  onKeyUp={updateCursorPosition}
                  onKeyDown={e => {
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const el = editorRef.current;
                      if (!el) return;
                      const start = el.selectionStart;
                      const end = el.selectionEnd;
                      const updated = el.value.substring(0, start) + '  ' + el.value.substring(end);
                      setEditorValue(updated);
                      syncCodeHighlight(updated);
                      saveToLocal(updated);
                      setTimeout(() => {
                        el.selectionStart = el.selectionEnd = start + 2;
                      }, 0);
                    }
                  }}
                />
              </div>
            </div>

            {/* Workspace View Tab */}
            <div
              className="workspace-view"
              id="workspace-view"
              role="tabpanel"
              style={{ display: activeTab === 'workspace' ? 'block' : 'none' }}
            >
              <h3>Procedures · {workspaceProcedures.length}</h3>
              {workspaceProcedures.length > 0 ? (
                workspaceProcedures.map(([procName, proc]) => (
                  <button
                    key={procName}
                    className="procedure-chip"
                    title="Add procedure to the command line"
                    onClick={() => {
                      setConsoleInput(procName);
                    }}
                  >
                    {procName}
                    {proc.parameters.length > 0 && ' ' + proc.parameters.map((p: string) => ':' + p).join(' ')}
                  </button>
                ))
              ) : (
                <p className="empty">Define a procedure with TO…END. It will appear here after you run the code.</p>
              )}

              <h3 style={{ marginTop: 22 }}>Your variables · {workspaceVariables.length}</h3>
              {workspaceVariables.length > 0 ? (
                workspaceVariables.map(([vName, vVal]) => (
                  <div key={vName} className="variable-row">
                    <span>:{vName}</span>
                    <span>{escapeHTML(logoRepr(vVal))}</span>
                  </div>
                ))
              ) : (
                <p className="empty">Use MAKE to store a number, word, or list.</p>
              )}

              <h3 style={{ marginTop: 22 }}>Sprites</h3>
              <p className="empty">
                {visibleSpriteCount} visible of 32 · {isFrozen ? 'motion paused' : 'motion active'}
              </p>
            </div>

            <div className="editor-bottom">
              <span className="keyboard-hint">
                <kbd>Ctrl</kbd>
                <span>+</span>
                <kbd>Enter</kbd>
                <span>to run</span>
              </span>
              <div className="panel-actions">
                <button
                  className="button quiet"
                  id="stop"
                  disabled={!busy}
                  title="Stop execution (Escape)"
                  onClick={stopRunning}
                >
                  <Icon name="stop" size={13} />
                  Stop
                </button>
                <button
                  className="run-button"
                  id="run"
                  disabled={busy}
                  onClick={() => withTask(() => executeCode(editorValue))}
                >
                  <Icon name="play" size={14} />
                  Run code
                </button>
              </div>
            </div>

            <div className="editor-status">
              <span id="editor-cursor">{cursorPos}</span>
              <span id="execution-status">{executionStatus}</span>
            </div>
          </section>
        </div>

        <div className="help-strip">
          <Icon name="leaf" size={20} />
          <p>
            <strong>The turtle follows your lead.</strong> <span>{tip}</span>
          </p>
          <button id="help-strip" onClick={onOpenHelpModal}>
            Explore the guide <Icon name="arrow" size={14} />
          </button>
        </div>

        <footer className="studio-footer">
          <span className="footer-left">
            <i className="dot" />
            Runs in your browser · Workspaces stay on your device
          </span>
          <span className="logo-origin">Inspired by TI Logo, 1981 &nbsp; ↗</span>
        </footer>
      </main>

      {/* Dialog: Pocket Guide */}
      <dialog id="help-dialog" ref={helpDialogRef}>
        <div className="dialog-heading">
          <h2>A pocket guide to Logo</h2>
          <button
            className="button icon quiet"
            onClick={() => {
              helpDialogRef.current?.close();
              onCloseHelpModal();
            }}
            aria-label="Close guide"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="help-intro">
          Logo is a language for exploring ideas. Give the turtle a few instructions, then make them your own. Commands are case insensitive. The center is (0, 0); north is 0°.
        </p>
        <div className="help-grid">
          <div className="help-card">
            <h3>01 / Draw a shape</h3>
            <code>{`CS SC 3\nREPEAT 4 [FD 50 RT 90]`}</code>
            <p>CS clears and homes. FD moves; RT turns. PU lifts the pen, PD lowers it.</p>
          </div>
          <div className="help-card">
            <h3>02 / Name an idea</h3>
            <code>{`TO SQUARE :SIZE\n  REPEAT 4 [FD :SIZE RT 90]\nEND\nSQUARE 50`}</code>
            <p>TO…END defines a procedure. Inputs begin with a colon.</p>
          </div>
          <div className="help-card">
            <h3>03 / Make it move</h3>
            <code>{`TELL 2 CARRY :BALL\nSC 9 SH 90 SS 18\nFREEZE\nTHAW`}</code>
            <p>TELL selects a sprite. SS controls its speed. Shapes: PLANE, TRUCK, ROCKET, BALL, BOX.</p>
          </div>
          <div className="help-card">
            <h3>04 / Play with values</h3>
            <code>{`MAKE "SIZE 30\nPRINT :SIZE * 2\nPRINT FIRST [HELLO WORLD]\nIF :SIZE > 20 [FD :SIZE]`}</code>
            <p>MAKE stores a value; : reads it. Lists live in brackets. Try REPEAT, IF, TEST, OUTPUT, and recursion.</p>
          </div>
        </div>
        <p className="dialog-footer">
          <strong>Run:</strong> Ctrl/⌘ + Enter. <strong>Stop:</strong> Escape. <strong>Console history:</strong> ↑ / ↓. <strong>Save:</strong> Ctrl/⌘ + S.<br />
          Historical samplers accept keys while running. Arrow keys move shapes; Q exits keyboard activities. Use Stop for continuous animations. Saving downloads a complete JSON workspace; Export offers pictures and Logo text.
        </p>
      </dialog>

      {/* Dialog: 1981 Collection */}
      <dialog id="library-dialog" ref={libraryDialogRef}>
        <div className="dialog-heading">
          <h2>The 1981 collection</h2>
          <button
            className="button icon quiet"
            onClick={() => libraryDialogRef.current?.close()}
            aria-label="Close collection"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="help-intro">Ten original sampler workspaces, ready to explore.</p>
        <div className="sampler-list">
          {SAMPLERS.map((item: any) => (
            <button
              key={item.id}
              className="sampler"
              onClick={() => chooseSampler(item.id)}
            >
              {item.title} <Icon name="arrow" size={13} />
            </button>
          ))}
        </div>
      </dialog>

      {/* Dialog: Sprite Shape Editor */}
      <dialog id="shape-dialog" ref={shapeDialogRef}>
        <div className="dialog-heading">
          <h2 id="shape-title">Edit sprite shape {shapeId}</h2>
          <button
            className="button icon quiet"
            onClick={() => shapeDialogRef.current?.close()}
            aria-label="Close shape editor"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="help-intro">
          Click cells to design the shape. The playground renders a smooth outline of your design.
        </p>
        <div className="shape-grid" id="shape-grid">
          {shapeBits.map((on, idx) => (
            <button
              key={idx}
              className="shape-cell"
              aria-pressed={on}
              onClick={() => {
                const next = [...shapeBits];
                next[idx] = !next[idx];
                setShapeBits(next);
              }}
            />
          ))}
        </div>
        <div className="shape-controls">
          <button
            className="button"
            id="shape-clear"
            onClick={() => setShapeBits(new Array(256).fill(false))}
          >
            Clear
          </button>
          <button className="button primary" id="shape-apply" onClick={applyShapeEdit}>
            Apply shape
          </button>
        </div>
      </dialog>
    </div>
  );
};
