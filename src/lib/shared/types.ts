/**
 * Types shared by the browser editor and the Node.js server.
 * Every time value is expressed in seconds.
 */

export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;
export const OUTPUT_FPS = 30;

export type MediaKind = 'video' | 'image' | 'audio';
/** clip = main footage, broll = overlay resource, music = audio resource. */
export type MediaRole = 'clip' | 'broll' | 'music';
export type MediaStatus = 'processing' | 'ready' | 'error';
export type TranscriptStatus = 'none' | 'queued' | 'running' | 'done' | 'error';

export interface TranscriptState {
  status: TranscriptStatus;
  progress: number;
  error: string | null;
  provider: string | null;
  language: string | null;
}

export interface MediaInfo {
  id: string;
  name: string;
  role: MediaRole;
  kind: MediaKind;
  /** True when the file lives in the resources folder instead of storage/. */
  external: boolean;
  size: number;
  createdAt: string;
  /** 0 for still images. */
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  hasProxy: boolean;
  hasThumb: boolean;
  hasEnvelope: boolean;
  status: MediaStatus;
  /** Human readable stage of the current background job. */
  stage: string | null;
  progress: number;
  error: string | null;
  transcript: TranscriptState;
}

export interface Word {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface Transcript {
  mediaId: string;
  language: string;
  provider: string;
  createdAt: string;
  words: Word[];
}

/**
 * Loudness envelope: one value per 1/rate seconds, stored as dBFS + 100
 * clamped to 0..100 (0 = digital silence, 100 = full scale).
 */
export interface Envelope {
  rate: number;
  values: Uint8Array;
}

export interface Range {
  start: number;
  end: number;
}

export type CutReason = 'manual' | 'silence' | 'filler' | 'retake';

export interface Cut extends Range {
  reason: CutReason;
}

/** One instance of a source clip on the main track. Cuts are in source time. */
export interface MainClip {
  id: string;
  mediaId: string;
  start: number;
  end: number;
  cuts: Cut[];
  /** Silences are removed automatically once its audio and transcript are ready. */
  autoClean?: boolean;
}

/** B-roll overlay placed on the timeline. */
export interface BrollItem {
  id: string;
  mediaId: string;
  /** Timeline position. */
  start: number;
  duration: number;
  /** Offset inside the source (videos only). */
  srcIn: number;
}

export interface AudioItem {
  id: string;
  mediaId: string;
  start: number;
  duration: number;
  srcIn: number;
  /** 0..2 (1 = original level). */
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface SubtitleStyle {
  enabled: boolean;
  fontId: string;
  /** CSS pixel size measured in the 1080x1920 output frame. */
  fontSize: number;
  textColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadow: number;
  /** Vertical centre of the subtitle block, 0..100 % of the frame height. */
  positionY: number;
  uppercase: boolean;
  stripPunctuation: boolean;
  wordsPerPage: number;
  maxCharsPerLine: number;
  /** Scale applied to the active word (1 = none). */
  activeScale: number;
}

export interface WordOverride {
  text?: string;
  /** Hide from subtitles without cutting the video. */
  hidden?: boolean;
  /** Force a new subtitle page to start at this word. */
  breakBefore?: boolean;
}

export type FitMode = 'cover' | 'blur';

export interface ProjectSettings {
  language: string;
  fitMode: FitMode;
  /** Silences longer than this (seconds) are removed by auto-clean. */
  silenceMin: number;
  /** Breathing room kept on each side of a removed silence. */
  silencePadding: number;
  fillers: string[];
  mainVolume: number;
  /** Remove silences automatically from newly added clips. */
  autoSilence: boolean;
}

export interface ProjectDoc {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  /** Every media id the project uses (clips, b-roll and music). */
  media: string[];
  clips: MainClip[];
  broll: BrollItem[];
  audio: AudioItem[];
  subtitles: SubtitleStyle;
  /** Keyed by `${mediaId}:${wordId}`. */
  words: Record<string, WordOverride>;
  /** Written script pasted by the user (used to correct the subtitles). */
  script: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  clipCount: number;
}

export type JobType = 'ingest' | 'transcribe' | 'export' | 'setup';
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobInfo {
  id: string;
  type: JobType;
  refId: string;
  status: JobStatus;
  progress: number;
  message: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
}

/** Local (offline) transcription with whisper.cpp. */
export interface LocalTranscriberStatus {
  /** Path of the whisper.cpp executable, if found. */
  binary: string | null;
  /** File name of the ggml model in use, if any. */
  model: string | null;
  /** The app can download the engine for this system (Windows, Linux) or it is already installed. */
  canInstall: boolean;
  platform: string;
  /** Running installation job, if any. */
  setupJobId: string | null;
}

export interface ServerStatus {
  transcriber: 'openai' | 'whispercpp' | 'none';
  transcriberDetail: string;
  ffmpeg: string | null;
  ffprobe: boolean;
  resourcesDir: string;
  defaultLanguage: string;
  local: LocalTranscriberStatus;
}

export const DEFAULT_FILLERS = ['eh', 'ehm', 'em', 'mm', 'hmm', 'uh', 'um', 'o sea'];

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  enabled: true,
  fontId: 'montserrat-black',
  fontSize: 86,
  textColor: '#FFFFFF',
  highlightColor: '#FFE600',
  outlineColor: '#000000',
  outlineWidth: 6,
  shadow: 4,
  positionY: 72,
  uppercase: true,
  stripPunctuation: true,
  wordsPerPage: 3,
  maxCharsPerLine: 16,
  activeScale: 1,
};

export const DEFAULT_SETTINGS: ProjectSettings = {
  language: 'es',
  fitMode: 'cover',
  silenceMin: 0.4,
  silencePadding: 0.1,
  fillers: DEFAULT_FILLERS,
  mainVolume: 1,
  autoSilence: true,
};

export function createProjectDoc(id: string, name: string, language = 'es'): ProjectDoc {
  const now = new Date().toISOString();
  return {
    version: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS, language, fillers: [...DEFAULT_FILLERS] },
    media: [],
    clips: [],
    broll: [],
    audio: [],
    subtitles: { ...DEFAULT_SUBTITLE_STYLE },
    words: {},
    script: '',
  };
}

/** Fills in fields that older or hand-edited project files may lack. */
export function normalizeProjectDoc(raw: ProjectDoc): ProjectDoc {
  return {
    ...raw,
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    media: raw.media ?? [],
    clips: (raw.clips ?? []).map((c) => ({ ...c, cuts: c.cuts ?? [] })),
    broll: raw.broll ?? [],
    audio: raw.audio ?? [],
    subtitles: { ...DEFAULT_SUBTITLE_STYLE, ...(raw.subtitles ?? {}) },
    words: raw.words ?? {},
    script: raw.script ?? '',
  };
}

export const wordKey = (mediaId: string, wordId: string) => `${mediaId}:${wordId}`;
