// タッチ / 傾き / 仮想スティック / キーボード入力を統合する
export class Input {
  constructor(container) {
    this.container = container;
    this.steer = 0;
    this.drift = false;
    this.itemDown = false;
    this.itemDownAt = 0;
    this.itemReleased = false;
    this.keys = new Set();
    this.touchSteer = 0;
    this.tiltSteer = 0;
    this.tiltZero = 0;
    this.steerPointers = new Map();
    this.driftPointers = new Set();
    this.settings = null;
    this.enabled = false;
    this._bindKeyboard();
    this._onOrient = e => this._handleTilt(e);
  }

  apply(settings) {
    this.settings = settings;
    const c = this.container;
    const size = 84 * settings.buttonSize;
    c.style.setProperty('--btn', size + 'px');
    c.style.setProperty('--btn-alpha', settings.buttonOpacity);
    c.classList.toggle('lefty', settings.lefty);
    c.innerHTML = `
      <div class="steer-zone mode-${settings.control}">
        ${settings.control === 'buttons' ? '<div class="sbtn left" aria-label="左">◀</div><div class="sbtn right" aria-label="右">▶</div>' : ''}
        ${settings.control === 'stick' ? '<div class="stick-base"><div class="stick-knob"></div></div><div class="zone-label">スティック</div>' : ''}
        ${settings.control === 'tilt' ? '<button class="tilt-cal">傾きリセット</button>' : ''}
      </div>
      <div class="drift-zone"><span>ドリフト<br><small>長押し</small></span></div>
      <div class="item-btn" aria-label="アイテム"><span class="item-icon"></span><small class="item-count"></small><span class="item-sub" aria-label="ストック"></span></div>
    `;
    this.steerZone = c.querySelector('.steer-zone');
    this.driftZone = c.querySelector('.drift-zone');
    this.itemBtn = c.querySelector('.item-btn');
    this.knob = c.querySelector('.stick-knob');
    this.stickBase = c.querySelector('.stick-base');
    this._bindTouch();
    window.removeEventListener('deviceorientation', this._onOrient);
    if (settings.control === 'tilt') {
      window.addEventListener('deviceorientation', this._onOrient);
      c.querySelector('.tilt-cal').addEventListener('pointerdown', e => { e.stopPropagation(); this.tiltZero = this._lastBeta || 0; });
    }
  }

  static async requestTiltPermission() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        return r === 'granted';
      }
      return 'DeviceOrientationEvent' in window;
    } catch { return false; }
  }

  _handleTilt(e) {
    if (e.beta == null) return;
    const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 90;
    let v = e.beta;
    if (angle === 270 || angle === -90) v = -v;
    this._lastBeta = v;
    const d = v - this.tiltZero;
    const dead = 2;
    const s = Math.abs(d) < dead ? 0 : (d - Math.sign(d) * dead) / 22;
    this.tiltSteer = Math.max(-1, Math.min(1, s));
  }

  _bindTouch() {
    const zone = this.steerZone;
    const updateSteer = () => {
      let s = 0;
      for (const v of this.steerPointers.values()) s += v.val;
      this.touchSteer = Math.max(-1, Math.min(1, s));
      if (this.settings.control === 'buttons') {
        zone.querySelector('.left')?.classList.toggle('active', this.touchSteer < 0);
        zone.querySelector('.right')?.classList.toggle('active', this.touchSteer > 0);
      }
    };
    const calc = (e, p) => {
      if (this.settings.control === 'buttons') {
        const r = zone.getBoundingClientRect();
        return e.clientX < r.left + r.width / 2 ? -1 : 1;
      }
      if (this.settings.control === 'stick') {
        const dx = e.clientX - p.ox;
        const k = Math.max(-1, Math.min(1, dx / 55));
        if (this.knob) this.knob.style.transform = `translate(${k * 40}px, 0)`;
        return k;
      }
      return 0;
    };
    zone.addEventListener('pointerdown', e => {
      if (this.settings.control === 'tilt') return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      const p = { ox: e.clientX, val: 0 };
      if (this.settings.control === 'stick' && this.stickBase) {
        const r = zone.getBoundingClientRect();
        this.stickBase.style.left = (e.clientX - r.left) + 'px';
        this.stickBase.style.top = (e.clientY - r.top) + 'px';
        this.stickBase.classList.add('active');
      }
      p.val = calc(e, p);
      this.steerPointers.set(e.pointerId, p);
      updateSteer();
    });
    zone.addEventListener('pointermove', e => {
      const p = this.steerPointers.get(e.pointerId);
      if (!p) return;
      p.val = calc(e, p);
      updateSteer();
    });
    const end = e => {
      if (!this.steerPointers.delete(e.pointerId)) return;
      if (this.knob) this.knob.style.transform = '';
      if (this.steerPointers.size === 0) this.stickBase?.classList.remove('active');
      updateSteer();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const dz = this.driftZone;
    dz.addEventListener('pointerdown', e => { e.preventDefault(); dz.setPointerCapture(e.pointerId); this.driftPointers.add(e.pointerId); dz.classList.add('active'); });
    const dEnd = e => { this.driftPointers.delete(e.pointerId); if (!this.driftPointers.size) dz.classList.remove('active'); };
    dz.addEventListener('pointerup', dEnd);
    dz.addEventListener('pointercancel', dEnd);

    const ib = this.itemBtn;
    ib.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      ib.setPointerCapture(e.pointerId);
      this.itemDown = true; this.itemDownAt = performance.now();
      ib.classList.add('active');
    });
    const iEnd = () => {
      if (!this.itemDown) return;
      this.itemDown = false; this.itemReleased = true;
      ib.classList.remove('active');
    };
    ib.addEventListener('pointerup', iEnd);
    ib.addEventListener('pointercancel', iEnd);
  }

  _bindKeyboard() {
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['KeyX', 'KeyZ', 'Enter'].includes(e.code) && !this.itemDown) { this.itemDown = true; this.itemDownAt = performance.now(); }
      if (['ArrowLeft', 'ArrowRight', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code) && this.enabled) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (['KeyX', 'KeyZ', 'Enter'].includes(e.code) && this.itemDown) { this.itemDown = false; this.itemReleased = true; }
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.steerPointers.clear(); this.driftPointers.clear(); this.touchSteer = 0; });
  }

  // 1フレーム分の入力を確定させる
  poll() {
    let k = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) k -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) k += 1;
    let s = k !== 0 ? k : this.touchSteer;
    if (k === 0 && this.settings?.control === 'tilt') s = this.tiltSteer;
    this.steer = s;
    this.drift = this.driftPointers.size > 0 || this.keys.has('Space') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const released = this.itemReleased;
    this.itemReleased = false;
    const holdMs = this.itemDown ? performance.now() - this.itemDownAt : 0;
    return { steer: this.steer, drift: this.drift, itemReleased: released, itemHolding: this.itemDown && holdMs > 250 };
  }

  reset() {
    this.steerPointers.clear(); this.driftPointers.clear();
    this.touchSteer = 0; this.itemDown = false; this.itemReleased = false;
    this.container.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
  }

  setItem(icon, count, icon2) {
    if (!this.itemBtn) return;
    const sub = this.itemBtn.querySelector('.item-sub');
    sub.textContent = icon2 || '';
    sub.classList.toggle('on', !!icon2);
    this.itemBtn.querySelector('.item-icon').textContent = icon || '';
    this.itemBtn.querySelector('.item-count').textContent = count > 1 ? '×' + count : '';
    this.itemBtn.classList.toggle('has-item', !!icon);
  }
}
