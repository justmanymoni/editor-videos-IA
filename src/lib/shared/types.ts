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

export interface SeparationState {
  status: 'none' | 'queued' | 'running' | 'done' | 'error';
  progress: number;
  message: string | null;
  error: string | null;
}

export const NO_SEPARATION: SeparationState = { status: 'none', progress: 0, message: null, error: null };

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
  /** Images with transparency (stickers, logos). */
  hasAlpha?: boolean;
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
  /** Voice / music separation of the clip's audio. */
  separation: SeparationState;
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
  /** Playback speed (1 = normal, 2 = twice as fast). The pitch of the voice is kept. */
  speed?: number;
}

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
/** Speed of a clip, within the supported range. */
export const clipSpeed = (clip: Pick<MainClip, 'speed'>) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, clip.speed || 1));

/** B-roll overlay placed on the timeline. */
export interface BrollItem {
  id: string;
  mediaId: string;
  /** Timeline position. */
  start: number;
  duration: number;
  /** Offset inside the source (videos only). */
  srcIn: number;
  /** Centre of the overlay as a fraction of the frame (default 0.5, 0.5). */
  x?: number;
  y?: number;
  /** 1 = covers the whole frame; smaller values make a sticker / picture-in-picture. */
  scale?: number;
}

/** Text typed by the user and placed freely on the frame. */
/** Entrance / exit animations of a manual text. As an exit, a slide leaves in that direction. */
export type TextAnimation = 'none' | 'fade' | 'zoom' | 'zoom-out' | 'pop' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down';

export interface TextItem {
  id: string;
  text: string;
  start: number;
  duration: number;
  /** Centre as a fraction of the frame. */
  x: number;
  y: number;
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  fontId: string;
  /** Pixels in the 1080x1920 frame, before `scale`. */
  fontSize: number;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  /** Extra space between characters, in frame pixels (can be negative). */
  letterSpacing: number;
  /** Shadow: see `Shadow`. `shadow` is its distance in frame pixels. */
  shadowOn: boolean;
  shadow: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowBlur: number;
  shadowAngle: number;
  /** Row of the timeline it sits on: higher rows are drawn on top. */
  lane?: number;
  /** none = straight lines, arc = along a circle, wave = along a sine wave. */
  curve: 'none' | 'arc' | 'wave';
  /**
   * arc: percentage of a full circle the text covers (50 = semicircle,
   * 100 = circle); negative values bend downwards. wave: height, -100..100.
   */
  curveAmount: number;
  /** Box behind straight text: its colour, or '' for none. */
  bgColor: string;
  /** Corners of the box: 0 = square … 1 = pill. */
  bgRadius: number;
  /** Space between the text and the edge of the box, as a fraction of the font size. */
  bgPadding: number;
  animIn: TextAnimation;
  animOut: TextAnimation;
}

/** The soft shadow new texts and subtitles start with (they have no outline). */
export const DEFAULT_SHADOW = { shadowOn: true, shadow: 6, shadowColor: '#000000', shadowOpacity: 0.7, shadowBlur: 8, shadowAngle: -45 } as const;

/**
 * Where a shadow falls. `angle` is in degrees, counter-clockwise from the
 * right as in CapCut: −45 puts it below and to the right of the text.
 */
export function shadowOffset(distance: number, angle: number): { dx: number; dy: number } {
  const rad = (angle * Math.PI) / 180;
  // "|| 0" turns −0 into 0.
  return { dx: Math.round(distance * Math.cos(rad) * 100) / 100 || 0, dy: Math.round(-distance * Math.sin(rad) * 100) / 100 || 0 };
}

/**
 * Shadow settings of a text or subtitle style saved before shadows could be
 * adjusted: a hard black shadow at 50 %, `shadow` pixels down and right.
 */
function legacyShadow(raw: { shadowOn?: boolean; shadow?: number }) {
  if (raw.shadowOn !== undefined) return {};
  const offset = raw.shadow ?? 0;
  return {
    shadowOn: offset > 0,
    shadow: Math.round(offset * Math.SQRT2 * 10) / 10,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowBlur: 0,
    shadowAngle: -45,
  };
}

export const DEFAULT_TEXT: Omit<TextItem, 'id' | 'start' | 'duration'> = {
  text: 'Tu texto',
  x: 0.5,
  y: 0.4,
  scale: 1,
  rotation: 0,
  fontId: 'montserrat-bold',
  fontSize: 96,
  color: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 0,
  letterSpacing: 0,
  ...DEFAULT_SHADOW,
  curve: 'none',
  curveAmount: 50,
  bgColor: '',
  bgRadius: 0.3,
  bgPadding: 0.3,
  animIn: 'none',
  animOut: 'none',
};

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

/** How a subtitle block appears. */
export type SubtitleAnimation =
  'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom' | 'pop' | 'blur' | 'rotate' | 'typewriter' | 'drop';

export type TextCase = 'none' | 'upper' | 'lower' | 'title';

