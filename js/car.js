// js/car.js
// Low-poly 3D player vehicle, shared-geometry parked cars, and lightweight 1st-person dashboard cockpit.

import * as THREE from './vendor/three.module.min.js';

export class SharedCarAssets {
  constructor() {
    this.geometries = [];
    this.materials = [];

    // Shared wheel geometry (cylinder oriented along X axis)
    this.tireGeo = this._trackGeo(new THREE.CylinderGeometry(0.33, 0.33, 0.23, 14));
    this.tireGeo.rotateZ(Math.PI / 2);

    this.hubGeo = this._trackGeo(new THREE.CylinderGeometry(0.19, 0.19, 0.242, 10));
    this.hubGeo.rotateZ(Math.PI / 2);

    this.spokeGeo = this._trackGeo(new THREE.BoxGeometry(0.246, 0.30, 0.05));

    // Shared chassis & trim geometries for parked + player cars
    this.lowerBodyGeo = this._trackGeo(new THREE.BoxGeometry(1.80, 0.50, 4.24));
    this.bumperGeo = this._trackGeo(new THREE.BoxGeometry(1.84, 0.22, 0.18));
    this.cabinGeo = this._trackGeo(new THREE.BoxGeometry(1.56, 0.48, 2.08));
    this.headlightGeo = this._trackGeo(new THREE.BoxGeometry(0.32, 0.13, 0.06));
    this.grilleGeo = this._trackGeo(new THREE.BoxGeometry(0.84, 0.16, 0.05));
    this.mirrorGeo = this._trackGeo(new THREE.BoxGeometry(0.16, 0.10, 0.12));

    // Shared materials
    this.tireMat = this._trackMat(new THREE.MeshLambertMaterial({ color: 0x1e2229 }));
    this.hubMat = this._trackMat(new THREE.MeshLambertMaterial({ color: 0xd8dee9 }));
    this.spokeMat = this._trackMat(new THREE.MeshLambertMaterial({ color: 0x8e99a8 }));
    this.trimMat = this._trackMat(new THREE.MeshLambertMaterial({ color: 0x262b34 }));
    this.glassMat = this._trackMat(new THREE.MeshLambertMaterial({ color: 0x2f4358 }));
    this.headlightMat = this._trackMat(
      new THREE.MeshBasicMaterial({ color: 0xfff8dc })
    );
    this.parkedTailMat = this._trackMat(
      new THREE.MeshLambertMaterial({ color: 0x992626 })
    );
  }

  _trackGeo(g) {
    this.geometries.push(g);
    return g;
  }

  _trackMat(m) {
    this.materials.push(m);
    return m;
  }

  createWheel(castShadow = true) {
    const group = new THREE.Group();
    const tire = new THREE.Mesh(this.tireGeo, this.tireMat);
    const hub = new THREE.Mesh(this.hubGeo, this.hubMat);
    const spoke = new THREE.Mesh(this.spokeGeo, this.spokeMat);
    tire.castShadow = castShadow;
    group.add(tire, hub, spoke);
    return group;
  }

