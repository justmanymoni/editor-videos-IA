'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from './store';

interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  timer: ReturnType<typeof setInterval>;
}

/** Microphone recording with the browser's MediaRecorder. `stop()` resolves with the audio. */
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const session = useRef<Session | null>(null);

  const release = useCallback(() => {
    const s = session.current;
    if (!s) return;
    clearInterval(s.timer);
    s.stream.getTracks().forEach((t) => t.stop());
    session.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    if (session.current) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.start();
      const began = Date.now();
      setSeconds(0);
      session.current = { recorder, stream, chunks, timer: setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 250) };
      setRecording(true);
      return true;
    } catch {
      useEditor.getState().toast('No se pudo usar el micrófono. Permite el acceso en el navegador y vuelve a intentarlo.', 'error');
      return false;
    }
  }, []);

  const stop = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const s = session.current;
        if (!s) return resolve(null);
        s.recorder.onstop = () => {
          const blob = new Blob(s.chunks, { type: s.recorder.mimeType || 'audio/webm' });
          release();
          resolve(blob.size ? blob : null);
        };
        s.recorder.stop();
      }),
    [release],
  );

  useEffect(() => release, [release]);

  return { recording, seconds, start, stop };
}
