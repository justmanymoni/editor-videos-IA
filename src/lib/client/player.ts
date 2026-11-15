'use client';
/**
 * Preview playback of the edited sequence.
 *
 * Every source clip gets two <video> "decks". Consecutive segments alternate
 * decks, so while one plays the next one is already seeked to its in-point:
 * jumping over a cut is just swapping visibility. B-roll and music elements
 * follow the timeline clock.
 */
import { create } from 'zustand';
import type { AudioItem, AudioMix, BrollItem } from '@/lib/shared/types';
import { clamp } from '@/lib/shared/ranges';
import { sequenceDuration, timelineToSource, type Segment } from '@/lib/shared/timeline';

export const usePlayback = create<{ time: number; playing: boolean; duration: number }>(() => ({ time: 0, playing: false, duration: 0 }));

export const deckKey = (mediaId: string, slot: number) => `${mediaId}#${slot}`;

const END_EPS = 0.012;

/** A main-track clip is shown by a <video>, or by an <img> when it is a photo. */
type Deck = HTMLVideoElement | HTMLImageElement;
const isVideo = (el: Deck | undefined): el is HTMLVideoElement => el instanceof HTMLVideoElement;

/** How the clip being shown is drawn on the frame (pixels of the 1080x1920 stage). */
export interface DeckLook {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  /** CSS filter ("Mejorar la calidad"). */
  filter: string;
}

/**
 * Sound of one main deck, routed through Web Audio so that volume changes are
 * heard at once. `plain` carries the clip's normal sound. When the deck plays
 * the "stems" preview of a clip (voice on the left channel, music on the
 * right), `voice` and `music` carry each one at its own level instead.
 */
interface DeckAudio {
  plain: GainNode;
  voice: GainNode;
  music: GainNode;
  /** Levels last asked for (the nodes glide to them in a few milliseconds). */
  target: { plain: number; voice: number; music: number };
}

class PlayerEngine {
  private segs: Segment[] = [];
  private duration = 0;
  private decks = new Map<string, Deck>();
  /** Clock of the photo being shown (photos have no playback position of their own). */
  private still = { src: 0, wall: 0, running: false };
  private overlays = new Map<string, HTMLVideoElement | HTMLImageElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private broll: BrollItem[] = [];
  private music: AudioItem[] = [];
  private mainVolume = 1;
  private sound: { ctx: AudioContext; master: GainNode; analyser: AnalyserNode } | null = null;
  private soundFailed = false;
  private routes = new WeakMap<HTMLVideoElement, DeckAudio>();
  /** Voice and music levels of the clips whose decks are playing their stems preview, by media id. */
  private stems: Record<string, AudioMix> = {};
  private cur = -1;
  private raf = 0;
  private playing = false;
  private stopAt: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private blur = false;
  /** Position, size, turn and opacity of every clip of the main track, by clip id. */
  private looks: Record<string, DeckLook> = {};

  registerDeck(key: string, el: Deck | null) {
    const prev = this.decks.get(key);
    if (prev === el) return;
    if (prev) {
      prev.removeEventListener('seeked', this.onSeeked);
      prev.removeEventListener('loadeddata', this.onSeeked);
      prev.removeEventListener('load', this.onSeeked);
      prev.removeEventListener('loadedmetadata', this.onReloaded);
    }
    if (el) {
      this.decks.set(key, el);
      if (isVideo(el)) {
        el.addEventListener('seeked', this.onSeeked);
        el.addEventListener('loadeddata', this.onSeeked);
        el.addEventListener('loadedmetadata', this.onReloaded);
        this.route(el);
        this.applyVolumes();
      } else el.addEventListener('load', this.onSeeked);
      // A deck that appears late (new clip) may be the one we should show.
      if (this.cur >= 0 && this.deckFor(this.cur) === el) queueMicrotask(() => this.seek(usePlayback.getState().time));
    } else this.decks.delete(key);
  }

  registerOverlay(id: string, el: HTMLVideoElement | HTMLImageElement | null) {
    if (el) this.overlays.set(id, el);
    else this.overlays.delete(id);
  }

