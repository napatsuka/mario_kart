// 素材ファイルを使わず WebAudio で BGM / 効果音を合成する(容量ゼロ)
import { mulberry32 } from './track.js';

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.bgmVol = 0.6; this.seVol = 0.8;
    this.bgmTimer = null;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain(); this.bgmGain.connect(this.master);
    this.seGain = this.ctx.createGain(); this.seGain.connect(this.master);
    this.setVolumes(this.bgmVol, this.seVol);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolumes(bgm, se) {
    this.bgmVol = bgm; this.seVol = se;
    if (this.music) this.music.volume = Math.min(1, bgm * 0.9);
    if (!this.ctx) return;
    this.bgmGain.gain.value = bgm * 0.35;
    this.seGain.gain.value = se * 0.6;
  }

  pause() { this.paused = true; this.ctx?.suspend(); this.music?.pause(); }
  resume() { this.paused = false; this.ctx?.resume(); if (this.music && this.musicKey) this.music.play().catch(() => {}); }

  // 音楽(mp3)。'menu' = Grand Prix Start、'race' = Turbo Circuit。ループ再生
  playMusic(key) {
    if (this.musicKey === key && this.music && !this.music.paused) return;
    if (this.music && this.musicKey !== key) { this.music.pause(); this.music.currentTime = 0; }
    this.musicEls ??= {};
    const path = `assets/audio/${key}.mp3`;
    const el = (this.musicEls[key] ??= Object.assign(document.createElement('audio'), { src: globalThis.__ASSETS?.[path] ?? path, loop: true, preload: 'auto' }));
    el.volume = Math.min(1, this.bgmVol * 0.9);
    this.music = el; this.musicKey = key;
    if (!this.paused) el.play().catch(() => {}); // タップ前は再生できないので、次のタップで retryMusic()
  }
  retryMusic() { if (this.music && this.music.paused && !this.paused) this.music.play().catch(() => {}); }
  stopMusic() { if (this.music) { this.music.pause(); this.music.currentTime = 0; } this.music = null; this.musicKey = null; }

  _tone(freq, t, dur, type = 'square', vol = 0.3, dest = this.seGain, slideTo) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(t, dur, vol, dest = this.seGain, freq = 4000) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t); s.stop(t + dur);
  }

  se(name) {
    if (!this.ctx || this.paused) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'count': this._tone(660, t, 0.25, 'square', 0.25); break;
      case 'go': this._tone(1320, t, 0.6, 'square', 0.25); break;
      case 'item': [0, 0.05, 0.1].forEach((d, i) => this._tone(880 + i * 220, t + d, 0.12, 'triangle', 0.2)); break;
      case 'roll': this._tone(1200 + Math.random() * 600, t, 0.04, 'square', 0.06); break;
      case 'boost': this._tone(200, t, 0.5, 'sawtooth', 0.25, this.seGain, 900); this._noise(t, 0.4, 0.2); break;
      case 'turbo1': this._tone(500, t, 0.25, 'sawtooth', 0.18, this.seGain, 1000); break;
      case 'spark': this._tone(1800, t, 0.06, 'square', 0.07); break;
      case 'hit': this._tone(300, t, 0.5, 'square', 0.25, this.seGain, 60); this._noise(t, 0.3, 0.3, this.seGain, 800); break;
      case 'shoot': this._tone(900, t, 0.2, 'square', 0.15, this.seGain, 300); break;
      case 'drop': this._tone(300, t, 0.15, 'sine', 0.3, this.seGain, 150); break;
      case 'guard': this._tone(1500, t, 0.15, 'triangle', 0.25); this._tone(2000, t + 0.07, 0.2, 'triangle', 0.2); break;
      case 'wall': this._noise(t, 0.12, 0.25, this.seGain, 600); break;
      case 'lap': [0, 0.1, 0.2].forEach((d, i) => this._tone([784, 988, 1175][i], t + d, 0.18, 'square', 0.18)); break;
      case 'finish': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this._tone(f, t + i * 0.12, 0.25, 'square', 0.18)); break;
      case 'select': this._tone(1000, t, 0.06, 'triangle', 0.2); break;
      case 'thunder': this._noise(t, 0.9, 0.6, this.seGain, 300); this._tone(90, t, 0.9, 'sawtooth', 0.35, this.seGain, 30); this._noise(t + 0.05, 0.3, 0.5, this.seGain, 3000); break;
      case 'boom': this._noise(t, 0.8, 0.6, this.seGain, 200); this._tone(120, t, 0.7, 'sine', 0.5, this.seGain, 30); break;
      case 'ink': this._noise(t, 0.25, 0.35, this.seGain, 900); this._tone(220, t, 0.25, 'sine', 0.25, this.seGain, 80); break;
      case 'mega': [0, 1, 2, 3, 4].forEach(i => this._tone(200 + i * 80, t + i * 0.08, 0.16, 'square', 0.16)); break;
      case 'coin': this._tone(1320, t, 0.08, 'square', 0.12); this._tone(1760, t + 0.06, 0.16, 'square', 0.12); break;
      case 'jump': this._tone(500, t, 0.12, 'square', 0.12, this.seGain, 900); break;
      case 'land': this._noise(t, 0.12, 0.3, this.seGain, 500); break;
      case 'star': [0, 1, 2, 3].forEach(i => this._tone(1000 + i * 300, t + i * 0.05, 0.1, 'triangle', 0.15)); break;
    }
  }

  // 疑似エンジン音
  engineStart() {
    if (!this.ctx || this.engine) return;
    const o = this.ctx.createOscillator(), o2 = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'square';
    f.type = 'lowpass'; f.frequency.value = 600;
    g.gain.value = 0.0;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.seGain);
    o.start(); o2.start();
    this.engine = { o, o2, g, f };
  }
  engineSet(ratio, boosting) {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    const base = 55 + ratio * 70 + (boosting ? 25 : 0);
    this.engine.o.frequency.setTargetAtTime(base, t, 0.05);
    this.engine.o2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    this.engine.g.gain.setTargetAtTime(0.05 + ratio * 0.06, t, 0.1);
  }
  engineStop() {
    if (!this.engine) return;
    try { this.engine.o.stop(); this.engine.o2.stop(); } catch {}
    this.engine = null;
  }

  // シード値からコース専用BGMを生成して鳴らす
  bgmStart(seed, minor = false, tempo = 140) {
    if (!this.ctx) return;
    this.bgmStop();
    const rnd = mulberry32(seed * 31 + 5);
    const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const progs = minor ? [[0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 4]] : [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 4]];
    const prog = progs[Math.floor(rnd() * progs.length)];
    const root = 48 + Math.floor(rnd() * 7);
    const pattern = Array.from({ length: 16 }, () => Math.floor(rnd() * 5));
    const melody = Array.from({ length: 32 }, () => (rnd() < 0.7 ? Math.floor(rnd() * 7) : -1));
    const step = 60 / tempo / 4;
    let next = this.ctx.currentTime + 0.1, i = 0;
    const deg = (d, oct = 0) => root + scale[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
    this.bgmTimer = setInterval(() => {
      if (!this.ctx || this.paused) return;
      while (next < this.ctx.currentTime + 0.25) {
        const bar = Math.floor(i / 16) % 4, s = i % 16;
        const chord = prog[bar];
        if (s % 4 === 0) this._tone(NOTE(deg(chord, -1)), next, step * 3, 'triangle', 0.5, this.bgmGain);
        if (s % 2 === 0) {
          const arp = [0, 2, 4, 7][pattern[s] % 4];
          this._tone(NOTE(deg(chord + arp, 1)), next, step * 1.5, 'square', 0.12, this.bgmGain);
        }
        const m = melody[(i % 32)];
        if (s % 2 === 0 && m >= 0 && (i >> 6) % 2 === 1) this._tone(NOTE(deg(chord + m, 2)), next, step * 2, 'triangle', 0.18, this.bgmGain);
        if (s % 4 === 0) this._tone(150, next, 0.12, 'sine', 0.6, this.bgmGain, 40);
        if (s % 4 === 2) this._noise(next, 0.05, 0.25, this.bgmGain, 8000);
        if (s === 4 || s === 12) this._noise(next, 0.12, 0.35, this.bgmGain, 1800);
        next += step; i++;
      }
    }, 60);
  }
  bgmStop() { clearInterval(this.bgmTimer); this.bgmTimer = null; }
}
