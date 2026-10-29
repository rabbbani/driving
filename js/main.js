// js/main.js
// Main game entry point: Three.js scene & renderer management, 3 camera modes,
// fixed-timestep simulation loop, dynamic quality scaling, and lifecycle handling.

import * as THREE from './vendor/three.module.min.js';
import {
  createVehicleState,
  resetVehicleState,
  selectGear,
  restartEngine,
  stepVehiclePhysics
} from './physics.js';
import { SharedCarAssets, PlayerCar } from './car.js';
import { DrivingEnvironment } from './environment.js';
import { MISSIONS, MissionManager } from './missions.js';
import { InputController } from './controls.js';
import { SoundEngine } from './audio.js';
import { UIManager } from './ui.js';

const CAMERA_MODES = [
  { id: 'chase', label: 'Chase', fov: 56 },
  { id: 'hood', label: 'Hood', fov: 62 },
  { id: 'driver', label: 'Driver', fov: 65 }
];

const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 8;

// Pre-allocated vectors for camera calculations (zero per-frame GC allocations)
const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _camCurrentPos = new THREE.Vector3(0, 18, 28);
const _camCurrentLook = new THREE.Vector3(0, 0.8, 0);

export class ParkliteGame {
  constructor() {
    this.state = 'menu'; // 'menu' | 'playing' | 'paused' | 'result'
    this.cameraIndex = 0;
    this.cameraSnapNext = true;

    this.physicsAccum = 0;
    this.animTime = 0;
    this.lastRafTime = 0;
    this.rafId = 0;
    this.pageHidden = false;

    // Rolling FPS monitor for dynamic quality scaling
    this.fpsSampleTime = 0;
    this.fpsSampleFrames = 0;
    this.currentFps = 60;
    this.autoScaleCooldown = 0;

    this.sound = new SoundEngine();
    this.vehicle = createVehicleState(0, 0, 0);

    this._initUI();
    this._initThree();
    this._initControls();

    // Prepare Mission 1 initial placement in background scene
    this.loadMission(0, false);
    this._applySettings(this.ui.settings);
    this._bindLifecycle();

    this.startLoop();
  }

  _initUI() {
    this.ui = new UIManager({
      onPlay: () => {
        this.sound.unlock();
        this.startPlayingMission(this.missions ? this.missions.currentIndex : 0);
      },
      onSelectMission: (idx) => {
        this.sound.unlock();
        this.startPlayingMission(idx);
      },
      onResetCar: () => this.resetCarInMission(),
      onCameraCycle: () => this.cycleCamera(),
      onPauseToggle: () => this.togglePause(),
      onRestartEngine: () => {
        if (restartEngine(this.vehicle)) {
          this.sound.playRestart();
        }
      },
      onResume: () => this.resumeGame(),
      onRestartMission: () => this.startPlayingMission(this.missions.currentIndex),
      onNextMission: () => {
        const nextIdx = (this.missions.currentIndex + 1) % MISSIONS.length;
        this.startPlayingMission(nextIdx);
      },
      onReturnMainMenu: () => this.returnToMainMenu(),
      onSettingsChange: (settings) => this._applySettings(settings),
      getCurrentMissionIndex: () => (this.missions ? this.missions.currentIndex : 0),
      getBestScore: (id) => (this.missions ? this.missions.getBestScore(id) : null)
    });
  }

