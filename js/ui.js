// js/ui.js
// Clean, zero-thrash UI & HUD manager for menus, settings, mission selection, and live telemetry.

import { MISSIONS } from './missions.js';

const SETTINGS_STORAGE_KEY = 'parklite_settings_v1';

export class UIManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;

    this.settings = this._loadSettings();

    // Cache DOM elements once at startup
    this.el = {
      screenMenu: byId('screen-menu'),
      hud: byId('hud'),
      collisionFlash: byId('collision-flash'),

      // Menu buttons
      btnMenuPlay: byId('btn-menu-play'),
      btnMenuMissions: byId('btn-menu-missions'),
      btnMenuSettings: byId('btn-menu-settings'),
      btnMenuAbout: byId('btn-menu-about'),

      // HUD Top
      hudMissionTag: byId('hud-mission-tag'),
      hudMissionTitle: byId('hud-mission-title'),
      hudMissionDesc: byId('hud-mission-desc'),
      hudTimer: byId('hud-timer'),
      hudCollisions: byId('hud-collisions'),
      badgeBounds: byId('badge-bounds'),
      badgeAngle: byId('badge-angle'),
      badgeStop: byId('badge-stop'),
      hudProgressFill: byId('hud-progress-fill'),
      hudParkHint: byId('hud-park-hint'),

      btnHudReset: byId('btn-hud-reset'),
      btnHudCamera: byId('btn-hud-camera'),
      hudCameraLabel: byId('hud-camera-label'),
      btnHudPause: byId('btn-hud-pause'),
      hudToast: byId('hud-toast'),

      // HUD Bottom
      wheelPad: byId('steering-wheel-pad'),
      wheelSvg: byId('steering-wheel-svg'),
      hudSpeed: byId('hud-speed'),
      hudGearBox: byId('hud-gear-box'),
      hudGear: byId('hud-gear'),
      hudRpmFill: byId('hud-rpm-fill'),
      hudRpmText: byId('hud-rpm-text'),
      hudClutchFill: byId('hud-clutch-fill'),
      hudClutchState: byId('hud-clutch-state'),
      hudStallBtn: byId('hud-stall-btn'),
      gearButtons: Array.from(document.querySelectorAll('.gear-btn')),

      pedalsCluster: byId('pedals-cluster'),
      btnHandbrake: byId('btn-handbrake'),
      pedalClutch: byId('pedal-clutch'),
      pedalBrake: byId('pedal-brake'),
      pedalGas: byId('pedal-gas'),

      // Modals
      modalMissions: byId('modal-missions'),
      missionsGrid: byId('missions-grid'),
      modalSettings: byId('modal-settings'),
      modalAbout: byId('modal-about'),
      modalPause: byId('modal-pause'),
      modalResult: byId('modal-result'),

      // Settings inputs
      qualityBtns: Array.from(document.querySelectorAll('.seg-btn[data-quality]')),
      pedalsBtns: Array.from(document.querySelectorAll('.seg-btn[data-pedals]')),
      chkAutoQuality: byId('chk-auto-quality'),
      sliderVolume: byId('slider-volume'),
      valVolume: byId('val-volume'),
      sliderMouseSens: byId('slider-mouse-sens'),
      valMouseSens: byId('val-mouse-sens'),
      sliderSteerSens: byId('slider-steer-sens'),
      valSteerSens: byId('val-steer-sens'),

      // Pause buttons
      btnPauseResume: byId('btn-pause-resume'),
      btnPauseRestart: byId('btn-pause-restart'),
      btnPauseMissions: byId('btn-pause-missions'),
      btnPauseSettings: byId('btn-pause-settings'),
      btnPauseMenu: byId('btn-pause-menu'),

      // Result modal
      resultBadge: byId('result-badge'),
      resultTitle: byId('result-title'),
      resultStars: byId('result-stars'),
      resultBreakdown: byId('result-breakdown'),
      scoreAccuracy: byId('score-accuracy'),
      scoreTime: byId('score-time'),
      scoreCollisions: byId('score-collisions'),
      scoreTotal: byId('score-total'),
      resultFailMsg: byId('result-fail-msg'),
      btnResultNext: byId('btn-result-next'),
      btnResultRetry: byId('btn-result-retry'),
      btnResultMenu: byId('btn-result-menu')
    };

    // Dirty-check cache so game loop never touches DOM unless displayed value changed
    this._cache = {
      speed: '',
      gear: '',
      rpmText: '',
      rpmPct: -1,
      clutchPct: -1,
      clutchState: '',
      wheelDeg: -9999,
      timer: '',
      collisions: -1,
      boundsOk: null,
      angleOk: null,
      stopOk: null,
      progressPct: -1,
      hint: '',
      stalled: null,
      toast: ''
    };

    this._flashTimeout = null;
    this._bindEvents();
    this._applySettingsToUI();
  }

  _loadSettings() {
    const defaults = {
      quality: 'medium',
      autoQuality: true,
      volume: 0.55,
      mouseSensitivity: 1.0,
      steeringSensitivity: 1.0,
      pedalsMode: 'auto'
    };
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_STORAGE_KEY) : null;
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    } catch (_) {
      return defaults;
    }
  }

  _saveSettings() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
      }
    } catch (_) {
      // Safe fallback when storage is restricted
    }
  }

  _bindEvents() {
    const { el, callbacks } = this;

    el.btnMenuPlay?.addEventListener('click', () => callbacks.onPlay?.());
    el.btnMenuMissions?.addEventListener('click', () => this.openMissionsModal('menu'));
    el.btnMenuSettings?.addEventListener('click', () => this.openModal('modal-settings'));
    el.btnMenuAbout?.addEventListener('click', () => this.openModal('modal-about'));

    // Close modal buttons
    const closeBtns = document.querySelectorAll('[data-close-modal]');
    for (let i = 0; i < closeBtns.length; i++) {
      closeBtns[i].addEventListener('click', () => {
        const id = closeBtns[i].getAttribute('data-close-modal');
        this.closeModal(id);
      });
    }

    // HUD buttons
    el.btnHudReset?.addEventListener('click', () => callbacks.onResetCar?.());
    el.btnHudCamera?.addEventListener('click', () => callbacks.onCameraCycle?.());
    el.btnHudPause?.addEventListener('click', () => callbacks.onPauseToggle?.());
    el.hudStallBtn?.addEventListener('click', () => callbacks.onRestartEngine?.());

    // Pause buttons
    el.btnPauseResume?.addEventListener('click', () => callbacks.onResume?.());
    el.btnPauseRestart?.addEventListener('click', () => callbacks.onRestartMission?.());
    el.btnPauseMissions?.addEventListener('click', () => this.openMissionsModal('pause'));
    el.btnPauseSettings?.addEventListener('click', () => this.openModal('modal-settings'));
    el.btnPauseMenu?.addEventListener('click', () => callbacks.onReturnMainMenu?.());

    // Result buttons
    el.btnResultNext?.addEventListener('click', () => callbacks.onNextMission?.());
    el.btnResultRetry?.addEventListener('click', () => callbacks.onRestartMission?.());
    el.btnResultMenu?.addEventListener('click', () => callbacks.onReturnMainMenu?.());

    // Settings controls
    for (let i = 0; i < el.qualityBtns.length; i++) {
      const btn = el.qualityBtns[i];
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-quality');
        this.setQualityUI(q, true);
      });
    }

    for (let i = 0; i < el.pedalsBtns.length; i++) {
      const btn = el.pedalsBtns[i];
      btn.addEventListener('click', () => {
        this.settings.pedalsMode = btn.getAttribute('data-pedals');
        this._saveSettings();
        this._applySettingsToUI();
      });
    }

    el.chkAutoQuality?.addEventListener('change', () => {
      this.settings.autoQuality = el.chkAutoQuality.checked;
      this._saveSettings();
      callbacks.onSettingsChange?.(this.settings);
    });

    el.sliderVolume?.addEventListener('input', () => {
      this.settings.volume = Number(el.sliderVolume.value) / 100;
      el.valVolume.textContent = `${Math.round(this.settings.volume * 100)}%`;
      this._saveSettings();
      callbacks.onSettingsChange?.(this.settings);
    });

    el.sliderMouseSens?.addEventListener('input', () => {
      this.settings.mouseSensitivity = Number(el.sliderMouseSens.value) / 100;
      el.valMouseSens.textContent = `${this.settings.mouseSensitivity.toFixed(1)}x`;
      this._saveSettings();
      callbacks.onSettingsChange?.(this.settings);
    });

    el.sliderSteerSens?.addEventListener('input', () => {
      this.settings.steeringSensitivity = Number(el.sliderSteerSens.value) / 100;
      el.valSteerSens.textContent = `${this.settings.steeringSensitivity.toFixed(1)}x`;
      this._saveSettings();
      callbacks.onSettingsChange?.(this.settings);
    });
  }

  setQualityUI(quality, notify = false) {
    this.settings.quality = quality;
    for (let i = 0; i < this.el.qualityBtns.length; i++) {
      const btn = this.el.qualityBtns[i];
      btn.classList.toggle('active', btn.getAttribute('data-quality') === quality);
    }
    this._saveSettings();
    if (notify) {
      this.callbacks.onSettingsChange?.(this.settings);
    }
  }

  _applySettingsToUI() {
    const { el, settings } = this;
    for (let i = 0; i < el.qualityBtns.length; i++) {
      const b = el.qualityBtns[i];
      b.classList.toggle('active', b.getAttribute('data-quality') === settings.quality);
    }
    for (let i = 0; i < el.pedalsBtns.length; i++) {
      const b = el.pedalsBtns[i];
      b.classList.toggle('active', b.getAttribute('data-pedals') === settings.pedalsMode);
    }
    if (el.chkAutoQuality) el.chkAutoQuality.checked = Boolean(settings.autoQuality);
    if (el.sliderVolume) {
      el.sliderVolume.value = String(Math.round(settings.volume * 100));
      el.valVolume.textContent = `${Math.round(settings.volume * 100)}%`;
    }
    if (el.sliderMouseSens) {
      el.sliderMouseSens.value = String(Math.round(settings.mouseSensitivity * 100));
      el.valMouseSens.textContent = `${settings.mouseSensitivity.toFixed(1)}x`;
    }
    if (el.sliderSteerSens) {
      el.sliderSteerSens.value = String(Math.round(settings.steeringSensitivity * 100));
      el.valSteerSens.textContent = `${settings.steeringSensitivity.toFixed(1)}x`;
    }
    this.updatePedalsVisibility();
  }

  updatePedalsVisibility() {
    if (!this.el.pedalsCluster) return;
    const isTouchOrSmall =
      (typeof window !== 'undefined' &&
        (window.innerWidth <= 920 ||
          window.innerHeight <= 540 ||
          (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
          navigator.maxTouchPoints > 0));

    const mode = this.settings.pedalsMode;
    this.el.pedalsCluster.classList.remove('hidden', 'compact-desktop');
    if (mode === 'hide' && !isTouchOrSmall) {
      this.el.pedalsCluster.classList.add('compact-desktop');
    } else if (mode === 'auto' && !isTouchOrSmall) {
      this.el.pedalsCluster.classList.add('compact-desktop');
    }
  }

  showMainMenu() {
    this.closeAllModals();
    this.el.hud?.classList.add('hidden');
    this.el.screenMenu?.classList.add('active');
  }

  showHUD() {
    this.closeAllModals();
    this.el.screenMenu?.classList.remove('active');
    this.el.hud?.classList.remove('hidden');
    this.updatePedalsVisibility();
  }

  openModal(id) {
    const target = byId(id);
    if (target) target.classList.add('active');
  }

  closeModal(id) {
    const target = byId(id);
    if (target) target.classList.remove('active');
  }

  closeTopSubModalIfOpen() {
    const subs = [this.el.modalMissions, this.el.modalSettings, this.el.modalAbout];
    for (let i = 0; i < subs.length; i++) {
      if (subs[i] && subs[i].classList.contains('active')) {
        subs[i].classList.remove('active');
        return true;
      }
    }
    return false;
  }

  closeAllModals() {
    this.el.modalMissions?.classList.remove('active');
    this.el.modalSettings?.classList.remove('active');
    this.el.modalAbout?.classList.remove('active');
    this.el.modalPause?.classList.remove('active');
    this.el.modalResult?.classList.remove('active');
  }

  openMissionsModal() {
    this.renderMissionsList();
    this.openModal('modal-missions');
  }

  renderMissionsList() {
    const grid = this.el.missionsGrid;
    if (!grid) return;
    grid.innerHTML = '';

    const activeIdx = this.callbacks.getCurrentMissionIndex?.() || 0;

    for (let i = 0; i < MISSIONS.length; i++) {
      const m = MISSIONS[i];
      const best = this.callbacks.getBestScore?.(m.id);
      const starsStr = best
        ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars)
        : '☆☆☆';
      const bestStr = best ? `Best: ${best.score} pts` : 'Not completed';

      const card = document.createElement('button');
      card.type = 'button';
      card.className = `mission-card${i === activeIdx ? ' selected' : ''}`;
      card.innerHTML = `
        <div>
          <div class="mc-top">
            <span class="mc-tag">${m.tag}</span>
            <span class="mc-stars">${starsStr}</span>
          </div>
          <h3 class="mc-title">${m.id}. ${m.title}</h3>
          <p class="mc-desc">${m.instruction}</p>
        </div>
        <div class="mc-bottom">
          <span>${bestStr}</span>
          <span class="mc-play-cta">Start &rarr;</span>
        </div>
      `;
      card.addEventListener('click', () => {
        this.closeModal('modal-missions');
        this.callbacks.onSelectMission?.(i);
      });
      grid.appendChild(card);
    }
  }

  setMissionBanner(mission) {
    if (!mission) return;
    this.el.hudMissionTag.textContent = `MISSION ${mission.id}`;
    this.el.hudMissionTitle.textContent = mission.title;
    this.el.hudMissionDesc.textContent = mission.instruction;
  }

  setCameraLabel(name) {
    if (this.el.hudCameraLabel) {
      this.el.hudCameraLabel.textContent = `Cam: ${name}`;
    }
  }

  triggerCollisionFlash() {
    if (!this.el.collisionFlash) return;
    this.el.collisionFlash.classList.add('active');
    if (this._flashTimeout) clearTimeout(this._flashTimeout);
    this._flashTimeout = setTimeout(() => {
      this.el.collisionFlash.classList.remove('active');
    }, 180);
  }

  showPause(paused) {
    this.el.modalPause?.classList.toggle('active', paused);
  }

  showMissionSuccess(mission, scoreData, hasNext) {
    const { el } = this;
    el.resultBadge.textContent = `MISSION ${mission.id} COMPLETE`;
    el.resultBadge.classList.remove('failed');
    el.resultTitle.textContent = mission.title;
    el.resultStars.classList.remove('hidden');
    el.resultStars.textContent = '★'.repeat(scoreData.stars) + '☆'.repeat(3 - scoreData.stars);

    el.resultBreakdown.classList.remove('hidden');
    el.resultFailMsg.classList.add('hidden');

    el.scoreAccuracy.textContent = `${scoreData.accuracyPct}% (+${scoreData.accuracyPts})`;
    el.scoreTime.textContent = `${scoreData.timeSec}s (+${scoreData.timePts})`;
    el.scoreCollisions.textContent = `${scoreData.collisions} hit${scoreData.collisions === 1 ? '' : 's'} (+${scoreData.cleanPts})`;
    el.scoreTotal.textContent = String(scoreData.totalScore);

    el.btnResultNext.classList.toggle('hidden', !hasNext);
    el.modalResult.classList.add('active');
  }

  showMissionFailed(mission, reason) {
    const { el } = this;
    el.resultBadge.textContent = `MISSION ${mission.id} FAILED`;
    el.resultBadge.classList.add('failed');
    el.resultTitle.textContent = 'Time Expired';
    el.resultStars.classList.add('hidden');
    el.resultBreakdown.classList.add('hidden');
    el.resultFailMsg.textContent = reason;
    el.resultFailMsg.classList.remove('hidden');
    el.btnResultNext.classList.add('hidden');
    el.modalResult.classList.add('active');
  }

  /**
   * High-frequency HUD update called once per animation frame with dirty-checking.
   */
  updateHUD(vehicleState, missionStatus, elapsedSec, timeLimit) {
    const c = this._cache;
    const { el } = this;

    // Speed km/h
    const speedStr = String(Math.round(vehicleState.absSpeedKmh));
    if (c.speed !== speedStr) {
      c.speed = speedStr;
      el.hudSpeed.textContent = speedStr;
    }

    // Current Gear
    if (c.gear !== vehicleState.gear) {
      c.gear = vehicleState.gear;
      el.hudGear.textContent = vehicleState.gear;
      el.hudGearBox.classList.toggle('gear-reverse', vehicleState.gear === 'R');
      el.hudGearBox.classList.toggle('gear-park', vehicleState.gear === 'P');
      for (let i = 0; i < el.gearButtons.length; i++) {
        const b = el.gearButtons[i];
        b.classList.toggle('active', b.getAttribute('data-gear') === vehicleState.gear);
      }
    }

    // Engine RPM
    const rpmRounded = vehicleState.stalled ? 0 : Math.round(vehicleState.rpm / 25) * 25;
    const rpmStr = String(rpmRounded);
    if (c.rpmText !== rpmStr) {
      c.rpmText = rpmStr;
      el.hudRpmText.textContent = rpmStr;
    }

    const rpmPct = Math.round(Math.min(100, (vehicleState.rpm / 6400) * 100));
    if (c.rpmPct !== rpmPct) {
      c.rpmPct = rpmPct;
      el.hudRpmFill.style.width = `${rpmPct}%`;
    }

    // Clutch pedal / engagement
    const clutchPct = Math.round(vehicleState.clutchPedal * 100);
    if (c.clutchPct !== clutchPct) {
      c.clutchPct = clutchPct;
      el.hudClutchFill.style.width = `${clutchPct}%`;
    }

    const clutchLabel = vehicleState.clutchPedal > 0.65
      ? 'OPEN'
      : vehicleState.clutchPedal > 0.2
        ? 'BITE'
        : 'ENG';
    if (c.clutchState !== clutchLabel) {
      c.clutchState = clutchLabel;
      el.hudClutchState.textContent = clutchLabel;
    }

    // Steering wheel visual rotation (GPU transform)
    const wheelDeg = Math.round(vehicleState.steeringWheelDeg * 2) * 0.5;
    if (c.wheelDeg !== wheelDeg) {
      c.wheelDeg = wheelDeg;
      el.wheelSvg.style.transform = `rotate(${wheelDeg}deg)`;
    }

    // Stalled banner
    if (c.stalled !== vehicleState.stalled) {
      c.stalled = vehicleState.stalled;
      el.hudStallBtn.classList.toggle('hidden', !vehicleState.stalled);
    }

    // Transmission shift / lugging feedback toast
    const toastMsg = vehicleState.shiftFeedback ||
      (vehicleState.lugging && !vehicleState.stalled ? 'Low RPM — add Gas [W] or press Clutch [E]!' : '');
    if (c.toast !== toastMsg) {
      c.toast = toastMsg;
      if (toastMsg) {
        el.hudToast.textContent = toastMsg;
        el.hudToast.classList.remove('hidden');
      } else {
        el.hudToast.classList.add('hidden');
      }
    }

    // Timer & Collisions
    const timerStr = timeLimit
      ? `${Math.max(0, timeLimit - elapsedSec).toFixed(1)}s left`
      : `${elapsedSec.toFixed(1)}s`;
    if (c.timer !== timerStr) {
      c.timer = timerStr;
      el.hudTimer.textContent = timerStr;
    }

    if (c.collisions !== vehicleState.collisionCount) {
      c.collisions = vehicleState.collisionCount;
      el.hudCollisions.textContent = `Hits: ${vehicleState.collisionCount}`;
    }

    // Mission alignment & completion progress
    if (c.boundsOk !== missionStatus.insideBounds) {
      c.boundsOk = missionStatus.insideBounds;
      el.badgeBounds.classList.toggle('ok', missionStatus.insideBounds);
    }
    if (c.angleOk !== missionStatus.angleOk) {
      c.angleOk = missionStatus.angleOk;
      el.badgeAngle.classList.toggle('ok', missionStatus.angleOk);
    }
    if (c.stopOk !== missionStatus.speedOk) {
      c.stopOk = missionStatus.speedOk;
      el.badgeStop.classList.toggle('ok', missionStatus.speedOk);
    }

    const progPct = Math.round(missionStatus.progress * 100);
    if (c.progressPct !== progPct) {
      c.progressPct = progPct;
      el.hudProgressFill.style.width = `${progPct}%`;
    }

    if (c.hint !== missionStatus.hint) {
      c.hint = missionStatus.hint;
      el.hudParkHint.textContent = missionStatus.hint;
    }
  }
}

function byId(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null;
}