  createParkedCar(colorHex, castShadow = true) {
    const root = new THREE.Group();
    const paintMat = this._trackMat(new THREE.MeshLambertMaterial({ color: colorHex }));

    const body = new THREE.Mesh(this.lowerBodyGeo, paintMat);
    body.position.set(0, 0.52, 0);
    body.castShadow = castShadow;
    body.receiveShadow = true;
    root.add(body);

    // Cabin greenhouse + roof cap
    const cabinGlass = new THREE.Mesh(this.cabinGeo, this.glassMat);
    cabinGlass.position.set(0, 0.96, 0.18);
    cabinGlass.castShadow = castShadow;
    root.add(cabinGlass);

    const roofGeo = this._trackGeo(new THREE.BoxGeometry(1.48, 0.08, 1.88));
    const roof = new THREE.Mesh(roofGeo, paintMat);
    roof.position.set(0, 1.22, 0.18);
    roof.castShadow = castShadow;
    root.add(roof);

    // Bumpers & lights
    const frontBumper = new THREE.Mesh(this.bumperGeo, this.trimMat);
    frontBumper.position.set(0, 0.34, -2.08);
    const rearBumper = new THREE.Mesh(this.bumperGeo, this.trimMat);
    rearBumper.position.set(0, 0.34, 2.08);
    root.add(frontBumper, rearBumper);

    const hlLeft = new THREE.Mesh(this.headlightGeo, this.headlightMat);
    hlLeft.position.set(-0.62, 0.56, -2.11);
    const hlRight = new THREE.Mesh(this.headlightGeo, this.headlightMat);
    hlRight.position.set(0.62, 0.56, -2.11);

    const tlLeft = new THREE.Mesh(this.headlightGeo, this.parkedTailMat);
    tlLeft.position.set(-0.62, 0.58, 2.11);
    const tlRight = new THREE.Mesh(this.headlightGeo, this.parkedTailMat);
    tlRight.position.set(0.62, 0.58, 2.11);
    root.add(hlLeft, hlRight, tlLeft, tlRight);

    // 4 wheels
    const wheelOffsets = [
      [-0.83, 0.33, -1.30],
      [0.83, 0.33, -1.30],
      [-0.83, 0.33, 1.30],
      [0.83, 0.33, 1.30]
    ];
    for (let i = 0; i < wheelOffsets.length; i++) {
      const w = this.createWheel(castShadow);
      w.position.set(wheelOffsets[i][0], wheelOffsets[i][1], wheelOffsets[i][2]);
      root.add(w);
    }

    return root;
  }

