// js/environment.js
// Compact, stylized low-poly 3D driving school parking lot using shared geometries, materials,
// and THREE.InstancedMesh for crisp 60 FPS rendering and minimal draw calls.

import * as THREE from './vendor/three.module.min.js';
import { makeStaticOBB, CAR_SPECS } from './physics.js';

export class DrivingEnvironment {
  constructor(scene, sharedCarAssets) {
    this.scene = scene;
    this.sharedCarAssets = sharedCarAssets;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.geometries = [];
    this.materials = [];
    this.textures = [];
    this.obstacles = [];
    this.shadowCasters = [];
    this.outerDecorGroup = new THREE.Group();
    this.root.add(this.outerDecorGroup);

    this._setupLightingAndSky();
    this._buildGroundAndLot();
    this._buildPerimeterWalls();
    this._buildBuildingsAndIslands();
    this._buildRoadMarkingsInstanced();
    this._buildParkedCars();
    this._buildConesAndBarriersInstanced();
    this._buildTreesInstanced();
  }

  _geo(g) {
    this.geometries.push(g);
    return g;
  }

  _mat(m) {
    this.materials.push(m);
    return m;
  }

  _tex(t) {
    this.textures.push(t);
    return t;
  }

  _setupLightingAndSky() {
    // Warm sunlit sky color + gentle distance fog for clean Drune.io-style atmosphere
    this.scene.background = new THREE.Color(0x9bd3f5);
    this.scene.fog = new THREE.Fog(0x9bd3f5, 78, 165);

    // Hemisphere sky/ground bounce for baked-looking soft shading
    this.hemiLight = new THREE.HemisphereLight(0xeef8ff, 0x6b7867, 0.88);
    this.hemiLight.position.set(0, 50, 0);
    this.root.add(this.hemiLight);

    // Single restrained directional sun light
    this.sunLight = new THREE.DirectionalLight(0xfff5e0, 1.08);
    this.sunLight.position.set(34, 52, 26);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 135;
    const d = 50;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0006;
    this.root.add(this.sunLight);
  }

  _createAsphaltTexture() {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#343b46';
    ctx.fillRect(0, 0, 128, 128);

    // Deterministic subtle aggregate speckle (no Math.random jitter needed, fast LCG)
    let seed = 1337;
    for (let i = 0; i < 420; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const x = seed & 127;
      const y = (seed >>> 8) & 127;
      const shade = (seed >>> 16) & 1 ? '#3c4450' : '#2d333d';
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, 2, 2);
    }