export interface SubtitleStyle {
  enabled: boolean;
  fontId: string;
  /** CSS pixel size measured in the 1080x1920 output frame. */
  fontSize: number;
  textColor: string;
  highlightColor: string;
  outlineColor: string;
  /** Stroke around the letters, in frame pixels; 0 = none. */
  outlineWidth: number;
  /** Extra space between characters, in frame pixels (can be negative). */
  letterSpacing: number;
  underline: boolean;
  /** Shadow: on / off, distance in frame pixels (`shadow`), colour, opacity 0..1, blur in pixels and direction (see shadowOffset). */
  shadowOn: boolean;
  shadow: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowBlur: number;
  shadowAngle: number;
  /** Centre of the subtitle block, 0..100 % of the frame width and height. */
  positionX: number;
  positionY: number;
  /** Colour the word being spoken with `highlightColor`. */
  highlight: boolean;
  /** Instead of colouring the word, put it in a box of `highlightColor` with the text in `boxTextColor`. */
  highlightBox: boolean;
  boxTextColor: string;
  /** Words that have not been said yet are shown faded. */
  dimUpcoming: boolean;
  /** Animation when a block appears, and whether it fades away at the end. */
  animationIn: SubtitleAnimation;
  animationOut: 'none' | 'fade';
  /** As written, ALL CAPITALS, all lower case or Capitalised Words. */
  textCase: TextCase;
  stripPunctuation: boolean;
  wordsPerPage: number;
  maxCharsPerLine: number;
  /** Scale applied to the active word (1 = none). */
  activeScale: number;
}

/** Volumes of the separated voice and music of a clip (1 = original level). */
export interface AudioMix {
  voice: number;
  music: number;
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
  /** Manual texts placed on the frame. */
  texts: TextItem[];
  subtitles: SubtitleStyle;
  /** Keyed by `${mediaId}:${wordId}`. */
  words: Record<string, WordOverride>;
  /** Written script pasted by the user (used to correct the subtitles). */
  script: string;
  /** Per media id: play the separated voice and music at these volumes instead of the original audio. */
  audioMix: Record<string, AudioMix>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  clipCount: number;
  /** Media whose thumbnail represents the project: its first clip. */
  thumbMediaId: string | null;
  /** Folder of the home screen it was put in, if any. */
  folderId: string | null;
}

/** A folder of projects on the home screen. */
export interface Folder {
  id: string;
  name: string;
  createdAt: string;
}

/** General settings of the app: what new projects start with, and how it exports. */
export interface AppSettings {
  /** Language new clips are transcribed in ("auto" = detect). */
  language: string;
  /** Remove silences automatically from the clips of new projects. */
  autoSilence: boolean;
  /** Shortest silence that is removed, in seconds. */
  silenceMin: number;
  /** How horizontal clips fill the vertical frame in new projects. */
  fitMode: FitMode;
  /** Quick style (see subtitle-presets) the subtitles of new projects start with. */
  subtitlePreset: string;
  /** New projects show the automatic subtitles from the start (they can always be added with G). */
  autoSubtitles: boolean;
  /** Quality selected when the export dialog opens. */
  exportQuality: 'fast' | 'normal' | 'high';
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  language: 'es',
  autoSilence: true,
  silenceMin: 1,
  fitMode: 'cover',
  subtitlePreset: 'montserrat',
  autoSubtitles: true,
  exportQuality: 'normal',
};

export type JobType = 'ingest' | 'transcribe' | 'export' | 'setup' | 'separate' | 'mix';
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
  /** A job (export, transcription…) is queued or running. */
  busy: boolean;
  /** Installed version of the app, when it runs from a git checkout. */
  version: AppVersion | null;
}

export interface AppVersion {
  commit: string;
  /** ISO date of the last change. */
  date: string;
}

export const DEFAULT_FILLERS = ['eh', 'ehm', 'em', 'mm', 'hmm', 'uh', 'um', 'o sea'];

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  enabled: true,
  // Montserrat without outline, with a soft shadow so it reads on any video.
  fontId: 'montserrat-bold',
  fontSize: 86,
  textColor: '#FFFFFF',
  highlightColor: '#FFE600',
  outlineColor: '#000000',
  outlineWidth: 0,
  letterSpacing: 0,
  underline: false,
  ...DEFAULT_SHADOW,
  positionX: 50,
  positionY: 72,
  highlight: true,
  highlightBox: false,
  boxTextColor: '#111111',
  dimUpcoming: false,
  animationIn: 'none',
  animationOut: 'none',
  textCase: 'upper',
  stripPunctuation: true,
  wordsPerPage: 3,
  maxCharsPerLine: 16,
  activeScale: 1,
};

export const DEFAULT_SETTINGS: ProjectSettings = {
  language: 'es',
  fitMode: 'cover',
  silenceMin: 1,
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
    texts: [],
    subtitles: { ...DEFAULT_SUBTITLE_STYLE },
    words: {},
    script: '',
    audioMix: {},
  };
}

/** Completes a subtitle style, reading the fields of older versions (`uppercase`, the fixed hard shadow). */
export function normalizeSubtitleStyle(raw: (Partial<SubtitleStyle> & { uppercase?: boolean }) | undefined): SubtitleStyle {
  if (!raw) return { ...DEFAULT_SUBTITLE_STYLE };
  const { uppercase, ...rest } = raw;
  const textCase: TextCase = rest.textCase ?? (uppercase === undefined ? DEFAULT_SUBTITLE_STYLE.textCase : uppercase ? 'upper' : 'none');
  return { ...DEFAULT_SUBTITLE_STYLE, ...rest, ...legacyShadow(rest), textCase };
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
    texts: (raw.texts ?? []).map((t) => ({ ...DEFAULT_TEXT, ...t, ...legacyShadow(t) })),
    subtitles: normalizeSubtitleStyle(raw.subtitles),
    words: raw.words ?? {},
    script: raw.script ?? '',
    audioMix: raw.audioMix ?? {},
  };
}

export const wordKey = (mediaId: string, wordId: string) => `${mediaId}:${wordId}`;
