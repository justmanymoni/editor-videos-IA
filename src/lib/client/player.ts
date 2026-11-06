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
import type { AudioItem, BrollItem } from '@/lib/shared/types';
import { clamp } from '@/lib/shared/ranges';
import { sequenceDuration, timelineToSource, type Segment } from '@/lib/shared/timeline';

export const usePlayback = create<{ time: number; playing: boolean; duration: number }>(() => ({ time: 0, playing: false, duration: 0 }));

export const deckKey = (mediaId: string, slot: number) => `${mediaId}#${slot}`;

const END_EPS = 0.012;

class PlayerEngine {
  private segs: Segment[] = [];
  private duration = 0;
  private decks = new Map<string, HTMLVideoElement>();
  private overlays = new Map<string, HTMLVideoElement | HTMLImageElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private broll: BrollItem[] = [];
  private music: AudioItem[] = [];
  private mainVolume = 1;
  private cur = -1;
  private raf = 0;
  private playing = false;
  private stopAt: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private blur = false;

  registerDeck(key: string, el: HTMLVideoElement | null) {
    const prev = this.decks.get(key);
    if (prev === el) return;
    if (prev) {
      prev.removeEventListener('seeked', this.onSeeked);
      prev.removeEventListener('loadeddata', this.onSeeked);
    }
    if (el) {
      this.decks.set(key, el);
      el.addEventListener('seeked', this.onSeeked);
      el.addEventListener('loadeddata', this.onSeeked);
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

  setBlurCanvas(el: HTMLCanvasElement | null, enabled: boolean) {
    this.canvas = el;
    this.blur = enabled && !!el;
    this.drawBlur();
  }

  setTimeline(segs: Segment[], broll: BrollItem[], music: AudioItem[], mainVolume: number) {
    const changed = segs !== this.segs;
    this.segs = segs;
    this.broll = broll;
    this.music = music;
    this.mainVolume = mainVolume;
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

  private show(active: HTMLVideoElement | undefined) {
    for (const d of this.decks.values()) {
      const on = d === active;
      d.style.opacity = on ? '1' : '0';
      if (!on && !d.paused) d.pause();
    }
  }

  private activate(i: number, src: number, play: boolean) {
    this.cur = i;
    const el = this.deckFor(i);
    this.show(el);
    if (!el) return;
    if (Math.abs(el.currentTime - src) > 0.01) el.currentTime = src;
    el.volume = clamp(this.mainVolume, 0, 1);
    if (play) el.play().catch(() => this.pause());
    // Park the next deck on its in-point so the jump is instant.
    const next = this.segs[i + 1];
    const nextEl = this.deckFor(i + 1);
    if (next && nextEl && nextEl !== el && Math.abs(nextEl.currentTime - next.srcStart) > 0.01) nextEl.currentTime = next.srcStart;
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
    this.startAt(t);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    this.playing = false;
    this.stopAt = null;
    cancelAnimationFrame(this.raf);
    for (const d of this.decks.values()) if (!d.paused) d.pause();
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
    if (el.currentTime >= seg.srcEnd - END_EPS || el.ended) {
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
    const t = seg.tlStart + clamp(el.currentTime - seg.srcStart, 0, seg.tlEnd - seg.tlStart);
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
      el.style.opacity = active ? '1' : '0';
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

  private onSeeked = (e: Event) => {
    if (e.target === this.deckFor(this.cur)) this.drawBlur();
  };

  private drawBlur() {
    if (!this.blur || !this.canvas) return;
    const el = this.deckFor(this.cur);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    if (!el || el.readyState < 2) {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    const { width: cw, height: ch } = this.canvas;
    const scale = Math.max(cw / el.videoWidth, ch / el.videoHeight);
    const w = el.videoWidth * scale;
    const h = el.videoHeight * scale;
    ctx.drawImage(el, (cw - w) / 2, (ch - h) / 2, w, h);
  }
}

export const player = new PlayerEngine();
