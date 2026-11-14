/** Speech-recognition models the app can download for offline transcription. */
export interface WhisperModelOption {
  id: string;
  label: string;
  /** Approximate download size. */
  sizeMB: number;
  description: string;
}

export const WHISPER_MODELS: WhisperModelOption[] = [
  { id: 'large-v3-turbo-q5_0', label: 'Preciso', sizeMB: 550, description: 'La mejor calidad en español. Recomendado.' },
  { id: 'small', label: 'Rápido', sizeMB: 470, description: 'Transcribe bastante más deprisa, con algo menos de precisión.' },
  { id: 'base', label: 'Ligero', sizeMB: 145, description: 'Para ordenadores modestos. Comete más errores.' },
];

export const DEFAULT_WHISPER_MODEL = WHISPER_MODELS[0].id;

/** Quality order used when several models are installed. */
export const WHISPER_MODEL_RANK = ['large-v3-turbo', 'large-v3', 'large', 'medium', 'small', 'base', 'tiny'];