  dispose() {
    for (let i = 0; i < this.geometries.length; i++) this.geometries[i].dispose();
    for (let i = 0; i < this.materials.length; i++) this.materials[i].dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}

export class PlayerCar {
  constructor(sharedAssets) {
    this.shared = sharedAssets;
    this.localGeos = [];
    this.localMats = [];

    this.root = new THREE.Group();
    this.bodyPivot = new THREE.Group();
    this.bodyPivot.position.set(0, 0.35, 0);
    this.root.add(this.bodyPivot);

    // Crisp sunlit driving-school cobalt/amber styling
    const bodyPaint = this._mat(new THREE.MeshLambertMaterial({ color: 0x2563eb }));
    const accentPaint = this._mat(new THREE.MeshLambertMaterial({ color: 0xf8fafc }));

    // Sculpted lower body + hood slope
    const mainChassis = new THREE.Mesh(sharedAssets.lowerBodyGeo, bodyPaint);
    mainChassis.position.set(0, 0.18, 0);
    mainChassis.castShadow = true;
    mainChassis.receiveShadow = true;
    this.bodyPivot.add(mainChassis);

    // Clean white driving-academy side stripe
    const stripeGeo = this._geo(new THREE.BoxGeometry(1.82, 0.08, 2.9));
    const stripe = new THREE.Mesh(stripeGeo, accentPaint);
    stripe.position.set(0, 0.19, 0.05);
    this.bodyPivot.add(stripe);

    // Hood contour visible in Hood & Driver cameras
    const hoodGeo = this._geo(new THREE.BoxGeometry(1.52, 0.06, 1.18));
    const hood = new THREE.Mesh(hoodGeo, bodyPaint);
    hood.position.set(0, 0.45, -1.42);
    hood.castShadow = true;
    this.bodyPivot.add(hood);

    // Bumpers, grille & side mirrors
    const fBumper = new THREE.Mesh(sharedAssets.bumperGeo, sharedAssets.trimMat);
    fBumper.position.set(0, 0.0, -2.08);
    const rBumper = new THREE.Mesh(sharedAssets.bumperGeo, sharedAssets.trimMat);
    rBumper.position.set(0, 0.0, 2.08);
    const grille = new THREE.Mesh(sharedAssets.grilleGeo, sharedAssets.trimMat);
    grille.position.set(0, 0.16, -2.11);

    const mirrorL = new THREE.Mesh(sharedAssets.mirrorGeo, bodyPaint);
    mirrorL.position.set(-0.96, 0.50, -0.68);
    const mirrorR = new THREE.Mesh(sharedAssets.mirrorGeo, bodyPaint);
    mirrorR.position.set(0.96, 0.50, -0.68);

    this.bodyPivot.add(fBumper, rBumper, grille, mirrorL, mirrorR);

    // Headlights
    const hlL = new THREE.Mesh(sharedAssets.headlightGeo, sharedAssets.headlightMat);
    hlL.position.set(-0.62, 0.24, -2.11);
    const hlR = new THREE.Mesh(sharedAssets.headlightGeo, sharedAssets.headlightMat);
    hlR.position.set(0.62, 0.24, -2.11);
    this.bodyPivot.add(hlL, hlR);

    // Dynamic Brake Lights & Reverse Lights
    this.brakeLightMat = this._mat(new THREE.MeshBasicMaterial({ color: 0x7f1d1d }));
    this.reverseLightMat = this._mat(new THREE.MeshBasicMaterial({ color: 0x475569 }));

    const blL = new THREE.Mesh(sharedAssets.headlightGeo, this.brakeLightMat);
    blL.position.set(-0.62, 0.25, 2.11);
    const blR = new THREE.Mesh(sharedAssets.headlightGeo, this.brakeLightMat);
    blR.position.set(0.62, 0.25, 2.11);

    const revGeo = this._geo(new THREE.BoxGeometry(0.18, 0.09, 0.06));
    const rlL = new THREE.Mesh(revGeo, this.reverseLightMat);
    rlL.position.set(-0.36, 0.25, 2.115);
    const rlR = new THREE.Mesh(revGeo, this.reverseLightMat);
    rlR.position.set(0.36, 0.25, 2.115);
    this.bodyPivot.add(blL, blR, rlL, rlR);

    // Exterior cabin group (hidden in 1st-person mode for clean unobstructed windshield view)
    this.exteriorCabin = new THREE.Group();
    const glass = new THREE.Mesh(sharedAssets.cabinGeo, sharedAssets.glassMat);
    glass.position.set(0, 0.62, 0.16);
    glass.castShadow = true;

    const roofGeo = this._geo(new THREE.BoxGeometry(1.48, 0.08, 1.90));
    const roof = new THREE.Mesh(roofGeo, accentPaint);
    roof.position.set(0, 0.88, 0.16);
    roof.castShadow = true;

    // Small rooftop driving school "L" / Academy beacon sign
    const signGeo = this._geo(new THREE.BoxGeometry(0.46, 0.15, 0.22));
    const signMat = this._mat(new THREE.MeshLambertMaterial({ color: 0xf59e0b }));
    const topper = new THREE.Mesh(signGeo, signMat);
    topper.position.set(0, 0.99, -0.05);

    this.exteriorCabin.add(glass, roof, topper);
    this.bodyPivot.add(this.exteriorCabin);

    // Lightweight 1st-Person Driver Cockpit (shown in Camera Mode 3)
    this.cockpitGroup = this._buildCockpit();
    this.cockpitGroup.visible = false;
    this.bodyPivot.add(this.cockpitGroup);

    // Wheels (Front steer pivots + Rear spin meshes)
    this.frontLeftPivot = new THREE.Group();
    this.frontLeftPivot.position.set(-0.83, 0.33, -1.31);
    this.frontLeftWheel = sharedAssets.createWheel(true);
    this.frontLeftPivot.add(this.frontLeftWheel);

    this.frontRightPivot = new THREE.Group();
    this.frontRightPivot.position.set(0.83, 0.33, -1.31);
    this.frontRightWheel = sharedAssets.createWheel(true);
    this.frontRightPivot.add(this.frontRightWheel);

    this.rearLeftWheel = sharedAssets.createWheel(true);
    this.rearLeftWheel.position.set(-0.83, 0.33, 1.31);

    this.rearRightWheel = sharedAssets.createWheel(true);
    this.rearRightWheel.position.set(0.83, 0.33, 1.31);

    this.root.add(
      this.frontLeftPivot,
      this.frontRightPivot,
      this.rearLeftWheel,
      this.rearRightWheel
    );

    // Cache last cockpit readout values so we only redraw the tiny dash canvas when values change
    this._lastDashKey = '';
    this._lastBrakeLit = false;
    this._lastRevLit = false;
  }