    const tex = this._tex(new THREE.CanvasTexture(canvas));
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(26, 22);
    return tex;
  }

  _createSchoolSignTexture() {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 504, 88);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PARKLITE DRIVING ACADEMY', 256, 50);

    const tex = this._tex(new THREE.CanvasTexture(canvas));
    return tex;
  }

  _buildGroundAndLot() {
    // Outer grassy landscape plane
    const grassGeo = this._geo(new THREE.PlaneGeometry(240, 220));
    grassGeo.rotateX(-Math.PI / 2);
    const grassMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x76a962 }));
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.position.y = -0.04;
    grass.receiveShadow = false;
    this.root.add(grass);

    // Concrete apron border around asphalt
    const apronGeo = this._geo(new THREE.PlaneGeometry(88, 76));
    apronGeo.rotateX(-Math.PI / 2);
    const apronMat = this._mat(new THREE.MeshLambertMaterial({ color: 0xcbd5e1 }));
    const apron = new THREE.Mesh(apronGeo, apronMat);
    apron.position.y = -0.015;
    this.root.add(apron);

    // Main asphalt parking lot surface (84m x 72m)
    const asphaltGeo = this._geo(new THREE.PlaneGeometry(84, 72));
    asphaltGeo.rotateX(-Math.PI / 2);
    const asphaltTex = this._createAsphaltTexture();
    const asphaltMat = this._mat(
      new THREE.MeshLambertMaterial({
        color: asphaltTex ? 0xffffff : 0x353c47,
        map: asphaltTex || null
      })
    );
    const asphalt = new THREE.Mesh(asphaltGeo, asphaltMat);
    asphalt.receiveShadow = true;
    this.root.add(asphalt);
  }

  _buildPerimeterWalls() {
    const curbMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x94a3b8 }));
    const railMat = this._mat(new THREE.MeshLambertMaterial({ color: 0xe2e8f0 }));

    const wallDefs = [
      { cx: 0, cz: -36.5, hx: 43.0, hz: 0.45 },
      { cx: 0, cz: 36.5, hx: 43.0, hz: 0.45 },
      { cx: -42.5, cz: 0, hx: 0.45, hz: 36.9 },
      { cx: 42.5, cz: 0, hx: 0.45, hz: 36.9 }
    ];

    for (let i = 0; i < wallDefs.length; i++) {
      const w = wallDefs[i];
      const geo = this._geo(new THREE.BoxGeometry(w.hx * 2, 0.58, w.hz * 2));
      const mesh = new THREE.Mesh(geo, curbMat);
      mesh.position.set(w.cx, 0.29, w.cz);
      mesh.receiveShadow = true;
      this.root.add(mesh);

      const railGeo = this._geo(new THREE.BoxGeometry(w.hx * 1.98, 0.10, w.hz * 0.7));
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(w.cx, 0.78, w.cz);
      this.root.add(rail);

      this.obstacles.push(makeStaticOBB(w.cx, w.cz, w.hx, w.hz, 0, 'wall'));
    }

    // Instanced perimeter posts for crisp low-poly definition
    const postCoords = [];
    for (let x = -40; x <= 40; x += 5) {
      postCoords.push([x, -36.5], [x, 36.5]);
    }
    for (let z = -32; z <= 32; z += 5) {
      postCoords.push([-42.5, z], [42.5, z]);
    }
    const postGeo = this._geo(new THREE.BoxGeometry(0.16, 0.88, 0.16));
    const postInst = new THREE.InstancedMesh(postGeo, curbMat, postCoords.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < postCoords.length; i++) {
      dummy.position.set(postCoords[i][0], 0.44, postCoords[i][1]);
      dummy.updateMatrix();
      postInst.setMatrixAt(i, dummy.matrix);
    }
    postInst.instanceMatrix.needsUpdate = true;
    this.root.add(postInst);
  }

  _buildBuildingsAndIslands() {
    const creamMat = this._mat(new THREE.MeshLambertMaterial({ color: 0xf1ece1 }));
    const terracottaRoofMat = this._mat(new THREE.MeshLambertMaterial({ color: 0xc86446 }));
    const slateRoofMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x334155 }));
    const windowMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x3b6998 }));
    const awningMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x0284c7 }));
    const sidewalkMat = this._mat(new THREE.MeshLambertMaterial({ color: 0xcbd5e1 }));
    const planterGrassMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x65a34e }));

    // 1. Driving Academy Main Building (NW corner: x in [-38.5, -17.5], z in [-35.0, -26.6])
    const schoolGroup = new THREE.Group();
    schoolGroup.position.set(-28.0, 0, -30.8);

    const schoolBody = new THREE.Mesh(this._geo(new THREE.BoxGeometry(20.6, 5.2, 8.0)), creamMat);
    schoolBody.position.y = 2.6;
    schoolBody.castShadow = true;
    schoolBody.receiveShadow = true;
    this.shadowCasters.push(schoolBody);

    const schoolRoof = new THREE.Mesh(this._geo(new THREE.BoxGeometry(21.2, 0.45, 8.6)), slateRoofMat);
    schoolRoof.position.y = 5.42;

    const awning = new THREE.Mesh(this._geo(new THREE.BoxGeometry(8.4, 0.25, 1.4)), awningMat);
    awning.position.set(0, 2.65, 4.4);

    // Front glass windows
    const winGeo = this._geo(new THREE.BoxGeometry(3.2, 1.5, 0.12));
    for (let wx = -6.8; wx <= 6.8; wx += 6.8) {
      const w = new THREE.Mesh(winGeo, windowMat);
      w.position.set(wx, 2.4, 4.02);
      schoolGroup.add(w);
    }

    // Academy Signboard
    const signTex = this._createSchoolSignTexture();
    const signMat = this._mat(
      signTex
        ? new THREE.MeshBasicMaterial({ map: signTex })
        : new THREE.MeshLambertMaterial({ color: 0x0f172a })
    );
    const signBoard = new THREE.Mesh(this._geo(new THREE.BoxGeometry(9.6, 1.6, 0.28)), signMat);
    signBoard.position.set(0, 6.4, 3.6);

    schoolGroup.add(schoolBody, schoolRoof, awning, signBoard);
    this.root.add(schoolGroup);
    this.obstacles.push(makeStaticOBB(-28.0, -30.8, 10.5, 4.2, 0, 'building'));

    // 2. East Street Curb + Low-Poly Shopfronts (x in [33.2, 41.8], z in [-25.0, 19.0])
    const eastSidewalk = new THREE.Mesh(this._geo(new THREE.BoxGeometry(8.6, 0.24, 44.0)), sidewalkMat);
    eastSidewalk.position.set(37.5, 0.12, -3.0);
    eastSidewalk.receiveShadow = true;
    this.root.add(eastSidewalk);

    const shopDefs = [
      { cz: -17.0, lz: 12.0, h: 5.8, color: 0xe9e2d0, roof: 0xc86446 },
      { cz: -3.0, lz: 13.0, h: 6.8, color: 0xdbeafe, roof: 0x334155 },
      { cz: 11.0, lz: 12.0, h: 5.2, color: 0xfef3c7, roof: 0xb45309 }
    ];
    for (let i = 0; i < shopDefs.length; i++) {
      const s = shopDefs[i];
      const bMat = this._mat(new THREE.MeshLambertMaterial({ color: s.color }));
      const rMat = this._mat(new THREE.MeshLambertMaterial({ color: s.roof }));
      const bMesh = new THREE.Mesh(this._geo(new THREE.BoxGeometry(6.2, s.h, s.lz)), bMat);
      bMesh.position.set(38.2, 0.24 + s.h * 0.5, s.cz);
      bMesh.castShadow = true;
      this.shadowCasters.push(bMesh);

      const rMesh = new THREE.Mesh(this._geo(new THREE.BoxGeometry(6.6, 0.38, s.lz + 0.4)), rMat);
      rMesh.position.set(38.2, 0.24 + s.h + 0.19, s.cz);

      const shopWin = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.12, 1.8, s.lz * 0.65)), windowMat);
      shopWin.position.set(35.08, 1.7, s.cz);

      this.root.add(bMesh, rMesh, shopWin);
    }
    // Single clean curb+building OBB so parallel parking scrapes gently against curb face at x = 33.2
    this.obstacles.push(makeStaticOBB(37.5, -3.0, 4.3, 22.0, 0, 'curb'));

    // 3. Two Central Landscaped Planter Islands (open driving lanes all around)
    const islands = [
      { cx: 7.0, cz: -12.0, hx: 4.2, hz: 2.0 },
      { cx: -4.0, cz: 13.5, hx: 5.0, hz: 2.0 }
    ];
    for (let i = 0; i < islands.length; i++) {
      const isl = islands[i];
      const curb = new THREE.Mesh(
        this._geo(new THREE.BoxGeometry(isl.hx * 2, 0.28, isl.hz * 2)),
        sidewalkMat
      );
      curb.position.set(isl.cx, 0.14, isl.cz);
      curb.receiveShadow = true;

      const turf = new THREE.Mesh(
        this._geo(new THREE.BoxGeometry(isl.hx * 2 - 0.5, 0.10, isl.hz * 2 - 0.5)),
        planterGrassMat
      );
      turf.position.set(isl.cx, 0.31, isl.cz);

      this.root.add(curb, turf);
      this.obstacles.push(makeStaticOBB(isl.cx, isl.cz, isl.hx, isl.hz, 0, 'curb'));
    }

    // 4. Lightweight background horizon buildings outside the fence (zero collision cost)
    const bgDefs = [
      [-56, -24, 12, 11, 16, 0xdce4ee],
      [-56, 8, 12, 9, 14, 0xe8dfd1],
      [14, -50, 18, 10, 10, 0xe2e8f0],
      [-18, 50, 16, 8, 10, 0xded6c8],
      [56, -16, 12, 12, 16, 0xd8e2ec]
    ];
    for (let i = 0; i < bgDefs.length; i++) {
      const [bx, bz, w, h, d, col] = bgDefs[i];
      const m = this._mat(new THREE.MeshLambertMaterial({ color: col }));
      const mesh = new THREE.Mesh(this._geo(new THREE.BoxGeometry(w, h, d)), m);
      mesh.position.set(bx, h * 0.5, bz);
      this.outerDecorGroup.add(mesh);
    }
  }

  _buildRoadMarkingsInstanced() {
    // Collect all white & amber ground paint rectangles -> 2 InstancedMeshes total!
    const whiteRects = []; // [cx, cz, widthX, lengthZ, yaw]
    const amberRects = [];

    // A. North Forward Parking Row stalls (6 stalls centered at z = -31.0, x = -6.8 .. +10.2, step 3.4)
    const northStallXs = [-6.8, -3.4, 0.0, 3.4, 6.8, 10.2, 13.6];
    for (let i = 0; i <= northStallXs.length; i++) {
      const lineX = -8.5 + i * 3.4;
      whiteRects.push([lineX, -31.0, 0.14, 5.4, 0]);
    }
    // Front wheel-stop line along z = -33.7
    whiteRects.push([3.4, -33.7, northStallXs.length * 3.4 + 0.14, 0.16, 0]);

    // B. West Reverse Parking Row stalls (centered at x = -37.2, z = -12.8 .. +2.4, step 3.8)
    for (let i = 0; i <= 4; i++) {
      const lineZ = -12.8 + i * 3.8;
      whiteRects.push([-37.2, lineZ, 5.4, 0.14, 0]);
    }
    whiteRects.push([-39.9, -5.2, 0.16, 4 * 3.8 + 0.14, 0]);

    // C. East Street Parallel Parking Curb Bays (x = 31.5, dashed T-ticks along x = 30.0)
    const parallelDividers = [-14.2, -8.3, -1.5, 4.4];
    for (let i = 0; i < parallelDividers.length; i++) {
      const dz = parallelDividers[i];
      whiteRects.push([31.5, dz, 2.7, 0.14, 0]);
    }
    // Outer street edge dashes for parallel lane
    for (let z = -13.5; z <= 3.8; z += 2.4) {
      whiteRects.push([30.15, z, 0.13, 1.2, 0]);
    }

    // D. South Precision Bay & VIP Examiner Bay (centered at z = 29.5)
    // Narrow Precision Bay at x = -23.0 (width 2.65m)
    whiteRects.push([-24.32, 29.5, 0.14, 5.2, 0]);
    whiteRects.push([-21.68, 29.5, 0.14, 5.2, 0]);
    whiteRects.push([-23.0, 32.1, 2.78, 0.16, 0]);

    // VIP Examiner Bay at x = 14.0 (width 3.2m) & neighbor bay at x = 17.4
    whiteRects.push([12.4, 29.5, 0.14, 5.4, 0]);
    whiteRects.push([15.6, 29.5, 0.14, 5.4, 0]);
    whiteRects.push([18.8, 29.5, 0.14, 5.4, 0]);
    whiteRects.push([15.6, 32.2, 6.54, 0.16, 0]);

    // E. Loop Road Centerline Dashes (Amber) & Crosswalk Stripes (White)
    // North-South West avenue centerline (x = -19.5, z from -20 to +22)
    for (let z = -20; z <= 20; z += 4.2) {
      amberRects.push([-19.5, z, 0.15, 2.0, 0]);
    }
    // North-South East avenue centerline (x = 22.5, z from -20 to +20)
    for (let z = -20; z <= 20; z += 4.2) {
      amberRects.push([22.5, z, 0.15, 2.0, 0]);
    }
    // East-West Central boulevard dashes (z = 1.0, x from -15 to +18)
    for (let x = -15; x <= 18; x += 4.2) {
      amberRects.push([x, 1.0, 2.0, 0.15, 0]);
    }
    // East-West North lane dashes (z = -21.0, x from -15 to +20)
    for (let x = -15; x <= 20; x += 4.2) {
      amberRects.push([x, -21.0, 2.0, 0.15, 0]);
    }
    // East-West South lane dashes (z = 22.5, x from -15 to +20)
    for (let x = -15; x <= 20; x += 4.2) {
      amberRects.push([x, 22.5, 2.0, 0.15, 0]);
    }

    // Crosswalk near Driving School front entrance (x = -15.5, z from -23.5 to -18.5)
    for (let z = -23.4; z <= -18.6; z += 0.95) {
      whiteRects.push([-15.5, z, 2.4, 0.45, 0]);
    }

    const unitPlane = this._geo(new THREE.PlaneGeometry(1, 1));
    unitPlane.rotateX(-Math.PI / 2);

    const whiteMat = this._mat(new THREE.MeshBasicMaterial({ color: 0xf1f5f9 }));
    const amberMat = this._mat(new THREE.MeshBasicMaterial({ color: 0xfbbf24 }));

    this.root.add(this._buildRectInstances(unitPlane, whiteMat, whiteRects, 0.012));
    this.root.add(this._buildRectInstances(unitPlane, amberMat, amberRects, 0.014));
  }

  _buildRectInstances(geo, mat, rects, y) {
    const inst = new THREE.InstancedMesh(geo, mat, rects.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rects.length; i++) {
      const [cx, cz, sx, sz, yaw] = rects[i];
      dummy.position.set(cx, y, cz);
      dummy.rotation.set(0, yaw || 0, 0);
      dummy.scale.set(sx, 1, sz);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }

  _buildParkedCars() {
    const parkedSpecs = [
      // North Forward Row (leaving x = -3.4 and Mission 1 target x = 0.0 open)
      { x: -6.8, z: -31.0, yaw: 0, color: 0xe11d48 },
      { x: 3.4, z: -31.0, yaw: 0, color: 0xeab308 },
      { x: 10.2, z: -31.0, yaw: 0, color: 0x0d9488 },

      // West Reverse Row (flanking Mission 2 target at x = -37.2, z = -5.2)
      { x: -37.2, z: -9.0, yaw: -Math.PI / 2, color: 0x64748b },
      { x: -37.2, z: -1.4, yaw: -Math.PI / 2, color: 0x0284c7 },

      // East Curbside Parallel Row (flanking Mission 3 target at x = 31.5, z = -4.9)
      { x: 31.5, z: -10.9, yaw: 0, color: 0x16a34a },
      { x: 31.5, z: 1.1, yaw: 0, color: 0xea580c }
    ];

    for (let i = 0; i < parkedSpecs.length; i++) {
      const p = parkedSpecs[i];
      const carMesh = this.sharedCarAssets.createParkedCar(p.color, true);
      carMesh.position.set(p.x, 0, p.z);
      carMesh.rotation.y = p.yaw;
      this.root.add(carMesh);
      this.shadowCasters.push(carMesh);

      this.obstacles.push(
        makeStaticOBB(p.x, p.z, CAR_SPECS.halfWidth, CAR_SPECS.halfLength, p.yaw, 'parked_car')
      );
    }
  }

  _buildConesAndBarriersInstanced() {
    // Traffic cones around Narrow Cone Slot (Mission 4) & decorative school corners
    const coneCoords = [
      // Mission 4 Narrow Slot corridor (target x = -23.0, z = 29.5)
      [-24.55, 27.2], [-24.55, 29.5], [-24.55, 31.8],
      [-21.45, 27.2], [-21.45, 29.5], [-21.45, 31.8],
      // Approach funnel gate
      [-25.4, 20.5], [-20.6, 20.5],

      // Island end-cap warning cones
      [2.3, -12.0], [11.7, -12.0],
      [-9.5, 13.5], [1.5, 13.5],

      // VIP Bay block outer corner markers (Mission 5)
      [11.9, 26.8], [19.1, 26.8]
    ];

    const baseGeo = this._geo(new THREE.BoxGeometry(0.42, 0.05, 0.42));
    const coneGeo = this._geo(new THREE.ConeGeometry(0.16, 0.56, 8));
    const collarGeo = this._geo(new THREE.CylinderGeometry(0.085, 0.115, 0.13, 8));

    const orangeMat = this._mat(new THREE.MeshLambertMaterial({ color: 0xf97316 }));
    const whiteMat = this._mat(new THREE.MeshBasicMaterial({ color: 0xf8fafc }));
    const darkBaseMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x1e293b }));

    const baseInst = new THREE.InstancedMesh(baseGeo, darkBaseMat, coneCoords.length);
    const bodyInst = new THREE.InstancedMesh(coneGeo, orangeMat, coneCoords.length);
    const collarInst = new THREE.InstancedMesh(collarGeo, whiteMat, coneCoords.length);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < coneCoords.length; i++) {
      const [cx, cz] = coneCoords[i];
      dummy.position.set(cx, 0.025, cz);
      dummy.updateMatrix();
      baseInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(cx, 0.30, cz);
      dummy.updateMatrix();
      bodyInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(cx, 0.36, cz);
      dummy.updateMatrix();
      collarInst.setMatrixAt(i, dummy.matrix);

      this.obstacles.push(makeStaticOBB(cx, cz, 0.21, 0.21, 0, 'cone'));
    }

    baseInst.instanceMatrix.needsUpdate = true;
    bodyInst.instanceMatrix.needsUpdate = true;
    collarInst.instanceMatrix.needsUpdate = true;
    this.root.add(baseInst, bodyInst, collarInst);

    // Striped Driving School Safety Barriers
    const barrierDefs = [
      { cx: -28.0, cz: -25.4, yaw: 0 },
      { cx: -35.0, cz: 5.5, yaw: Math.PI / 2 }
    ];
    const barBeamGeo = this._geo(new THREE.BoxGeometry(3.2, 0.28, 0.16));
    const barLegGeo = this._geo(new THREE.BoxGeometry(0.14, 0.72, 0.42));
    const redBarMat = this._mat(new THREE.MeshLambertMaterial({ color: 0xdc2626 }));

    for (let i = 0; i < barrierDefs.length; i++) {
      const b = barrierDefs[i];
      const g = new THREE.Group();
      g.position.set(b.cx, 0, b.cz);
      g.rotation.y = b.yaw;

      const beam = new THREE.Mesh(barBeamGeo, redBarMat);
      beam.position.y = 0.56;
      const stripe = new THREE.Mesh(this._geo(new THREE.BoxGeometry(1.4, 0.29, 0.17)), whiteMat);
      stripe.position.y = 0.56;

      const legL = new THREE.Mesh(barLegGeo, darkBaseMat);
      legL.position.set(-1.3, 0.36, 0);
      const legR = new THREE.Mesh(barLegGeo, darkBaseMat);
      legR.position.set(1.3, 0.36, 0);

      g.add(beam, stripe, legL, legR);
      this.root.add(g);

      this.obstacles.push(makeStaticOBB(b.cx, b.cz, 1.6, 0.22, b.yaw, 'barrier'));
    }
  }

  _buildTreesInstanced() {
    // Low-poly stylized trees on planter islands + outside perimeter fence
    const treeCoords = [
      // Inside island planters (already protected by island curb OBBs)
      [4.5, -12.0, 0.95],
      [9.5, -12.0, 1.05],
      [-6.8, 13.5, 1.0],
      [-1.2, 13.5, 0.92],

      // Surrounding perimeter greenery
      [-46, -34, 1.2], [-46, -18, 1.05], [-46, -2, 1.15], [-46, 16, 1.0], [-46, 32, 1.25],
      [46, -32, 1.1], [46, -14, 1.2], [46, 6, 1.0], [46, 26, 1.15],
      [-32, -40, 1.1], [-10, -40, 1.25], [12, -40, 1.0], [32, -40, 1.15],
      [-30, 40, 1.15], [-8, 40, 1.05], [14, 40, 1.2], [34, 40, 1.0]
    ];

    const trunkGeo = this._geo(new THREE.CylinderGeometry(0.18, 0.26, 1.5, 6));
    const crownLowGeo = this._geo(new THREE.ConeGeometry(1.45, 2.4, 7));
    const crownTopGeo = this._geo(new THREE.ConeGeometry(1.05, 1.9, 7));

    const trunkMat = this._mat(new THREE.MeshLambertMaterial({ color: 0x6b4c35 }));
    const leafMat1 = this._mat(new THREE.MeshLambertMaterial({ color: 0x3d8b40 }));
    const leafMat2 = this._mat(new THREE.MeshLambertMaterial({ color: 0x4ca64c }));

    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCoords.length);
    const lowInst = new THREE.InstancedMesh(crownLowGeo, leafMat1, treeCoords.length);
    const topInst = new THREE.InstancedMesh(crownTopGeo, leafMat2, treeCoords.length);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < treeCoords.length; i++) {
      const [tx, tz, s] = treeCoords[i];
      dummy.scale.set(s, s, s);
      dummy.rotation.set(0, (i * 1.1) % (Math.PI * 2), 0);

      dummy.position.set(tx, 0.75 * s, tz);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(tx, 2.35 * s, tz);
      dummy.updateMatrix();
      lowInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(tx, 3.65 * s, tz);
      dummy.updateMatrix();
      topInst.setMatrixAt(i, dummy.matrix);
    }

    trunkInst.instanceMatrix.needsUpdate = true;
    lowInst.instanceMatrix.needsUpdate = true;
    topInst.instanceMatrix.needsUpdate = true;

    lowInst.castShadow = true;
    this.shadowCasters.push(lowInst);

    this.root.add(trunkInst, lowInst, topInst);
  }

  setQuality(quality) {
    const isLow = quality === 'low';
    const isHigh = quality === 'high';

    this.sunLight.castShadow = !isLow;
    if (!isLow) {
      const size = isHigh ? 2048 : 1024;
      if (this.sunLight.shadow.mapSize.x !== size) {
        this.sunLight.shadow.mapSize.set(size, size);
        if (this.sunLight.shadow.map) {
          this.sunLight.shadow.map.dispose();
          this.sunLight.shadow.map = null;
        }
      }
    }

    for (let i = 0; i < this.shadowCasters.length; i++) {
      const item = this.shadowCasters[i];
      if (item.traverse) {
        item.traverse((c) => {
          if (c.isMesh) c.castShadow = !isLow;
        });
      } else {
        item.castShadow = !isLow;
      }
    }

    this.outerDecorGroup.visible = !isLow;
  }

  dispose() {
    for (let i = 0; i < this.geometries.length; i++) this.geometries[i].dispose();
    for (let i = 0; i < this.materials.length; i++) this.materials[i].dispose();
    for (let i = 0; i < this.textures.length; i++) this.textures[i].dispose();
    if (this.sunLight && this.sunLight.shadow && this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
    }
    this.scene.remove(this.root);
  }
}
