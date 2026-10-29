// js/controls.js
// Unified PC (Keyboard + Mouse Steering Wheel Drag) and Mobile (Multi-Touch Wheel, Pedals, Gears) controls.

import { wrapAngle, clamp } from './physics.js';

export class InputController {
  constructor(callbacks = {}) {
    this.onGearSelect = callbacks.onGearSelect || (() => {});
    this.onCameraCycle = callbacks.onCameraCycle || (() => {});
    this.onResetCar = callbacks.onResetCar || (() => {});
    this.onPauseToggle = callbacks.onPauseToggle || (() => {});
    this.onUserGesture = callbacks.onUserGesture || (() => {});

    this.enabled = false;
    this.mouseSensitivity = 1.0;
    this.steeringSensitivity = 1.0;

    // Keyboard states
    this.keys = Object.create(null);
    this.keyClutchHeld = false;
    this.clutchLatched = false;
    this._clutchKeyDownAt = 0;
    this._shiftedDuringClutchHold = false;
    this.restartRequested = false;

    // Wheel drag state (supports Mouse, Pointer, and Touch simultaneously with pedals)
    this.wheelEl = null;
    this.wheelDragging = false;
    this.wheelSteer = 0; // [-1, 1]
    this._wheelPointerId = null;
    this._wheelTouchId = null;
    this._wheelCenter = { x: 0, y: 0, r: 60 };
    this._wheelLast = { x: 0, y: 0, angle: 0 };

    // Touch / On-screen pedal states
    this.pedalGas = false;
    this.pedalBrake = false;
    this.pedalClutchHeld = false;
    this.pedalClutchLatched = false;
    this._pedalClutchDownAt = 0;
    this._gasHoldTimer = 0;
    this.handbrakeLatched = false;
    this.pedalHandbrakeHeld = false;

    // Smoothed clutch output when releasing latch/key so keyboard release feathers smoothly (~0.25s)
    this._smoothClutchOut = 0;

    this._cleanupFns = [];
  }

