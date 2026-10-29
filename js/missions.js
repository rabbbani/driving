// js/missions.js
// Parking mission definitions, 3D destination markers, strict alignment/bounds detection, and scoring.

import * as THREE from './vendor/three.module.min.js';
import { CAR_SPECS, wrapAngle, clamp } from './physics.js';

export const MISSIONS = [
  {
    id: 1,
    title: 'Forward Bay Park',
    tag: 'Core 1 · Forward',
    instruction: 'Hold Clutch [E], select 1st Gear [1], release Clutch smoothly with Gas [W], and park inside the bay.',
    start: { x: -3.2, z: -14.5, yaw: 0 },
    target: { x: 0.0, z: -31.0, yaw: 0, width: 3.1, length: 5.5 },
    maxAngleDeg: 12,
    parTime: 26,
    timeLimit: null,
    waypoint: null
  },
  {
    id: 2,
    title: 'Reverse Bay Park',
    tag: 'Core 2 · Reverse',
    instruction: 'Hold Clutch [E], shift into Reverse [R], and back neatly between the two parked cars (nose facing East).',
    start: { x: -30.5, z: -9.4, yaw: 0 },
    target: { x: -37.2, z: -5.2, yaw: -Math.PI / 2, width: 3.3, length: 5.5 },
    maxAngleDeg: 13,
    parTime: 36,
    timeLimit: null,
    waypoint: null
  },
  {
    id: 3,
    title: 'Curbside Parallel Park',
    tag: 'Core 3 · Parallel',
    instruction: 'Pull forward beside the green car in 1st Gear, then shift to Reverse [R] and parallel park by the curb.',
    start: { x: 27.2, z: 3.2, yaw: 0 },
    target: { x: 31.5, z: -4.9, yaw: 0, width: 2.75, length: 6.3 },
    maxAngleDeg: 11,
    parTime: 46,
    timeLimit: null,
    waypoint: null
  },
  {
    id: 4,
    title: 'Narrow Cone Slot',
    tag: 'Bonus 4 · Precision',
    instruction: 'Guide the car cleanly through the traffic cones without collisions and stop centered in the narrow slot.',
    start: { x: -16.5, z: 7.5, yaw: Math.PI },
    target: { x: -23.0, z: 29.5, yaw: Math.PI, width: 2.65, length: 5.3 },
    maxAngleDeg: 10,
    parTime: 34,
    timeLimit: null,
    waypoint: null
  },
  {
    id: 5,
    title: 'Campus Road & Timed Park',
    tag: 'Bonus 5 · Timed Route',
    instruction: 'Drive through the East Avenue checkpoint using gears 1–3, then park in the Examiner Bay within 75s.',
    start: { x: -22.0, z: -21.0, yaw: -Math.PI / 2 },
    waypoint: { x: 22.5, z: -4.0, radius: 7.2, label: 'Drive through the East Avenue checkpoint' },
    target: { x: 14.0, z: 29.5, yaw: Math.PI, width: 3.1, length: 5.5 },
    maxAngleDeg: 12,
    parTime: 42,
    timeLimit: 75
  }
];

export class MissionManager {
  constructor(scene) {
    this.scene = scene;
    this.currentIndex = 0;
    this.elapsedTime = 0;
    this.holdTimer = 0;
    this.holdRequired = 1.05; // seconds car must stay parked cleanly
    this.completed = false;
    this.failed = false;
    this.failReason = '';
    this.waypointReached = true;

    this.status = {
      distance: 0,
      insideBounds: false,
      angleErrorDeg: 0,
      angleOk: false,
      speedOk: false,
      wrongWay: false,
      progress: 0,       // [0..1]
      hint: '',
      scoreData: null
    };

    this.geometries = [];
    this.materials = [];

    this._buildVisualMarkers();
    this.bestScores = this._loadBestScores();
  }

  _geo(g) {
    this.geometries.push(g);
    return g;
  }

  _mat(m) {
    this.materials.push(m);
    return m;
  }