  _geo(g) {
    this.localGeos.push(g);
    return g;
  }

  _mat(m) {
    this.localMats.push(m);
    return m;
  }

  _buildCockpit() {
    const group = new THREE.Group();
    const dashMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x1e2430 }));
    const pillarMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x2c3444 }));
    const rimMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x11151c }));
    const markerMat = this._mat(new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));

    // Dashboard shelf
    const dashBoard = new THREE.Mesh(this._geo(new THREE.BoxGeometry(1.52, 0.28, 0.52)), dashMat);
    dashBoard.position.set(0, 0.44, -0.68);
    group.add(dashBoard);

    // Instrument binnacle hood above cluster
    const binnacle = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.46, 0.14, 0.28)), pillarMat);
    binnacle.position.set(-0.38, 0.60, -0.66);
    group.add(binnacle);

    // Slim A-pillars for spatial framing without blocking sightlines
    const pillarGeo = this._geo(new THREE.BoxGeometry(0.055, 0.56, 0.065));
    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-0.74, 0.78, -0.66);
    leftPillar.rotation.x = 0.48;
    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(0.74, 0.78, -0.66);
    rightPillar.rotation.x = 0.48;

    const headerBar = new THREE.Mesh(this._geo(new THREE.BoxGeometry(1.54, 0.05, 0.14)), pillarMat);
    headerBar.position.set(0, 1.03, -0.50);
    group.add(leftPillar, rightPillar, headerBar);

    // Dynamic Digital Instrument Cluster Screen (gear + speed + RPM)
    this.dashCanvas = (typeof document !== 'undefined' && document.createElement)
      ? document.createElement('canvas')
      : null;
    if (this.dashCanvas && this.dashCanvas.getContext) {
      this.dashCanvas.width = 256;
      this.dashCanvas.height = 128;
      this.dashCtx = this.dashCanvas.getContext('2d');
      this.dashTexture = new THREE.CanvasTexture(this.dashCanvas);
      this.dashTexture.minFilter = THREE.LinearFilter;
      const screenMat = this._mat(new THREE.MeshBasicMaterial({ map: this.dashTexture }));
      const screen = new THREE.Mesh(this._geo(new THREE.PlaneGeometry(0.36, 0.16)), screenMat);
      screen.position.set(-0.38, 0.58, -0.515);
      screen.rotation.x = -0.18;
      group.add(screen);
    }

    // 3D Steering Column & Rotating Steering Wheel
    const columnPivot = new THREE.Group();
    columnPivot.position.set(-0.38, 0.57, -0.37);
    columnPivot.rotation.x = -0.36; // comfortable 20-deg tilt toward driver
    group.add(columnPivot);

    const shaft = new THREE.Mesh(this._geo(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 8)), pillarMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0, -0.09);
    columnPivot.add(shaft);

    this.steeringWheel3D = new THREE.Group();
    const torus = new THREE.Mesh(this._geo(new THREE.TorusGeometry(0.165, 0.021, 8, 24)), rimMat);
    const hub = new THREE.Mesh(this._geo(new THREE.CylinderGeometry(0.052, 0.052, 0.032, 12)), pillarMat);
    hub.rotation.x = Math.PI / 2;
    const spokeH = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.30, 0.026, 0.02)), pillarMat);
    const spokeV = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.028, 0.15, 0.02)), pillarMat);
    spokeV.position.set(0, -0.08, 0);
    // Top-center alignment band so rotation is unmistakable
    const topBand = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.026, 0.048, 0.046)), markerMat);
    topBand.position.set(0, 0.165, 0);

    this.steeringWheel3D.add(torus, hub, spokeH, spokeV, topBand);
    columnPivot.add(this.steeringWheel3D);

    return group;
  }

  _updateDashCanvas(gear, speedInt, rpmBucket, stalled) {
    if (!this.dashCtx || !this.dashTexture) return;
    const key = `${gear}|${speedInt}|${rpmBucket}|${stalled ? 1 : 0}`;
    if (key === this._lastDashKey) return;
    this._lastDashKey = key;

    const ctx = this.dashCtx;
    ctx.fillStyle = '#0d131f';
    ctx.fillRect(0, 0, 256, 128);

    // Subtle border
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 252, 124);

    // Gear badge on left
    ctx.fillStyle = gear === 'R' ? '#f59e0b' : gear === 'P' ? '#64748b' : '#10b981';
    ctx.fillRect(14, 18, 64, 70);
    ctx.fillStyle = '#090d16';
    ctx.font = 'bold 46px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(gear, 46, 55);

    // Speed km/h on right
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(String(speedInt), 205, 48);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('km/h', 244, 54);

    if (stalled) {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('STALLED', 92, 82);
    }

    // RPM bar across bottom
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(14, 100, 228, 14);
    const frac = Math.max(0, Math.min(1, (rpmBucket * 100) / 6500));
    ctx.fillStyle = frac > 0.85 ? '#ef4444' : '#38bdf8';
    ctx.fillRect(14, 100, Math.round(228 * frac), 14);

    this.dashTexture.needsUpdate = true;
  }

  setFirstPersonMode(isFirstPerson) {
    this.exteriorCabin.visible = !isFirstPerson;
    this.cockpitGroup.visible = Boolean(isFirstPerson);
  }

  setShadowEnabled(enabled) {
    this.root.traverse((obj) => {
      if (obj.isMesh && obj !== this.exteriorCabin) {
        if (obj.material && !obj.material.isMeshBasicMaterial) {
          obj.castShadow = enabled;
        }
      }
    });
  }

  syncFromPhysics(state, isFirstPerson) {
    this.root.position.set(state.x, 0, state.z);
    this.root.rotation.y = state.yaw;

    // Suspension pitch, roll, and heave
    this.bodyPivot.position.y = 0.35 + state.heave;
    this.bodyPivot.rotation.x = -state.pitch;
    this.bodyPivot.rotation.z = state.roll;

    // Front wheel steer & 4-wheel rolling spin
    this.frontLeftPivot.rotation.y = -state.wheelAngle;
    this.frontRightPivot.rotation.y = -state.wheelAngle;

    const spin = -state.wheelSpinRad;
    this.frontLeftWheel.rotation.x = spin;
    this.frontRightWheel.rotation.x = spin;
    this.rearLeftWheel.rotation.x = spin;
    this.rearRightWheel.rotation.x = spin;

    // Brake & Reverse light states
    const brakeLit = state.brake > 0.08 || state.handbrake || state.gear === 'P';
    if (brakeLit !== this._lastBrakeLit) {
      this._lastBrakeLit = brakeLit;
      this.brakeLightMat.color.setHex(brakeLit ? 0xff2a2a : 0x6e1818);
    }

    const revLit = state.gear === 'R';
    if (revLit !== this._lastRevLit) {
      this._lastRevLit = revLit;
      this.reverseLightMat.color.setHex(revLit ? 0xf8fafc : 0x475569);
    }

    // 1st-person cockpit steering wheel & dashboard screen
    if (isFirstPerson && this.steeringWheel3D) {
      this.steeringWheel3D.rotation.z = -THREE.MathUtils.degToRad(state.steeringWheelDeg);
      this._updateDashCanvas(
        state.gear,
        Math.round(state.absSpeedKmh),
        Math.round(state.rpm / 100),
        state.stalled
      );
    }
  }

  dispose() {
    for (let i = 0; i < this.localGeos.length; i++) this.localGeos[i].dispose();
    for (let i = 0; i < this.localMats.length; i++) this.localMats[i].dispose();
    if (this.dashTexture) this.dashTexture.dispose();
  }
}