  _initThree() {
    this.container = document.getElementById('canvas-container');
    this.scene = new THREE.Scene();

    const w = window.innerWidth || 1280;
    const h = window.innerHeight || 720;
    this.camera = new THREE.PerspectiveCamera(56, w / Math.max(1, h), 0.12, 230);

    if (this._hasWebGLSupport()) {
      try {
        this.renderer = new THREE.WebGLRenderer({
          antialias: this.ui.settings.quality !== 'low',
          powerPreference: 'high-performance',
          stencil: false
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = this.ui.settings.quality !== 'low';
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setSize(w, h);
        this.container.appendChild(this.renderer.domElement);
      } catch (err) {
        this.renderer = null;
        this._showWebGLFallback(err);
      }
    } else {
      this.renderer = null;
      this._showWebGLFallback();
    }

    this.sharedCarAssets = new SharedCarAssets();
    this.environment = new DrivingEnvironment(this.scene, this.sharedCarAssets);
    this.playerCar = new PlayerCar(this.sharedCarAssets);
    this.scene.add(this.playerCar.root);

    this.missions = new MissionManager(this.scene);
  }

  _hasWebGLSupport() {
    try {
      const testCanvas = document.createElement('canvas');
      return Boolean(
        testCanvas.getContext('webgl2') ||
        testCanvas.getContext('webgl') ||
        testCanvas.getContext('experimental-webgl')
      );
    } catch (_) {
      return false;
    }
  }

  _showWebGLFallback() {
    if (!this.container) return;
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#f8fafc;padding:24px;text-align:center;font-size:15px;';
    msg.textContent = 'WebGL is required to render the 3D driving view. Please enable hardware acceleration in your browser.';
    this.container.appendChild(msg);
  }

  _initControls() {
    this.controls = new InputController({
      onUserGesture: () => this.sound.unlock(),
      onGearSelect: (gear) => {
        if (this.state !== 'playing') return;
        const result = selectGear(this.vehicle, gear);
        if (result.ok) {
          this.sound.playShift(false);
        } else if (result.grind) {
          this.sound.playShift(true);
        }
      },
      onCameraCycle: () => this.cycleCamera(),
      onResetCar: () => this.resetCarInMission(),
      onPauseToggle: () => this.togglePause()
    });

    this.controls.bindDOM({
      wheelEl: this.ui.el.wheelPad,
      gasEl: this.ui.el.pedalGas,
      brakeEl: this.ui.el.pedalBrake,
      clutchEl: this.ui.el.pedalClutch,
      handbrakeEl: this.ui.el.btnHandbrake,
      gearButtons: this.ui.el.gearButtons
    });
  }

  _applySettings(settings) {
    this.sound.setVolume(settings.volume);
    this.controls.mouseSensitivity = settings.mouseSensitivity;
    this.controls.steeringSensitivity = settings.steeringSensitivity;

    const q = settings.quality;
    this.environment.setQuality(q);
    this.playerCar.setShadowEnabled(q !== 'low');

    if (this.renderer) {
      const dpr = window.devicePixelRatio || 1;
      let targetPR = 1.0;
      if (q === 'low') targetPR = Math.min(dpr, 1.0);
      else if (q === 'medium') targetPR = Math.min(dpr, 1.5);
      else targetPR = Math.min(dpr, 2.0);

      this.renderer.setPixelRatio(targetPR);
      const shouldShadow = q !== 'low';
      if (this.renderer.shadowMap.enabled !== shouldShadow) {
        this.renderer.shadowMap.enabled = shouldShadow;
        this.scene.traverse((obj) => {
          if (obj.isMesh && obj.material) {
            obj.material.needsUpdate = true;
          }
        });
      }
    }

    this.ui.updatePedalsVisibility();
  }

  _bindLifecycle() {
    this._onResize = () => {
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this.renderer) {
        this.renderer.setSize(w, h);
      }
      this.ui.updatePedalsVisibility();
    };

    this._onVisibility = () => {
      this.pageHidden = Boolean(document.hidden);
      if (this.pageHidden) {
        this.sound.setEngineActive(false);
        this.controls.resetTransientInputs();
        if (this.state === 'playing') {
          this.pauseGame();
        }
      } else {
        this.lastRafTime = performance.now();
        if (this.state === 'playing') {
          this.sound.setEngineActive(true);
        }
      }
    };

    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  loadMission(index, resetCollisions = true) {
    const m = this.missions.startMission(index);
    resetVehicleState(this.vehicle, m.start.x, m.start.z, m.start.yaw, 'N');
    if (resetCollisions) {
      this.vehicle.collisionCount = 0;
    }
    this.controls.resetTransientInputs();
    this.physicsAccum = 0;
    this.cameraSnapNext = true;

    const isFirstPerson = CAMERA_MODES[this.cameraIndex].id === 'driver';
    this.playerCar.setFirstPersonMode(isFirstPerson);
    this.playerCar.syncFromPhysics(this.vehicle, isFirstPerson);
    this.ui.setMissionBanner(m);
    return m;
  }

  startPlayingMission(index) {
    this.loadMission(index, true);
    this.state = 'playing';
    this.controls.enabled = true;
    this.sound.setEngineActive(true);
    this.ui.showHUD();
    this._applyCameraModeSpec();
  }

  resetCarInMission() {
    if (this.state !== 'playing') return;
    const m = this.missions.currentMission;
    const prevCollisions = this.vehicle.collisionCount;
    resetVehicleState(this.vehicle, m.start.x, m.start.z, m.start.yaw, 'N');
    this.vehicle.collisionCount = prevCollisions;
    this.vehicle.shiftFeedback = 'Car reset to start position';
    this.vehicle.shiftFeedbackTimer = 1.4;
    this.missions.holdTimer = 0;
    this.controls.resetTransientInputs();
    this.cameraSnapNext = true;
  }

  cycleCamera() {
    this.cameraIndex = (this.cameraIndex + 1) % CAMERA_MODES.length;
    this._applyCameraModeSpec();
  }

  _applyCameraModeSpec() {
    const spec = CAMERA_MODES[this.cameraIndex];
    this.camera.fov = spec.fov;
    this.camera.updateProjectionMatrix();
    const isDriver = spec.id === 'driver';
    this.playerCar.setFirstPersonMode(isDriver && this.state !== 'menu');
    this.ui.setCameraLabel(spec.label);
    this.cameraSnapNext = true;
  }

  togglePause() {
    if (this.ui.closeTopSubModalIfOpen()) {
      return;
    }
    if (this.state === 'playing') {
      this.pauseGame();
    } else if (this.state === 'paused') {
      this.resumeGame();
    }
  }

  pauseGame() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.controls.enabled = false;
    this.controls.resetTransientInputs();
    this.sound.setEngineActive(false);
    this.ui.closeAllModals();
    this.ui.showPause(true);
  }

  resumeGame() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.controls.enabled = true;
    this.sound.setEngineActive(true);
    this.ui.closeAllModals();
    this.lastRafTime = performance.now();
  }