  registerAudio(id: string, el: HTMLAudioElement | null) {
    if (el) this.audios.set(id, el);
    else this.audios.delete(id);
  }

  private ensureSound() {
    if (this.sound || this.soundFailed || typeof window === 'undefined') return this.sound;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio no disponible');
      const ctx = new Ctx();
      const master = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      master.connect(analyser);
      master.connect(ctx.destination);
      this.sound = { ctx, master, analyser };
    } catch {
      // Without Web Audio the decks keep their own volume (no instant voice / music mix).
      this.soundFailed = true;
    }
    return this.sound;
  }

  /** Connects a deck to the mixer, once. */
  private route(el: HTMLVideoElement) {
    if (this.routes.has(el)) return;
    const sound = this.ensureSound();
    if (!sound) return;
    try {
      const { ctx, master } = sound;
      const source = ctx.createMediaElementSource(el);
      const plain = ctx.createGain();
      const voice = ctx.createGain();
      const music = ctx.createGain();
      const split = ctx.createChannelSplitter(2);
      source.connect(plain);
      plain.connect(master);
      source.connect(split);
      split.connect(voice, 0);
      split.connect(music, 1);
      voice.connect(master);
      music.connect(master);
      voice.gain.value = 0;
      music.gain.value = 0;
      this.routes.set(el, { plain, voice, music, target: { plain: 1, voice: 0, music: 0 } });
      el.volume = 1;
    } catch {
      // This element stays on its own volume.
    }
  }

  /** Applies the main volume and the voice / music levels to every deck, right away. */
  private applyVolumes() {
    const main = clamp(this.mainVolume, 0, 1);
    for (const [key, el] of this.decks) {
      if (!isVideo(el)) continue;
      const r = this.routes.get(el);
      if (!r) {
        el.volume = main;
        continue;
      }
      const mix = this.stems[key.split('#')[0]];
      r.target = { plain: mix ? 0 : main, voice: mix ? mix.voice * main : 0, music: mix ? mix.music * main : 0 };
      const now = this.sound?.ctx.currentTime ?? 0;
      for (const name of ['plain', 'voice', 'music'] as const) {
        try {
          r[name].gain.setTargetAtTime(r.target[name], now, 0.012);
        } catch {
          r[name].gain.value = r.target[name];
        }
      }
    }
  }

  /**
   * Clips whose decks are playing their stems preview, with the voice and
   * music levels chosen for each. Changes are heard immediately.
   */
  setStems(stems: Record<string, AudioMix>) {
    this.stems = stems;
    this.applyVolumes();
  }

  /** Loudness of what is being played right now, 0..1 (−1 without Web Audio). For checks and meters. */
  outputLevel(): number {
    if (!this.sound) return -1;
    const data = new Float32Array(this.sound.analyser.fftSize);
    this.sound.analyser.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
  }

  /** How the sound of the deck on screen is being mixed (for checks). */
  soundState() {
    const el = this.deckFor(this.cur);
    const r = isVideo(el) ? this.routes.get(el) : undefined;
    return { routed: !!r, context: this.sound?.ctx.state ?? 'none', elementVolume: isVideo(el) ? el.volume : null, ...(r?.target ?? {}) };
  }

  setBlurCanvas(el: HTMLCanvasElement | null, enabled: boolean) {
    this.canvas = el;
    this.blur = enabled && !!el;
    this.drawBlur();
  }

  /** The clips' picture settings ("Vídeo" tab). The one on screen is redrawn at once. */
  setLooks(looks: Record<string, DeckLook>) {
    this.looks = looks;
    this.applyLook();
  }

  /** Draws the deck on screen where its clip is placed, with its size, turn and opacity. */
  private applyLook() {
    const el = this.deckFor(this.cur);
    if (!el) return;
    const look = this.looks[this.segs[this.cur]?.clipId ?? ''];
    if (!look) {
      el.style.opacity = '1';
      return;
    }
    const s = el.style;
    s.left = `${look.left}px`;
    s.top = `${look.top}px`;
    s.width = `${look.width}px`;
    s.height = `${look.height}px`;
    s.objectFit = 'fill';
    s.transform = look.rotation ? `rotate(${look.rotation}deg)` : '';
    s.filter = look.filter;
    s.opacity = String(look.opacity);
  }

  setTimeline(segs: Segment[], broll: BrollItem[], music: AudioItem[], mainVolume: number) {
    const changed = segs !== this.segs;
    this.segs = segs;
    this.broll = broll;
    this.music = music;
    this.mainVolume = mainVolume;
    this.applyVolumes();
    this.duration = sequenceDuration(segs);
    usePlayback.setState({ duration: this.duration });
    const t = Math.min(usePlayback.getState().time, this.duration);
    if (changed) {
      if (this.playing) this.startAt(t);
      else this.seek(t);
    } else this.syncOverlays(t, this.playing);
  }

  private deckFor(i: number) {
    const s = this.segs[i];
    return s ? (this.decks.get(deckKey(s.mediaId, i % 2)) ?? this.decks.get(deckKey(s.mediaId, 0))) : undefined;
  }

  private show(active: Deck | undefined) {
    for (const d of this.decks.values()) {
      if (d === active) continue;
      d.style.opacity = '0';
      if (isVideo(d) && !d.paused) d.pause();
    }
    this.applyLook();
  }

  /** Source time of a deck: the video position, or the photo's own clock. */
  private deckTime(el: Deck) {
    if (isVideo(el)) return el.currentTime;
    const rate = this.segs[this.cur]?.rate ?? 1;
    return this.still.src + (this.still.running ? ((performance.now() - this.still.wall) / 1000) * rate : 0);
  }

  private activate(i: number, src: number, play: boolean) {
    this.cur = i;
    const el = this.deckFor(i);
    this.show(el);
    this.still.running = false;
    if (!el) return;
    if (isVideo(el)) {
      if (Math.abs(el.currentTime - src) > 0.01) el.currentTime = src;
      // The clip's own speed; the browser keeps the pitch of the voice, as the export does.
      const rate = this.segs[i]?.rate ?? 1;
      if (el.playbackRate !== rate) el.playbackRate = rate;
      this.applyVolumes();
      if (play) el.play().catch(() => this.pause());
    } else this.still = { src, wall: performance.now(), running: play };
    // Park the next deck on its in-point so the jump is instant.
    const next = this.segs[i + 1];
    const nextEl = this.deckFor(i + 1);
    if (next && isVideo(nextEl) && nextEl !== el && Math.abs(nextEl.currentTime - next.srcStart) > 0.01) nextEl.currentTime = next.srcStart;
  }

  private startAt(t: number) {
    const loc = timelineToSource(this.segs, Math.min(t, Math.max(0, this.duration - 1e-3)));
    if (!loc) return this.pause();
    this.activate(loc.index, loc.src, true);
    usePlayback.setState({ time: t });
    this.syncOverlays(t, true);
  }

  play() {
    if (!this.segs.length) return;
    let t = usePlayback.getState().time;
    if (t >= this.duration - 0.05) t = 0;
    this.playing = true;
    usePlayback.setState({ playing: true });
    // Browsers only let sound start after a click or a key press: this is one.
    if (this.sound && this.sound.ctx.state !== 'running') void this.sound.ctx.resume().catch(() => undefined);
    this.startAt(t);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    this.playing = false;
    this.stopAt = null;
    cancelAnimationFrame(this.raf);
    if (this.still.running) {
      const rate = this.segs[this.cur]?.rate ?? 1;
      this.still = { src: this.still.src + ((performance.now() - this.still.wall) / 1000) * rate, wall: 0, running: false };
    }
    for (const d of this.decks.values()) if (isVideo(d) && !d.paused) d.pause();
    for (const o of this.overlays.values()) if (o instanceof HTMLVideoElement && !o.paused) o.pause();
    for (const a of this.audios.values()) if (!a.paused) a.pause();
    usePlayback.setState({ playing: false });
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  get isPlaying() {
    return this.playing;
  }

  seek(t: number) {
    const time = clamp(t, 0, this.duration);
    const loc = timelineToSource(this.segs, Math.min(time, Math.max(0, this.duration - 1e-3)));
    if (loc) this.activate(loc.index, loc.src, this.playing);
    else this.show(undefined);
    usePlayback.setState({ time });
    this.syncOverlays(time, this.playing);
    this.drawBlur();
  }

  /** Plays [start, end) and stops. */
  playRange(start: number, end: number) {
    this.seek(start);
    this.play();
    this.stopAt = end;
  }

  private tick = () => {
    if (!this.playing) return;
    let seg = this.segs[this.cur];
    let el = this.deckFor(this.cur);
    if (!seg || !el) return this.pause();
    if (this.deckTime(el) >= seg.srcEnd - END_EPS || (isVideo(el) && el.ended)) {
      if (this.cur + 1 >= this.segs.length) {
        this.pause();
        usePlayback.setState({ time: this.duration });
        this.syncOverlays(this.duration, false);
        return;
      }
      this.activate(this.cur + 1, this.segs[this.cur + 1].srcStart, true);
      seg = this.segs[this.cur];
      el = this.deckFor(this.cur)!;
    }
    const t = seg.tlStart + clamp((this.deckTime(el) - seg.srcStart) / seg.rate, 0, seg.tlEnd - seg.tlStart);
    if (this.stopAt !== null && t >= this.stopAt) {
      this.pause();
      return;
    }
    usePlayback.setState({ time: t });
    this.syncOverlays(t, true);
    if (this.blur) this.drawBlur();
    this.raf = requestAnimationFrame(this.tick);
  };

  private syncOverlays(t: number, playing: boolean) {
    for (const b of this.broll) {
      const el = this.overlays.get(b.id);
      if (!el) continue;
      const active = t >= b.start && t < b.start + b.duration;
      el.style.opacity = active ? String(b.opacity ?? 1) : '0';
      // Only visible overlays can be clicked and dragged in the preview.
      el.style.pointerEvents = active ? 'auto' : 'none';
      if (!(el instanceof HTMLVideoElement)) continue;
      const want = b.srcIn + clamp(t - b.start, 0, b.duration);
      if (active && playing) {
        if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
        if (el.paused) el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        const park = active ? want : b.srcIn;
        if ((active || (b.start - t < 2 && b.start > t)) && Math.abs(el.currentTime - park) > 0.03) el.currentTime = park;
      }
    }
    for (const a of this.music) {
      const el = this.audios.get(a.id);
      if (!el) continue;
      const local = t - a.start;
      const active = local >= 0 && local < a.duration;
      let fade = 1;
      if (a.fadeIn > 0 && local < a.fadeIn) fade = Math.max(0, local / a.fadeIn);
      if (a.fadeOut > 0 && a.duration - local < a.fadeOut) fade = Math.min(fade, Math.max(0, (a.duration - local) / a.fadeOut));
      el.volume = clamp(a.volume * fade, 0, 1);
      const want = a.srcIn + clamp(local, 0, a.duration);
      if (active && playing) {
        if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
        if (el.paused) el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (active && Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
      }
    }
  }

  /** A deck whose source changed (e.g. new audio mix) starts at 0: put it back where the timeline is. */
  private onReloaded = (e: Event) => {
    if (e.target === this.deckFor(this.cur) || e.target === this.deckFor(this.cur + 1)) this.seek(usePlayback.getState().time);
  };

  private onSeeked = (e: Event) => {
    if (e.target === this.deckFor(this.cur)) this.drawBlur();
  };

  private drawBlur() {
    if (!this.blur || !this.canvas) return;
    const el = this.deckFor(this.cur);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const srcW = !el ? 0 : isVideo(el) ? (el.readyState >= 2 ? el.videoWidth : 0) : el.complete ? el.naturalWidth : 0;
    const srcH = !el ? 0 : isVideo(el) ? el.videoHeight : el.naturalHeight;
    if (!el || !srcW || !srcH) {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    const { width: cw, height: ch } = this.canvas;
    const scale = Math.max(cw / srcW, ch / srcH);
    const w = srcW * scale;
    const h = srcH * scale;
    ctx.drawImage(el, (cw - w) / 2, (ch - h) / 2, w, h);
  }
}

export const player = new PlayerEngine();
