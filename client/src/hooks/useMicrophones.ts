import { useState, useEffect, useCallback } from 'react';
import { AudioDevice } from '../types';

export function useMicrophones() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const enumerate = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      setError('MediaDevices API не поддерживается в этом браузере');
      return;
    }

    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      
      // If browser provided real non-empty device labels, microphone permission is officially granted!
      const hasRealLabels = allDevices.some(
        (d) => d.kind === 'audioinput' && Boolean(d.label && d.label.trim().length > 0)
      );

      const audioInputs = allDevices
        .filter((d) => d.kind === 'audioinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: hasRealLabels ? (d.label || `Микрофон ${index + 1}`) : '',
          groupId: d.groupId,
        }));

      setDevices(audioInputs);
      setHasPermission(hasRealLabels);

      // If no mic selected or selected not in list, pick the first or default
      if (audioInputs.length > 0) {
        setSelectedDeviceId((prev) => {
          const exists = audioInputs.some((d) => d.deviceId === prev);
          return exists && prev ? prev : audioInputs[0].deviceId;
        });
      }
    } catch (err: any) {
      console.error('Error enumerating audio devices:', err);
      setError(err?.message || 'Ошибка получения микрофонов');
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('getUserMedia не поддерживается');
      return false;
    }

    try {
      setError(null);
      // Request audio stream to trigger native permission prompt
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((track) => track.stop());
      setHasPermission(true);
      await enumerate();
      return true;
    } catch (err: any) {
      console.warn('Microphone permission denied or error:', err);
      setError('Доступ к микрофону отклонен или недоступен');
      setHasPermission(false);
      return false;
    }
  }, [enumerate]);

  useEffect(() => {
    // 1. Check permission state via Permissions API if available
    let permStatus: PermissionStatus | null = null;
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: 'microphone' as any })
        .then((status) => {
          permStatus = status;
          if (status.state === 'granted') {
            setHasPermission(true);
            enumerate();
          } else if (status.state === 'denied') {
            setHasPermission(false);
          }
          status.onchange = () => {
            if (status.state === 'granted') {
              setHasPermission(true);
              enumerate();
            } else if (status.state === 'denied') {
              setHasPermission(false);
            }
          };
        })
        .catch(() => {
          // Permissions API for microphone is not supported in some mobile webviews
        });
    }

    // 2. Initial check
    enumerate();

    // 3. Auto-check on window focus / visibility change (e.g. user allowed mic in settings and returned)
    const handleRecheck = () => {
      enumerate();
    };
    window.addEventListener('focus', handleRecheck);
    document.addEventListener('visibilitychange', handleRecheck);

    // 4. Subtle periodic check (every 2s) to automatically detect granted permissions
    const interval = setInterval(() => {
      enumerate();
    }, 2000);

    // 5. Listen for hardware connect / disconnect
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', enumerate);
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleRecheck);
      document.removeEventListener('visibilitychange', handleRecheck);
      if (permStatus) {
        permStatus.onchange = null;
      }
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', enumerate);
      }
    };
  }, [enumerate]);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    hasPermission,
    setHasPermission,
    requestPermission,
    refreshDevices: enumerate,
    error,
  };
}