  _loadBestScores() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('parklite_scores_v1') : null;
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  _saveBestScore(missionId, score, stars) {
    const prev = this.bestScores[missionId];
    if (!prev || score > prev.score) {
      this.bestScores[missionId] = { score, stars };
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('parklite_scores_v1', JSON.stringify(this.bestScores));
        }
      } catch (_) {
        // Ignore storage quota/privacy restrictions
      }
    }
  }

  getBestScore(missionId) {
    return this.bestScores[missionId] || null;
  }

  _buildVisualMarkers() {
    this.markerRoot = new THREE.Group();
    this.scene.add(this.markerRoot);

    this.borderMat = this._mat(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.9
      })
    );
    this.padFillMat = this._mat(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide
      })
    );
    this.arrowMat = this._mat(
      new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide
      })
    );

    // Bay group positioned & scaled dynamically per mission
    this.bayGroup = new THREE.Group();
    this.markerRoot.add(this.bayGroup);

    const fillGeo = this._geo(new THREE.PlaneGeometry(1, 1));
    fillGeo.rotateX(-Math.PI / 2);
    this.padFillMesh = new THREE.Mesh(fillGeo, this.padFillMat);
    this.padFillMesh.position.y = 0.022;
    this.bayGroup.add(this.padFillMesh);

    // 4 crisp boundary bars
    const barGeo = this._geo(new THREE.BoxGeometry(1, 0.06, 1));
    this.barLeft = new THREE.Mesh(barGeo, this.borderMat);
    this.barRight = new THREE.Mesh(barGeo, this.borderMat);
    this.barFront = new THREE.Mesh(barGeo, this.borderMat);
    this.barBack = new THREE.Mesh(barGeo, this.borderMat);
    this.bayGroup.add(this.barLeft, this.barRight, this.barFront, this.barBack);

    // 4 low corner posts for clear 3D depth visibility from Driver/Hood cameras
    const postGeo = this._geo(new THREE.CylinderGeometry(0.055, 0.055, 0.52, 8));
    this.cornerPosts = [];
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(postGeo, this.borderMat);
      p.position.y = 0.26;
      this.cornerPosts.push(p);
      this.bayGroup.add(p);
    }

    // Directional nose arrow inside bay (points toward local -Z = car front!)
    this.arrowGroup = new THREE.Group();
    const shaftGeo = this._geo(new THREE.PlaneGeometry(0.38, 1.55));
    shaftGeo.rotateX(-Math.PI / 2);
    const shaft = new THREE.Mesh(shaftGeo, this.arrowMat);
    shaft.position.set(0, 0.028, 0.35);

    const headShape = new THREE.Shape();
    headShape.moveTo(0, 0.85);
    headShape.lineTo(-0.62, -0.15);
    headShape.lineTo(0.62, -0.15);
    headShape.closePath();
    const headGeo = this._geo(new THREE.ShapeGeometry(headShape));
    headGeo.rotateX(-Math.PI / 2);
    const head = new THREE.Mesh(headGeo, this.arrowMat);
    head.position.set(0, 0.028, -0.55);

    this.arrowGroup.add(shaft, head);
    this.bayGroup.add(this.arrowGroup);

    // Floating overhead destination chevron
    this.beaconMesh = new THREE.Mesh(
      this._geo(new THREE.ConeGeometry(0.48, 0.95, 4)),
      this.borderMat
    );
    this.beaconMesh.rotation.x = Math.PI; // point downward at bay
    this.bayGroup.add(this.beaconMesh);

    // Optional Route Waypoint Ring (used by Mission 5)
    this.waypointGroup = new THREE.Group();
    const wpMat = this._mat(
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    const ringGeo = this._geo(new THREE.RingGeometry(3.2, 3.65, 24));
    ringGeo.rotateX(-Math.PI / 2);
    const ringMesh = new THREE.Mesh(ringGeo, wpMat);
    ringMesh.position.y = 0.03;

    const wpBeacon = new THREE.Mesh(this._geo(new THREE.OctahedronGeometry(0.55, 0)), wpMat);
    wpBeacon.position.y = 2.6;
    this.wpBeacon = wpBeacon;

    this.waypointGroup.add(ringMesh, wpBeacon);
    this.waypointGroup.visible = false;
    this.markerRoot.add(this.waypointGroup);
  }

  get currentMission() {
    return MISSIONS[this.currentIndex];
  }

  startMission(index) {
    this.currentIndex = clamp(index, 0, MISSIONS.length - 1);
    const m = this.currentMission;

    this.elapsedTime = 0;
    this.holdTimer = 0;
    this.completed = false;
    this.failed = false;
    this.failReason = '';
    this.waypointReached = !m.waypoint;

    this.status.progress = 0;
    this.status.insideBounds = false;
    this.status.angleOk = false;
    this.status.speedOk = false;
    this.status.wrongWay = false;
    this.status.scoreData = null;
    this.status.hint = m.waypoint ? m.waypoint.label : 'Drive into the marked bay';

    // Configure 3D bay marker geometry transforms
    const t = m.target;
    this.bayGroup.position.set(t.x, 0, t.z);
    this.bayGroup.rotation.y = t.yaw;

    const w = t.width;
    const l = t.length;
    const bw = 0.13;

    this.padFillMesh.scale.set(w - bw, 1, l - bw);

    this.barLeft.scale.set(bw, 1, l);
    this.barLeft.position.set(-w * 0.5, 0.03, 0);

    this.barRight.scale.set(bw, 1, l);
    this.barRight.position.set(w * 0.5, 0.03, 0);

    this.barFront.scale.set(w + bw, 1, bw);
    this.barFront.position.set(0, 0.03, -l * 0.5);

    this.barBack.scale.set(w + bw, 1, bw);
    this.barBack.position.set(0, 0.03, l * 0.5);

    const corners = [
      [-w * 0.5, -l * 0.5],
      [w * 0.5, -l * 0.5],
      [-w * 0.5, l * 0.5],
      [w * 0.5, l * 0.5]
    ];
    for (let i = 0; i < 4; i++) {
      this.cornerPosts[i].position.set(corners[i][0], 0.26, corners[i][1]);
    }

    if (m.waypoint) {
      this.waypointGroup.position.set(m.waypoint.x, 0, m.waypoint.z);
      this.waypointGroup.visible = true;
    } else {
      this.waypointGroup.visible = false;
    }

    this._setMarkerColor(0x38bdf8);
    return m;
  }

  _setMarkerColor(hex) {
    if (this._lastColor === hex) return;
    this._lastColor = hex;
    this.borderMat.color.setHex(hex);
    this.padFillMat.color.setHex(hex);
  }

  update(vehicleState, dt, animTime) {
    const m = this.currentMission;

    // Animate floating beacons smoothly
    this.beaconMesh.position.y = 2.55 + Math.sin(animTime * 3.2) * 0.24;
    this.beaconMesh.rotation.y = animTime * 1.4;
    if (this.waypointGroup.visible) {
      this.wpBeacon.position.y = 2.5 + Math.sin(animTime * 3.6) * 0.22;
      this.wpBeacon.rotation.y = -animTime * 1.8;
    }

    if (this.completed || this.failed) {
      return this.status;
    }

    this.elapsedTime += dt;

    // Optional time limit check
    if (m.timeLimit && this.elapsedTime >= m.timeLimit) {
      this.failed = true;
      this.failReason = `Time limit (${m.timeLimit}s) reached!`;
      this.status.hint = this.failReason;
      this._setMarkerColor(0xef4444);
      return this.status;
    }

    // Waypoint check (Mission 5)
    if (!this.waypointReached && m.waypoint) {
      const wdx = vehicleState.x - m.waypoint.x;
      const wdz = vehicleState.z - m.waypoint.z;
      const wpDist = Math.hypot(wdx, wdz);
      this.status.distance = wpDist;
      if (wpDist <= m.waypoint.radius) {
        this.waypointReached = true;
        this.waypointGroup.visible = false;
      } else {
        this.status.insideBounds = false;
        this.status.angleOk = false;
        this.status.speedOk = false;
        this.status.progress = 0;
        this.status.hint = `${m.waypoint.label} (${Math.ceil(wpDist)}m)`;
        this._setMarkerColor(0xf59e0b);
        return this.status;
      }
    }

    // Evaluate car relative to target parking bay
    const t = m.target;
    const dx = vehicleState.x - t.x;
    const dz = vehicleState.z - t.z;
    const dist = Math.hypot(dx, dz);
    this.status.distance = dist;

    // Transform offset into bay's local right (+X) and forward (-Z) axes
    const cosB = Math.cos(t.yaw);
    const sinB = Math.sin(t.yaw);
    const rightX = cosB;
    const rightZ = -sinB;
    const fwdX = -sinB;
    const fwdZ = -cosB;

    const localLat = dx * rightX + dz * rightZ;     // lateral center offset
    const localLong = dx * fwdX + dz * fwdZ;        // longitudinal center offset

    // Angle difference from bay's required nose direction
    const rawAngleDiff = Math.abs(wrapAngle(vehicleState.yaw - t.yaw));
    const angleErrorDeg = rawAngleDiff * (180 / Math.PI);
    this.status.angleErrorDeg = angleErrorDeg;
    this.status.wrongWay = angleErrorDeg > 115;

    // Check all 4 car corners inside bay bounds (plus small painted-line width tolerance)
    const relYaw = vehicleState.yaw - t.yaw;
    const cRel = Math.cos(relYaw);
    const sRel = Math.sin(relYaw);
    const extLat = CAR_SPECS.halfWidth * Math.abs(cRel) + CAR_SPECS.halfLength * Math.abs(sRel);
    const extLong = CAR_SPECS.halfWidth * Math.abs(sRel) + CAR_SPECS.halfLength * Math.abs(cRel);

    const maxHalfW = t.width * 0.5 + 0.12;
    const maxHalfL = t.length * 0.5 + 0.16;

    const insideBounds =
      Math.abs(localLat) + extLat <= maxHalfW &&
      Math.abs(localLong) + extLong <= maxHalfL;

    const angleOk = angleErrorDeg <= m.maxAngleDeg;
    const speedOk = vehicleState.absSpeedKmh <= 1.25;

    this.status.insideBounds = insideBounds;
    this.status.angleOk = angleOk;
    this.status.speedOk = speedOk;

    if (insideBounds && angleOk && speedOk) {
      // Bonus faster lock-in if player shifted to Park (P) or pulled Handbrake
      const rateBoost = (vehicleState.gear === 'P' || vehicleState.handbrake) ? 1.45 : 1.0;
      this.holdTimer = Math.min(this.holdRequired, this.holdTimer + dt * rateBoost);
      this.status.progress = this.holdTimer / this.holdRequired;
      this.status.hint = 'Hold steady — completing park...';
      this._setMarkerColor(0x10b981);

      if (this.holdTimer >= this.holdRequired) {
        this.completed = true;
        this.status.progress = 1;
        this.status.scoreData = this._computeScore(m, localLat, localLong, angleErrorDeg, vehicleState.collisionCount);
        this._saveBestScore(m.id, this.status.scoreData.totalScore, this.status.scoreData.stars);
        this.status.hint = 'Parking Complete!';
      }
    } else {
      this.holdTimer = Math.max(0, this.holdTimer - dt * 2.2);
      this.status.progress = this.holdTimer / this.holdRequired;

      if (dist > 6.5) {
        this.status.hint = `Approach target bay (${Math.round(dist)}m)`;
        this._setMarkerColor(0x38bdf8);
      } else if (this.status.wrongWay) {
        this.status.hint = 'Wrong direction — align nose with bay arrow';
        this._setMarkerColor(0xf59e0b);
      } else if (!insideBounds) {
        this.status.hint = 'Pull fully inside the painted lines';
        this._setMarkerColor(0xfbbf24);
      } else if (!angleOk) {
        this.status.hint = `Straighten car (${Math.round(angleErrorDeg)}° off)`;
        this._setMarkerColor(0xfbbf24);
      } else {
        this.status.hint = 'Brake to a stop inside the bay';
        this._setMarkerColor(0x34d399);
      }
    }

    return this.status;
  }

  _computeScore(mission, latErr, longErr, angleErrDeg, collisions) {
    // 1. Accuracy (up to 500 pts + percentage)
    const maxLatSlack = Math.max(0.25, mission.target.width * 0.5 - CAR_SPECS.halfWidth + 0.12);
    const maxLongSlack = Math.max(0.30, mission.target.length * 0.5 - CAR_SPECS.halfLength + 0.16);

    const latScoreNorm = clamp(1 - Math.abs(latErr) / (maxLatSlack * 1.15), 0, 1);
    const longScoreNorm = clamp(1 - Math.abs(longErr) / (maxLongSlack * 1.15), 0, 1);
    const angScoreNorm = clamp(1 - angleErrDeg / (mission.maxAngleDeg * 1.25), 0, 1);

    const accuracyPct = Math.round((latScoreNorm * 0.42 + longScoreNorm * 0.30 + angScoreNorm * 0.28) * 100);
    const accuracyPts = Math.round(accuracyPct * 5); // 0..500

    // 2. Time score (up to 300 pts)
    const overTime = Math.max(0, this.elapsedTime - mission.parTime);
    const timePts = Math.round(300 * clamp(1 - overTime / (mission.parTime * 1.6), 0.15, 1));

    // 3. Collision-free bonus (200 pts minus 65 per collision)
    const cleanPts = Math.max(0, 200 - collisions * 65);

    const totalScore = accuracyPts + timePts + cleanPts;
    let stars = 1;
    if (totalScore >= 820 && collisions === 0) stars = 3;
    else if (totalScore >= 600) stars = 2;

    return {
      accuracyPct,
      accuracyPts,
      timeSec: Number(this.elapsedTime.toFixed(1)),
      parTime: mission.parTime,
      timePts,
      collisions,
      cleanPts,
      totalScore,
      stars
    };
  }

  dispose() {
    for (let i = 0; i < this.geometries.length; i++) this.geometries[i].dispose();
    for (let i = 0; i < this.materials.length; i++) this.materials[i].dispose();
    this.scene.remove(this.markerRoot);
  }
}