  bindDOM({
    wheelEl,
    gasEl,
    brakeEl,
    clutchEl,
    handbrakeEl,
    gearButtons
  }) {
    this.wheelEl = wheelEl;
    this.clutchEl = clutchEl;
    this.handbrakeEl = handbrakeEl;

    // Keyboard listeners
    const onKeyDown = (e) => this._handleKeyDown(e);
    const onKeyUp = (e) => this._handleKeyUp(e);
    const onBlur = () => this.resetTransientInputs();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this._cleanupFns.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });

    // Steering wheel Mouse + Touch binding
    if (wheelEl) {
      this._bindSteeringWheel(wheelEl);
    }

    // Pedals binding (works with multi-touch AND desktop mouse clicks)
    if (gasEl) {
      this._bindHoldControl(gasEl, (down) => {
        this.pedalGas = down;
        if (!down) this._gasHoldTimer = 0;
        gasEl.classList.toggle('pressed', down);
      });
    }

    if (brakeEl) {
      this._bindHoldControl(brakeEl, (down) => {
        this.pedalBrake = down;
        brakeEl.classList.toggle('pressed', down);
      });
    }

    if (clutchEl) {
      this._bindHoldControl(clutchEl, (down) => {
        const now = performanceNow();
        if (down) {
          if (this.pedalClutchLatched) {
            this.pedalClutchLatched = false;
            this.pedalClutchHeld = false;
          } else {
            this.pedalClutchHeld = true;
            this._pedalClutchDownAt = now;
            this._shiftedDuringClutchHold = false;
          }
        } else if (this.pedalClutchHeld) {
          const heldMs = now - this._pedalClutchDownAt;
          if (heldMs < 260 && !this._shiftedDuringClutchHold) {
            this.pedalClutchLatched = true;
          }
          this.pedalClutchHeld = false;
        }
        this._syncClutchVisual();
      });
    }

    if (handbrakeEl) {
      this._bindHoldControl(handbrakeEl, (down) => {
        if (down) {
          this.handbrakeLatched = !this.handbrakeLatched;
          this.pedalHandbrakeHeld = true;
        } else {
          this.pedalHandbrakeHeld = false;
        }
        this._syncHandbrakeVisual();
      });
    }

    // Gear buttons (PC click & Mobile touch)
    if (gearButtons && gearButtons.length) {
      for (let i = 0; i < gearButtons.length; i++) {
        const btn = gearButtons[i];
        const gear = btn.getAttribute('data-gear');
        const handler = (e) => {
          e.preventDefault();
          this.onUserGesture();
          if (!this.enabled) return;
          if (this.keyClutchHeld || this.pedalClutchHeld) {
            this._shiftedDuringClutchHold = true;
          }
          this.onGearSelect(gear);
        };
        btn.addEventListener('pointerdown', handler);
        this._cleanupFns.push(() => btn.removeEventListener('pointerdown', handler));
      }
    }
  }

  _bindSteeringWheel(el) {
    const startDrag = (clientX, clientY, isTouch) => {
      if (!this.enabled) return;
      this.onUserGesture();
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const r = Math.max(36, rect.width * 0.5);
      this._wheelCenter = { x: cx, y: cy, r };
      this._wheelLast = {
        x: clientX,
        y: clientY,
        angle: Math.atan2(clientY - cy, clientX - cx)
      };
      this.wheelDragging = true;
      this._wheelIsTouch = isTouch;
      el.classList.add('dragging');
    };

    const moveDrag = (clientX, clientY) => {
      if (!this.wheelDragging || !this.enabled) return;
      const { x: cx, y: cy, r } = this._wheelCenter;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      const sens = this._wheelIsTouch ? this.steeringSensitivity : this.mouseSensitivity;

      if (dist >= 18) {
        const angle = Math.atan2(dy, dx);
        const dAngle = wrapAngle(angle - this._wheelLast.angle);
        // 270 deg = 1.5*PI rad; scale smoothly so ~200 deg finger arc reaches full lock at 1.0x sens
        this.wheelSteer = clamp(this.wheelSteer + (dAngle / (Math.PI * 1.15)) * sens, -1, 1);
        this._wheelLast.angle = angle;
      } else {
        const moveDx = clientX - this._wheelLast.x;
        this.wheelSteer = clamp(this.wheelSteer + (moveDx / r) * 0.85 * sens, -1, 1);
      }
      this._wheelLast.x = clientX;
      this._wheelLast.y = clientY;
    };

    const endDrag = () => {
      this.wheelDragging = false;
      this._wheelPointerId = null;
      this._wheelTouchId = null;
      el.classList.remove('dragging');
    };

    // Mouse events
    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startDrag(e.clientX, e.clientY, false);
    };
    const onMouseMove = (e) => {
      if (!this.wheelDragging || this._wheelTouchId !== null) return;
      moveDrag(e.clientX, e.clientY);
    };
    const onMouseUp = () => {
      if (this.wheelDragging && this._wheelTouchId === null) endDrag();
    };

    // Multi-touch events (tracks dedicated Touch.identifier independent of pedal touches!)
    const onTouchStart = (e) => {
      if (this._wheelTouchId !== null) return;
      const t = e.changedTouches[0];
      if (!t) return;
      e.preventDefault();
      this._wheelTouchId = t.identifier;
      startDrag(t.clientX, t.clientY, true);
    };
    const onTouchMove = (e) => {
      if (this._wheelTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this._wheelTouchId) {
          e.preventDefault();
          moveDrag(t.clientX, t.clientY);
          break;
        }
      }
    };
    const onTouchEnd = (e) => {
      if (this._wheelTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this._wheelTouchId) {
          endDrag();
          break;
        }
      }
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    this._cleanupFns.push(() => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    });
  }

  _bindHoldControl(el, onStateChange) {
    let activeTouchId = null;
    let mouseHeld = false;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.onUserGesture();
      if (!this.enabled) return;
      mouseHeld = true;
      onStateChange(true);
    };
    const onMouseUp = () => {
      if (mouseHeld) {
        mouseHeld = false;
        onStateChange(false);
      }
    };

    const onTouchStart = (e) => {
      if (activeTouchId !== null) return;
      const t = e.changedTouches[0];
      if (!t) return;
      e.preventDefault();
      this.onUserGesture();
      if (!this.enabled) return;
      activeTouchId = t.identifier;
      onStateChange(true);
    };
    const onTouchEnd = (e) => {
      if (activeTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) {
          activeTouchId = null;
          onStateChange(false);
          break;
        }
      }
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    this._cleanupFns.push(() => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    });
  }

  _handleKeyDown(e) {
    // Allow Escape to toggle pause even while paused
    if (e.code === 'Escape') {
      e.preventDefault();
      this.onUserGesture();
      this.onPauseToggle();
      return;
    }

    if (!this.enabled) return;

    // Ignore if typing inside an input/select element
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    this.onUserGesture();

    const code = e.code;
    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }

    this.keys[code] = true;

    if (e.repeat) return;

    // Clutch key: E (plus Left/Right Shift alias)
    if (code === 'KeyE' || code === 'ShiftLeft' || code === 'ShiftRight') {
      if (this.clutchLatched) {
        this.clutchLatched = false;
        this.keyClutchHeld = false;
      } else {
        this.keyClutchHeld = true;
        this._clutchKeyDownAt = performanceNow();
        this._shiftedDuringClutchHold = false;
      }
      this._syncClutchVisual();
      return;
    }

    // Camera switch: C
    if (code === 'KeyC') {
      this.onCameraCycle();
      return;
    }

    // Reset car: T or Backspace
    if (code === 'KeyT' || code === 'Backspace') {
      e.preventDefault();
      this.onResetCar();
      return;
    }

    // Restart stalled engine: F
    if (code === 'KeyF') {
      this.restartRequested = true;
      return;
    }

    // Gear selection: 1, 2, 3, 4 + R, N, P + full number-key mapping
    const gearMap = {
      Digit1: '1',
      Numpad1: '1',
      Digit2: '2',
      Numpad2: '2',
      Digit3: '3',
      Numpad3: '3',
      Digit4: '4',
      Numpad4: '4',
      Digit0: 'N',
      Numpad0: 'N',
      Digit5: 'N',
      KeyN: 'N',
      Backquote: 'R',
      Digit6: 'R',
      KeyR: 'R',
      Digit7: 'P',
      KeyP: 'P'
    };

    if (gearMap[code]) {
      if (this.keyClutchHeld || this.pedalClutchHeld) {
        this._shiftedDuringClutchHold = true;
      }
      this.onGearSelect(gearMap[code]);
    }
  }

  _handleKeyUp(e) {
    const code = e.code;
    this.keys[code] = false;

    if (code === 'KeyE' || code === 'ShiftLeft' || code === 'ShiftRight') {
      if (this.keyClutchHeld) {
        const heldMs = performanceNow() - this._clutchKeyDownAt;
        if (heldMs < 230 && !this._shiftedDuringClutchHold) {
          // Quick tap toggles clutch disengaged until next tap
          this.clutchLatched = true;
        }
        this.keyClutchHeld = false;
      }
      this._syncClutchVisual();
    }
  }

  _syncClutchVisual() {
    if (!this.clutchEl) return;
    const active = this.isClutchRequested();
    const latched = this.clutchLatched || this.pedalClutchLatched;
    this.clutchEl.classList.toggle('pressed', active);
    this.clutchEl.classList.toggle('latched', latched);
  }

  _syncHandbrakeVisual() {
    if (!this.handbrakeEl) return;
    const active = Boolean(this.keys.Space) || this.handbrakeLatched || this.pedalHandbrakeHeld;
    this.handbrakeEl.classList.toggle('active', active);
  }

  isClutchRequested() {
    return (
      this.keyClutchHeld ||
      this.clutchLatched ||
      this.pedalClutchHeld ||
      this.pedalClutchLatched
    );
  }

  resetTransientInputs() {
    for (const k in this.keys) this.keys[k] = false;
    this.keyClutchHeld = false;
    this.clutchLatched = false;
    this.pedalGas = false;
    this.pedalBrake = false;
    this.pedalClutchHeld = false;
    this.pedalClutchLatched = false;
    this.handbrakeLatched = false;
    this.pedalHandbrakeHeld = false;
    this.wheelDragging = false;
    this.wheelSteer = 0;
    this._smoothClutchOut = 0;
    this._syncClutchVisual();
    this._syncHandbrakeVisual();
  }

  /**
   * Sample normalized inputs for the current frame (dt in seconds).
   */
  sampleInputs(dt, currentVehicleSteer = 0) {
    const throttle = (this.keys.KeyW || this.keys.ArrowUp || this.pedalGas) ? 1 : 0;
    const brake = (this.keys.KeyS || this.keys.ArrowDown || this.pedalBrake) ? 1 : 0;

    // Auto-release mobile touch clutch latch smoothly once player holds Gas pedal to drive away
    if (this.pedalClutchLatched && this.pedalGas) {
      this._gasHoldTimer += dt;
      if (this._gasHoldTimer > 0.16) {
        this.pedalClutchLatched = false;
        this._syncClutchVisual();
      }
    }

    // Release latched handbrake automatically if player holds Space or taps it off
    const handbrake = Boolean(this.keys.Space) || this.handbrakeLatched || this.pedalHandbrakeHeld;
    this._syncHandbrakeVisual();

    const wantClutch = this.isClutchRequested() ? 1 : 0;
    if (wantClutch > this._smoothClutchOut) {
      // Pressing clutch down is near-instant
      this._smoothClutchOut = Math.min(1, this._smoothClutchOut + dt * 16);
    } else {
      // Releasing clutch key feathers smoothly over ~0.26s for approachable keyboard bite-point control
      this._smoothClutchOut = Math.max(0, this._smoothClutchOut - dt * 3.8);
    }

    // Steering: direct wheel drag takes priority; otherwise keyboard A/D or Left/Right
    let steerTarget = 0;
    let steerDirect = false;

    if (this.wheelDragging) {
      steerTarget = this.wheelSteer;
      steerDirect = true;
    } else {
      const left = this.keys.KeyA || this.keys.ArrowLeft;
      const right = this.keys.KeyD || this.keys.ArrowRight;
      if (left && !right) steerTarget = -1;
      else if (right && !left) steerTarget = 1;
      else steerTarget = 0;
      // Keep wheelSteer synced with actual vehicle steer so starting a new drag never jumps!
      this.wheelSteer = currentVehicleSteer;
    }

    const restartRequested = this.restartRequested;
    this.restartRequested = false;

    return {
      throttle,
      brake,
      clutch: this._smoothClutchOut,
      handbrake,
      steerTarget,
      steerDirect,
      steeringSensitivity: this.steeringSensitivity,
      restartRequested
    };
  }

  dispose() {
    for (let i = 0; i < this._cleanupFns.length; i++) this._cleanupFns[i]();
    this._cleanupFns.length = 0;
  }
}

function performanceNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
