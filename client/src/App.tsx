import { useState, useEffect, useCallback, useRef } from 'react';
import { Script, ScriptSettings } from './types';
import {
  getScripts,
  createScript,
  updateScript,
  deleteScript,
  getConfig,
  syncTelegramUser,
} from './api';
import { ScriptList } from './components/ScriptList';
import { ScriptEditor } from './components/ScriptEditor';
import { PrompterView } from './components/PrompterView';
import { useMicrophones } from './hooks/useMicrophones';
import { useTelegram } from './hooks/useTelegram';

type AppView = 'list' | 'edit' | 'prompter';

export function App() {
  const [view, setView] = useState<AppView>('list');
  const [scripts, setScripts] = useState<Script[]>([]);
  const [activeScript, setActiveScript] = useState<Script | null>(null);
  const [editingScript, setEditingScript] = useState<Script | null>(null);
  const [hasDeepgram, setHasDeepgram] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    hasPermission: hasMicPermission,
    setHasPermission: setHasMicPermission,
    requestPermission: requestMicPermission,
    refreshDevices,
  } = useMicrophones();

  const { setBackButton } = useTelegram();

  // Sync Telegram user if opened inside TMA
  useEffect(() => {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser) {
      syncTelegramUser(tgUser);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [scriptsData, configData] = await Promise.all([
        getScripts(),
        getConfig().catch(() => ({ hasDeepgram: false, version: '1.2.0' })),
      ]);
      setScripts(scriptsData);
      setHasDeepgram(configData.hasDeepgram);
    } catch (err) {
      console.error('Failed to load initial data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync Telegram WebApp BackButton with current view
  useEffect(() => {
    if (view === 'prompter') {
      setBackButton(true, () => setView('list'));
    } else if (view === 'edit') {
      setBackButton(true, () => setView('list'));
    } else {
      setBackButton(false);
    }
  }, [view, setBackButton]);

  // Actions
  const handleSelectScript = (script: Script) => {
    setActiveScript(script);
    setView('prompter');
  };

  const handleEditScript = (script: Script) => {
    setEditingScript(script);
    setView('edit');
  };

  const handleCreateNew = () => {
    setEditingScript(null);
    setView('edit');
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteScript(id);
      setScripts((prev) => prev.filter((s) => s.id !== id));
      if (activeScript?.id === id) setActiveScript(null);
    } catch (err) {
      console.error('Failed to delete script:', err);
    }
  };

  const handleSaveScript = async (data: {
    title: string;
    content: string;
    settings?: Partial<ScriptSettings>;
  }) => {
    if (editingScript) {
      const updated = await updateScript(editingScript.id, data);
      setScripts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setActiveScript(updated);
    } else {
      const created = await createScript(data);
      setScripts((prev) => [created, ...prev]);
      setActiveScript(created);
    }
  };

  const settingsDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleUpdateActiveSettings = useCallback((newSettings: Partial<ScriptSettings>) => {
    setActiveScript((prevActive) => {
      if (!prevActive) return null;
      const mergedSettings = { ...prevActive.settings, ...newSettings };
      const updated = { ...prevActive, settings: mergedSettings };

      setScripts((prevScripts) => prevScripts.map((s) => (s.id === updated.id ? updated : s)));

      // Debounced backend persist (400ms) to avoid HTTP flooding during slider drags
      if (settingsDebounceTimerRef.current) {
        clearTimeout(settingsDebounceTimerRef.current);
      }
      settingsDebounceTimerRef.current = setTimeout(async () => {
        try {
          await updateScript(updated.id, { settings: mergedSettings });
        } catch (e) {
          // ignore background save error
        }
      }, 400);

      return updated;
    });
  }, []);

  if (loading && scripts.length === 0) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center text-xs tracking-widest uppercase">
        Загрузка...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-foreground">
      {view === 'list' && (
        <ScriptList
          scripts={scripts}
          onSelectScript={handleSelectScript}
          onEditScript={handleEditScript}
          onCreateScript={handleCreateNew}
          onDeleteScript={handleDelete}
        />
      )}

      {view === 'edit' && (
        <ScriptEditor
          initialScript={editingScript}
          onSave={handleSaveScript}
          onCancel={() => setView('list')}
        />
      )}

      {view === 'prompter' && activeScript && (
        <PrompterView
          script={activeScript}
          onUpdateScriptSettings={handleUpdateActiveSettings}
          onExit={() => setView('list')}
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelectDevice={setSelectedDeviceId}
          hasMicPermission={hasMicPermission}
          onRequestMicPermission={requestMicPermission}
          onPermissionGranted={() => {
            setHasMicPermission(true);
            refreshDevices();
          }}
          hasDeepgram={hasDeepgram}
        />
      )}
    </div>
  );
}

export default App;