  returnToMainMenu() {
    this.state = 'menu';
    this.controls.enabled = false;
    this.controls.resetTransientInputs();
    this.sound.setEngineActive(false);
    this.playerCar.setFirstPersonMode(false);
    this.ui.showMainMenu();
  }

  startLoop() {
    this.lastRafTime = performance.now();
    const tick = (now) => {
      this.rafId = requestAnimationFrame(tick);
      if (this.pageHidden) return;

      const rawDt = (now - this.lastRafTime) * 0.001;
      this.lastRafTime = now;
      const dt = Math.min(0.1, Math.max(0.0001, rawDt));

      this.stepFrame(dt);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stepFrame(dt) {
    this.animTime += dt;

    if (this.state === 'playing') {
      this._updateDynamicQuality(dt);

      const sampled = this.controls.sampleInputs(dt, this.vehicle.steerInput);

      // Fixed-timestep vehicle physics & collision substeps
      this.physicsAccum = Math.min(this.physicsAccum + dt, FIXED_DT * MAX_SUBSTEPS);
      let collidedFrame = false;
      let stalledFrame = false;
      let maxImpact = 0;

      while (this.physicsAccum >= FIXED_DT) {
        stepVehiclePhysics(this.vehicle, sampled, this.environment.obstacles, FIXED_DT);
        sampled.restartRequested = false;
        this.physicsAccum -= FIXED_DT;

        if (this.vehicle.justCollided) {
          collidedFrame = true;
          maxImpact = Math.max(maxImpact, this.vehicle.lastImpactSpeed);
        }
        if (this.vehicle.justStalled) {
          stalledFrame = true;
        }
      }

      if (collidedFrame) {
        this.sound.playCollision(maxImpact);
        this.ui.triggerCollisionFlash();
      }
      if (stalledFrame) {
        this.sound.playStall();
      }

      const isDriver = CAMERA_MODES[this.cameraIndex].id === 'driver';
      this.playerCar.syncFromPhysics(this.vehicle, isDriver);

      const status = this.missions.update(this.vehicle, dt, this.animTime);
      const curMission = this.missions.currentMission;

      this.sound.updateEngine(
        this.vehicle.rpm,
        this.vehicle.throttle,
        this.vehicle.stalled,
        this.vehicle.lugging
      );

      this.ui.updateHUD(
        this.vehicle,
        status,
        this.missions.elapsedTime,
        curMission.timeLimit
      );

      if (this.missions.completed) {
        this.state = 'result';
        this.controls.enabled = false;
        this.controls.resetTransientInputs();
        this.sound.setEngineActive(false);
        this.sound.playMissionSuccess();
        const hasNext = this.missions.currentIndex < MISSIONS.length - 1;
        this.ui.showMissionSuccess(curMission, status.scoreData, hasNext);
      } else if (this.missions.failed) {
        this.state = 'result';
        this.controls.enabled = false;
        this.controls.resetTransientInputs();
        this.sound.setEngineActive(false);
        this.ui.showMissionFailed(curMission, this.missions.failReason);
      }
    } else if (this.state === 'menu') {
      // Gentle scenic beacon animation while orbiting lot on main menu
      this.missions.beaconMesh.position.y = 2.55 + Math.sin(this.animTime * 2.8) * 0.22;
      this.missions.beaconMesh.rotation.y = this.animTime * 1.1;
    }

    this._updateCamera(dt);

    if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _updateCamera(dt) {
    if (this.state === 'menu') {
      const orbitAngle = this.animTime * 0.14;
      const r = 37;
      _camCurrentPos.set(Math.sin(orbitAngle) * r, 21, Math.cos(orbitAngle) * r);
      _camCurrentLook.set(0, 0.5, -5);
      this.camera.position.copy(_camCurrentPos);
      this.camera.lookAt(_camCurrentLook);
      return;
    }

    const v = this.vehicle;
    const sinY = Math.sin(v.yaw);
    const cosY = Math.cos(v.yaw);
    const fwdX = -sinY;
    const fwdZ = -cosY;
    const rightX = cosY;
    const rightZ = -sinY;

    const modeId = CAMERA_MODES[this.cameraIndex].id;

    if (modeId === 'chase') {
      const reversing = v.gear === 'R' && v.vForward < -0.15;
      const distBehind = reversing ? 7.3 : 6.8;
      const height = reversing ? 3.65 : 3.05;
      const lookAhead = reversing ? 0.5 : 2.6;

      _camTargetPos.set(
        v.x - fwdX * distBehind,
        height + v.heave * 0.4,
        v.z - fwdZ * distBehind
      );
      _camTargetLook.set(
        v.x + fwdX * lookAhead,
        0.92,
        v.z + fwdZ * lookAhead
      );

      if (this.cameraSnapNext) {
        _camCurrentPos.copy(_camTargetPos);
        _camCurrentLook.copy(_camTargetLook);
        this.cameraSnapNext = false;
      } else {
        const aPos = 1 - Math.exp(-9.5 * dt);
        const aLook = 1 - Math.exp(-14.0 * dt);
        _camCurrentPos.lerp(_camTargetPos, aPos);
        _camCurrentLook.lerp(_camTargetLook, aLook);
      }

      this.camera.position.copy(_camCurrentPos);
      this.camera.lookAt(_camCurrentLook);
    } else if (modeId === 'hood') {
      // Mounted just ahead of windshield base (0.92m ahead of center) looking cleanly over the blue hood
      const forwardOffset = 0.92;
      const eyeY = 1.05 + v.heave - v.pitch * 0.4;
      this.camera.position.set(
        v.x + fwdX * forwardOffset,
        eyeY,
        v.z + fwdZ * forwardOffset
      );

      const steerPeek = v.wheelAngle * 1.8;
      _camTargetLook.set(
        v.x + fwdX * 14.0 + rightX * steerPeek,
        0.82 + v.pitch * 6.0,
        v.z + fwdZ * 14.0 + rightZ * steerPeek
      );
      this.camera.lookAt(_camTargetLook);
      this.cameraSnapNext = false;
    } else {
      // First-person driver's seat camera (left-hand drive: localX = -0.38, localZ = -0.02 => +0.02 fwd)
      const localX = -0.38;
      const forwardOffset = 0.02;
      const eyeY = 1.13 + v.heave;

      const worldX = v.x + rightX * localX + fwdX * forwardOffset;
      const worldZ = v.z + rightZ * localX + fwdZ * forwardOffset;
      this.camera.position.set(worldX, eyeY, worldZ);

      const steerGlance = v.wheelAngle * 1.4;
      _camTargetLook.set(
        worldX + fwdX * 12.0 + rightX * steerGlance,
        0.86 + v.pitch * 5.0,
        worldZ + fwdZ * 12.0 + rightZ * steerGlance
      );
      this.camera.lookAt(_camTargetLook);
      this.cameraSnapNext = false;
    }
  }

  _updateDynamicQuality(dt) {
    if (!this.ui.settings.autoQuality) return;
    if (this.autoScaleCooldown > 0) {
      this.autoScaleCooldown -= dt;
      return;
    }

    this.fpsSampleTime += dt;
    this.fpsSampleFrames += 1;

    if (this.fpsSampleTime >= 2.5) {
      this.currentFps = this.fpsSampleFrames / this.fpsSampleTime;
      this.fpsSampleTime = 0;
      this.fpsSampleFrames = 0;

      if (this.currentFps < 42) {
        const curQ = this.ui.settings.quality;
        if (curQ === 'high') {
          this.ui.setQualityUI('medium', true);
          this.autoScaleCooldown = 4.0;
        } else if (curQ === 'medium') {
          this.ui.setQualityUI('low', true);
          this.autoScaleCooldown = 4.0;
        } else if (this.renderer && this.renderer.getPixelRatio() > 0.78) {
          this.renderer.setPixelRatio(0.75);
          this.autoScaleCooldown = 6.0;
        }
      }
    }
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.controls.dispose();
    this.missions.dispose();
    this.playerCar.dispose();
    this.environment.dispose();
    this.sharedCarAssets.dispose();
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}

// Auto-bootstrap in browser
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const boot = () => {
    if (!window.__PARKLITE__) {
      window.__PARKLITE__ = new ParkliteGame();
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
