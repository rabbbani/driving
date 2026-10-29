// js/physics.js
// Lightweight, deterministic 2.5D vehicle physics, manual transmission, clutch/RPM/stall model,
// and zero-allocation 2D OBB (Separating Axis Theorem) collision detection & resolution.

export const GEARS = ['P', 'R', 'N', '1', '2', '3', '4'];

export const GEAR_SPECS = {
  P: { ratio: 0, maxSpeedKmh: 0, driveSign: 0, peakForce: 0, launchEase: 1.0, label: 'P' },
  R: { ratio: -3.6, maxSpeedKmh: 19, driveSign: -1, peakForce: 7600, launchEase: 1.0, label: 'R' },
  N: { ratio: 0, maxSpeedKmh: 0, driveSign: 0, peakForce: 0, launchEase: 1.0, label: 'N' },
  '1': { ratio: 3.5, maxSpeedKmh: 23, driveSign: 1, peakForce: 8200, launchEase: 1.0, label: '1' },
  '2': { ratio: 2.05, maxSpeedKmh: 42, driveSign: 1, peakForce: 5600, launchEase: 0.42, label: '2' },
  '3': { ratio: 1.35, maxSpeedKmh: 64, driveSign: 1, peakForce: 3900, launchEase: 0.18, label: '3' },
  '4': { ratio: 0.95, maxSpeedKmh: 88, driveSign: 1, peakForce: 2800, launchEase: 0.08, label: '4' }
};

export const CAR_SPECS = {
  mass: 1180,          // kg
  wheelbase: 2.62,     // m
  halfWidth: 0.91,     // m (1.82m wide)
  halfLength: 2.14,    // m (4.28m long)
  boundingRadius: 2.33,// sqrt(0.91^2 + 2.14^2)
  maxSteerRad: 0.63,   // ~36.1 degrees at low parking speed
  idleRpm: 850,
  redlineRpm: 6200,
  stallRpm: 380,
  brakeForce: 13500,
  handbrakeForce: 9800,
  parkHoldForce: 20000,
  rollingDrag: 145,
  aeroDrag: 0.48
};

// Pre-allocated scratch variables for collision math (zero GC allocations in game loop)
const _axesX = new Float64Array(4);
const _axesZ = new Float64Array(4);
const _mtvResult = { hit: false, nx: 0, nz: 0, overlap: 0 };

export function createVehicleState(x = 0, z = 0, yaw = 0) {
  return {
    x,
    z,
    yaw,
    vForward: 0,       // m/s along car forward vector (+ is forward, - is reverse)
    vLateral: 0,       // m/s along car right vector
    speedKmh: 0,       // signed km/h
    absSpeedKmh: 0,    // unsigned km/h
    yawRate: 0,        // rad/s

    // Steering
    steerInput: 0,     // [-1, 1] normalized target steering (-1 left, +1 right)
    wheelAngle: 0,     // actual front road-wheel steer angle in rad (+ is right)
    steeringWheelDeg: 0, // visual steering wheel rotation in degrees [-270, +270]
    wheelSpinRad: 0,   // cumulative wheel rolling rotation

    // Manual Transmission & Engine
    gear: 'N',
    clutchPedal: 0,    // [0..1] 0 = engaged (pedal up), 1 = disengaged (pedal pressed down)
    clutchCoupling: 1, // [0..1] effective plate engagement
    prevClutchPedal: 0,
    rpm: CAR_SPECS.idleRpm,
    stalled: false,
    lugging: false,
    shiftFeedback: '',
    shiftFeedbackTimer: 0,
    stallRestartCooldown: 0,

    // Pedals & Brakes (smoothed/readout)
    throttle: 0,
    brake: 0,
    handbrake: false,

    // Suspension visual spring state
    pitch: 0,
    pitchVel: 0,
    roll: 0,
    rollVel: 0,
    heave: 0,
    heaveVel: 0,

    // Collision tracking
    collisionCount: 0,
    collisionCooldown: 0,
    lastImpactSpeed: 0,
    justCollided: false,
    justStalled: false,
    justShifted: false
  };
}

export function resetVehicleState(state, x, z, yaw, startGear = 'N') {
  state.x = x;
  state.z = z;
  state.yaw = yaw;
  state.vForward = 0;
  state.vLateral = 0;
  state.speedKmh = 0;
  state.absSpeedKmh = 0;
  state.yawRate = 0;

  state.steerInput = 0;
  state.wheelAngle = 0;
  state.steeringWheelDeg = 0;

  state.gear = startGear;
  state.clutchPedal = 0;
  state.clutchCoupling = 1;
  state.prevClutchPedal = 0;
  state.rpm = CAR_SPECS.idleRpm;
  state.stalled = false;
  state.lugging = false;
  state.shiftFeedback = '';
  state.shiftFeedbackTimer = 0;
  state.stallRestartCooldown = 0;

  state.throttle = 0;
  state.brake = 0;
  state.handbrake = false;

  state.pitch = 0;
  state.pitchVel = 0;
  state.roll = 0;
  state.rollVel = 0;
  state.heave = 0;
  state.heaveVel = 0;

  state.collisionCooldown = 0;
  state.lastImpactSpeed = 0;
  state.justCollided = false;
  state.justStalled = false;
  state.justShifted = false;
}

export function restartEngine(state) {
  if (!state.stalled) return false;
  state.stalled = false;
  state.lugging = false;
  state.rpm = CAR_SPECS.idleRpm + 220;
  state.shiftFeedback = 'Engine restarted';
  state.shiftFeedbackTimer = 1.4;
  return true;
}

/**
 * Attempt to select a gear ('P', 'R', 'N', '1', '2', '3', '4').
 * Returns { ok, reason, grind }
 */
export function selectGear(state, targetGear) {
  if (!GEAR_SPECS[targetGear]) {
    return { ok: false, reason: 'Invalid gear', grind: false };
  }
  if (state.gear === targetGear) {
    return { ok: true, reason: '', grind: false };
  }

  const speedKmh = state.absSpeedKmh;
  const signedKmh = state.speedKmh;

  // Park requires near-standstill
  if (targetGear === 'P' && speedKmh > 3.5) {
    state.shiftFeedback = 'Stop the car before shifting to Park (P)';
    state.shiftFeedbackTimer = 1.8;
    return { ok: false, reason: state.shiftFeedback, grind: true };
  }

  // Prevent slamming Reverse while moving forward fast, or forward gear while reversing fast
  if (targetGear === 'R' && signedKmh > 5.0) {
    state.shiftFeedback = 'Brake first before shifting to Reverse (R)';
    state.shiftFeedbackTimer = 1.8;
    return { ok: false, reason: state.shiftFeedback, grind: true };
  }
  if ((targetGear === '1' || targetGear === '2' || targetGear === '3' || targetGear === '4') && signedKmh < -5.0) {
    state.shiftFeedback = 'Stop reversing before selecting forward gear';
    state.shiftFeedbackTimer = 1.8;
    return { ok: false, reason: state.shiftFeedback, grind: true };
  }

  // Shifting into N or P (when stopped) or when engine is stalled is always clean
  if (targetGear === 'N' || targetGear === 'P' || state.stalled) {
    state.gear = targetGear;
    state.justShifted = true;
    state.shiftFeedback = '';
    return { ok: true, reason: '', grind: false };
  }

  // Shifting into a driving gear (R, 1, 2, 3, 4) while engine is running:
  // Require clutch pedal engagement (> 0.35), otherwise reject with clear driving-school feedback!
  if (state.clutchPedal < 0.35) {
    state.shiftFeedback = 'Hold Clutch [E] to shift into gear!';
    state.shiftFeedbackTimer = 2.0;
    return { ok: false, reason: state.shiftFeedback, grind: true };
  }

  state.gear = targetGear;
  state.justShifted = true;
  state.shiftFeedback = '';
  return { ok: true, reason: '', grind: false };
}

/**
 * Create a precomputed static OBB obstacle.
 * yaw = rotation around +Y (same convention as vehicle).
 */
export function makeStaticOBB(cx, cz, hx, hz, yaw = 0, tag = 'obstacle') {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    cx,
    cz,
    hx,
    hz,
    yaw,
    cos,
    sin,
    radius: Math.hypot(hx, hz),
    tag
  };
}

/**
 * Test 2D OBB vs OBB using Separating Axis Theorem (zero allocations).
 */
function testOBBvsOBB(ax, az, ahx, ahz, acos, asin, bx, bz, bhx, bhz, bcos, bsin, out) {
  // Local axes in world XZ plane:
  // Right axis: (cos, -sin), Forward axis: (-sin, -cos)
  _axesX[0] = acos;  _axesZ[0] = -asin;
  _axesX[1] = -asin; _axesZ[1] = -acos;
  _axesX[2] = bcos;  _axesZ[2] = -bsin;
  _axesX[3] = -bsin; _axesZ[3] = -bcos;

  const dx = ax - bx;
  const dz = az - bz;

  let minOverlap = Infinity;
  let bestNx = 0;
  let bestNz = 0;

  for (let i = 0; i < 4; i++) {
    const ux = _axesX[i];
    const uz = _axesZ[i];

    const dist = Math.abs(dx * ux + dz * uz);

    const ra =
      ahx * Math.abs(ux * _axesX[0] + uz * _axesZ[0]) +
      ahz * Math.abs(ux * _axesX[1] + uz * _axesZ[1]);

    const rb =
      bhx * Math.abs(ux * _axesX[2] + uz * _axesZ[2]) +
      bhz * Math.abs(ux * _axesX[3] + uz * _axesZ[3]);

    const overlap = ra + rb - dist;
    if (overlap <= 0) {
      out.hit = false;
      return false;
    }

    if (overlap < minOverlap) {
      minOverlap = overlap;
      const sign = (dx * ux + dz * uz) >= 0 ? 1 : -1;
      bestNx = ux * sign;
      bestNz = uz * sign;
    }
  }

  out.hit = true;
  out.overlap = minOverlap;
  out.nx = bestNx;
  out.nz = bestNz;
  return true;
}

/**
 * Step vehicle simulation by a small fixed dt (e.g. 1/120 s).
 * inputs: {
 *   throttle: [0..1],
 *   brake: [0..1],
 *   clutch: [0..1],
 *   handbrake: boolean,
 *   steerTarget: [-1..1],    // continuous steering target when mouse/touch wheel active, or keyboard
 *   steerDirect: boolean,    // true if mouse/touch wheel sets steering directly
 *   steeringSensitivity: number,
 *   restartRequested: boolean
 * }
 */
export function stepVehiclePhysics(state, inputs, obstacles, dt) {
  state.justCollided = false;
  state.justStalled = false;
  state.justShifted = false;

  if (state.collisionCooldown > 0) {
    state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);
  }
  if (state.shiftFeedbackTimer > 0) {
    state.shiftFeedbackTimer = Math.max(0, state.shiftFeedbackTimer - dt);
    if (state.shiftFeedbackTimer === 0) state.shiftFeedback = '';
  }
  if (state.stallRestartCooldown > 0) {
    state.stallRestartCooldown = Math.max(0, state.stallRestartCooldown - dt);
  }

  const throttle = clamp(inputs.throttle || 0, 0, 1);
  const brake = clamp(inputs.brake || 0, 0, 1);
  const clutchTarget = clamp(inputs.clutch || 0, 0, 1);
  const handbrake = Boolean(inputs.handbrake);
  const steerSens = clamp(inputs.steeringSensitivity || 1.0, 0.4, 2.2);

  state.throttle = throttle;
  state.brake = brake;
  state.handbrake = handbrake;

  // Smooth clutch pedal slightly to avoid 1-frame infinite derivative spikes,
  // while keeping direct pedal response snappy.
  const prevClutch = state.clutchPedal;
  const clutchAlpha = 1 - Math.exp(-26 * dt);
  state.clutchPedal += (clutchTarget - state.clutchPedal) * clutchAlpha;
  if (Math.abs(clutchTarget - state.clutchPedal) < 0.002) state.clutchPedal = clutchTarget;
  const clutchReleaseRate = Math.max(0, (prevClutch - state.clutchPedal) / Math.max(dt, 1e-4)); // + when releasing pedal
  state.prevClutchPedal = state.clutchPedal;

  // Bite zone between 0.15 (fully coupled) and 0.78 (fully decoupled)
  const coupling = clamp((0.78 - state.clutchPedal) / 0.63, 0, 1);
  state.clutchCoupling = coupling;

  // Engine restart check when stalled
  if (state.stalled && state.stallRestartCooldown <= 0) {
    const safeNeutral = state.gear === 'N' || state.gear === 'P';
    const clutchPressed = state.clutchPedal > 0.65;
    if (
      inputs.restartRequested ||
      (safeNeutral && throttle > 0.25) ||
      (clutchPressed && throttle > 0.25)
    ) {
      restartEngine(state);
    }
  }

  // --- Steering ---
  const targetSteer = clamp(inputs.steerTarget || 0, -1, 1);
  if (inputs.steerDirect) {
    // Mouse / Touch wheel direct angle tracking
    const followRate = 1 - Math.exp(-24 * dt);
    state.steerInput += (targetSteer - state.steerInput) * followRate;
  } else {
    // Keyboard steering with speed-assisted caster self-centering
    if (Math.abs(targetSteer) > 0.01) {
      const turnSpeed = 2.65 * steerSens;
      state.steerInput = moveTowards(state.steerInput, targetSteer, turnSpeed * dt);
    } else {
      const speedFactor = 0.85 + Math.min(2.2, state.absSpeedKmh * 0.08);
      state.steerInput = moveTowards(state.steerInput, 0, 2.4 * speedFactor * dt);
    }
  }

  state.steeringWheelDeg = state.steerInput * 270;

  // Speed-sensitive road-wheel angle reduction at higher speeds for rock-solid stability
  const speedAttenuation = 1 / (1 + Math.pow(state.absSpeedKmh / 44, 1.35));
  state.wheelAngle = state.steerInput * CAR_SPECS.maxSteerRad * speedAttenuation;

  // --- Manual Transmission, Engine RPM & Stalling ---
  const gearSpec = GEAR_SPECS[state.gear];
  const isDriveGear = gearSpec.driveSign !== 0;

  // Equivalent wheel RPM in the selected gear (+ if rolling in gear's intended direction)
  let signedWheelRpm = 0;
  if (isDriveGear) {
    const signedSpeedInGearDir = state.vForward * gearSpec.driveSign * 3.6; // km/h
    signedWheelRpm = (signedSpeedInGearDir / gearSpec.maxSpeedKmh) * CAR_SPECS.redlineRpm;
  }

  state.lugging = false;
  let driveForce = 0;

  if (state.stalled) {
    state.rpm = moveTowards(state.rpm, 0, 3200 * dt);
    // Compression drag if rolling in gear with clutch engaged while stalled
    if (isDriveGear && coupling > 0.05) {
      driveForce = -state.vForward * 650 * coupling;
    }
  } else {
    const freeTargetRpm = CAR_SPECS.idleRpm + throttle * (CAR_SPECS.redlineRpm - CAR_SPECS.idleRpm);

    if (!isDriveGear || coupling <= 0.02) {
      // Decoupled (Park, Neutral, or Clutch pressed down): engine revs freely
      const revRate = throttle > 0.05 ? 9500 : 4800;
      state.rpm = moveTowards(state.rpm, freeTargetRpm, revRate * dt);
    } else {
      // Coupled or partially coupled in R, 1, 2, 3, or 4
      const gearLoad = 1 / gearSpec.launchEase; // 1.0 in 1/R, 2.38 in 2, 5.55 in 3, 12.5 in 4
      const speedInGearKmh = state.vForward * gearSpec.driveSign * 3.6;
      const brakesFighting = (brake > 0.25 || handbrake || state.gear === 'P');

      // Check low-speed lugging / improper clutch release conditions
      const lowWheelRpm = signedWheelRpm < CAR_SPECS.idleRpm * 0.92;
      const minThrottleNeeded = gearLoad > 2.0 ? Math.min(0.85, 0.14 * gearLoad) : 0.06;

      if (lowWheelRpm && coupling > 0.38 && (throttle < minThrottleNeeded || brakesFighting)) {
        state.lugging = true;
        let dropMultiplier = gearLoad * coupling;
        if (brakesFighting) dropMultiplier *= 3.4;
        if (clutchReleaseRate > 2.6 && throttle < 0.15) {
          // Abrupt clutch dump at standstill without gas!
          dropMultiplier *= 2.9;
        }
        if (speedInGearKmh < -1.2) {
          // Rolling opposite to selected gear without gas
          dropMultiplier *= 2.5;
        }
        // Throttle support slows down RPM drop in lower gears, allowing smooth feathering
        const throttleSupport = throttle * 1650 * gearSpec.launchEase;
        const dropRate = Math.max(80, 510 * dropMultiplier - throttleSupport);
        state.rpm -= dropRate * dt;

        // Slight idle creep torque in 1st / R while engine still has flywheel momentum
        if (!brakesFighting && gearSpec.launchEase >= 0.9 && state.rpm > CAR_SPECS.stallRpm) {
          driveForce = gearSpec.driveSign * gearSpec.peakForce * 0.16 * coupling;
        }

        if (state.rpm <= CAR_SPECS.stallRpm) {
          state.rpm = 0;
          state.stalled = true;
          state.lugging = false;
          state.justStalled = true;
          state.stallRestartCooldown = 0.45;
          state.shiftFeedback = 'Engine stalled! Press Clutch [E] + Gas [W] to restart';
          state.shiftFeedbackTimer = 3.5;
          // Lurch suspension pitch on stall
          state.pitchVel += gearSpec.driveSign * 0.35;
        }
      } else {
        // Healthy bite / driving zone
        const slipBlend = coupling; // 1.0 = locked 1:1 with wheels, 0.0 = free engine
        const coupledRpm = Math.max(CAR_SPECS.idleRpm * 0.78, signedWheelRpm);
        const targetRpm = freeTargetRpm * (1 - slipBlend) + coupledRpm * slipBlend;
        state.rpm = moveTowards(state.rpm, clamp(targetRpm, 420, CAR_SPECS.redlineRpm + 250), 9000 * dt);

        // If tall gear (3rd/4th) released at near-zero speed even with moderate throttle, still check bog-down stall
        if (gearLoad >= 5.0 && speedInGearKmh < 6.5 && coupling > 0.72 && throttle < 0.85) {
          state.lugging = true;
          state.rpm -= 420 * (gearLoad * 0.35) * dt;
          if (state.rpm <= CAR_SPECS.stallRpm) {
            state.rpm = 0;
            state.stalled = true;
            state.justStalled = true;
            state.stallRestartCooldown = 0.45;
            state.shiftFeedback = 'Gear too high for launch — engine stalled!';
            state.shiftFeedbackTimer = 3.5;
          }
        }

        if (!state.stalled) {
          const effectiveRpm = Math.max(state.rpm, signedWheelRpm * coupling);
          const rpmNorm = effectiveRpm / CAR_SPECS.redlineRpm;

          // Torque curve peaks in mid-range and cuts cleanly at redline (rev limiter)
          let torqueCurve = 0;
          if (rpmNorm < 0.96) {
            const clampedNorm = clamp(rpmNorm, 0.08, 0.96);
            torqueCurve = 0.62 + 0.38 * Math.sin(Math.min(1, clampedNorm * 1.25) * Math.PI * 0.75);
          } else if (rpmNorm < 1.01) {
            torqueCurve = (1.01 - rpmNorm) / 0.05;
          } else {
            torqueCurve = 0;
          }

          // Engine braking when off-throttle or over-revving a lower gear
          const overRevFactor = rpmNorm > 1.02 ? (rpmNorm - 1.02) * 3800 : 0;
          const engineBrake = ((1 - throttle) * Math.max(0, speedInGearKmh) * 42 + overRevFactor) * coupling;
          const rawThrust = throttle * gearSpec.peakForce * torqueCurve * coupling;
          driveForce = gearSpec.driveSign * (rawThrust - engineBrake);
        }
      }
    }
  }

  // --- Braking, Park Pawl, Handbrake & Drag ---
  const prevVForward = state.vForward;

  // Aerodynamic + rolling resistance
  const dragForce =
    -Math.sign(state.vForward) *
    (CAR_SPECS.rollingDrag + CAR_SPECS.aeroDrag * state.vForward * state.vForward * 16);

  // Active brake + Park + Handbrake resistive magnitude
  let resistMag = brake * CAR_SPECS.brakeForce;
  if (handbrake) resistMag += CAR_SPECS.handbrakeForce;
  if (state.gear === 'P') resistMag += CAR_SPECS.parkHoldForce;

  // Integrate longitudinal velocity carefully around v = 0 so brakes never oscillate
  const netActiveForce = driveForce + (Math.abs(state.vForward) > 0.02 ? dragForce : 0);
  let vNew = state.vForward + (netActiveForce / CAR_SPECS.mass) * dt;

  const maxBrakeDeltaV = (resistMag / CAR_SPECS.mass) * dt;
  if (Math.abs(vNew) <= maxBrakeDeltaV && Math.abs(driveForce) < resistMag * 0.85) {
    vNew = 0;
  } else {
    vNew -= Math.sign(vNew) * maxBrakeDeltaV;
  }

  // Natural static settle when coasting near 0 with no throttle
  if (throttle < 0.02 && Math.abs(vNew) < 0.035 && (!isDriveGear || coupling < 0.2 || state.stalled)) {
    vNew = 0;
  }

  // Clamp absolute physical velocity bounds for safety
  vNew = clamp(vNew, -6.5, 25.5); // -23.4 km/h reverse to ~91.8 km/h forward
  state.vForward = vNew;

  // --- Bicycle Turning & Lateral Tire Grip ---
  if (Math.abs(state.vForward) > 0.005) {
    // Turning yaw rate (+wheelAngle = right steer => decreases yaw in Three.js -Z forward coords)
    state.yawRate = -(state.vForward / CAR_SPECS.wheelbase) * Math.tan(state.wheelAngle);
    state.yaw = wrapAngle(state.yaw + state.yawRate * dt);

    // Subtle lateral slip that increases slightly with handbrake at speed, heavily damped otherwise
    const grip = handbrake && Math.abs(state.vForward) > 2.5 ? 6.5 : 18.0;
    const centripetalImpulse = -state.vForward * state.yawRate * 0.06;
    state.vLateral += centripetalImpulse * dt;
    state.vLateral *= Math.exp(-grip * dt);
  } else {
    state.yawRate = 0;
    state.vLateral *= Math.exp(-20 * dt);
  }

  // Advance world position
  // Forward = (-sin(yaw), -cos(yaw)), Right = (cos(yaw), -sin(yaw))
  const sinY = Math.sin(state.yaw);
  const cosY = Math.cos(state.yaw);
  const fwdX = -sinY;
  const fwdZ = -cosY;
  const rightX = cosY;
  const rightZ = -sinY;

  state.x += (fwdX * state.vForward + rightX * state.vLateral) * dt;
  state.z += (fwdZ * state.vForward + rightZ * state.vLateral) * dt;

  // --- Collision Detection & Smooth Sliding Resolution ---
  if (obstacles && obstacles.length > 0) {
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      const dx = state.x - obs.cx;
      const dz = state.z - obs.cz;
      const rSum = CAR_SPECS.boundingRadius + obs.radius;
      if (dx * dx + dz * dz > rSum * rSum) continue;

      if (
        testOBBvsOBB(
          state.x,
          state.z,
          CAR_SPECS.halfWidth,
          CAR_SPECS.halfLength,
          cosY,
          sinY,
          obs.cx,
          obs.cz,
          obs.hx,
          obs.hz,
          obs.cos,
          obs.sin,
          _mtvResult
        )
      ) {
        // Push car cleanly out of penetration
        const push = _mtvResult.overlap + 0.004;
        state.x += _mtvResult.nx * push;
        state.z += _mtvResult.nz * push;

        // World velocity vector
        let vx = fwdX * state.vForward + rightX * state.vLateral;
        let vz = fwdZ * state.vForward + rightZ * state.vLateral;

        // Normal component into the obstacle (negative when moving into obstacle)
        const vn = vx * _mtvResult.nx + vz * _mtvResult.nz;
        if (vn < 0) {
          const impactSpeedKmh = Math.abs(vn) * 3.6;
          const restitution = obs.tag === 'cone' ? 0.05 : 0.14;
          vx -= (1 + restitution) * vn * _mtvResult.nx;
          vz -= (1 + restitution) * vn * _mtvResult.nz;

          // Tangential wall scrape damping so car slides smoothly without sticking
          const wallFriction = obs.tag === 'cone' ? 0.92 : 0.82;
          vx *= wallFriction;
          vz *= wallFriction;

          state.vForward = vx * fwdX + vz * fwdZ;
          state.vLateral = vx * rightX + vz * rightZ;

          if (impactSpeedKmh > 1.6 && state.collisionCooldown <= 0) {
            state.collisionCount += 1;
            state.collisionCooldown = 0.65;
            state.lastImpactSpeed = impactSpeedKmh;
            state.justCollided = true;
            // Suspension jolt on impact
            state.heaveVel += Math.min(0.6, impactSpeedKmh * 0.025);
            state.pitchVel += clamp(vn * 0.12, -0.45, 0.45);
          }
        }
      }
    }
  }

  // Wheel rolling spin
  state.wheelSpinRad = (state.wheelSpinRad + (state.vForward / 0.33) * dt) % (Math.PI * 200);

  // Derived speeds
  state.speedKmh = state.vForward * 3.6;
  state.absSpeedKmh = Math.abs(state.speedKmh);

  // --- Simple Critically-Damped Suspension Visuals ---
  const longAccel = clamp((state.vForward - prevVForward) / Math.max(dt, 1e-4), -14, 14);
  const latAccel = clamp(state.vForward * state.yawRate, -12, 12);

  // Squat back under acceleration (+pitch lifts nose or dips tail), dive nose under braking
  const targetPitch = clamp(-longAccel * 0.0038, -0.045, 0.045);
  const targetRoll = clamp(latAccel * 0.0055, -0.055, 0.055);
  const lugVibration = state.lugging ? Math.sin(performanceTimeSafe() * 48) * 0.004 : 0;

  // Spring-damper integration
  const kSpring = 85;
  const kDamp = 14;
  state.pitchVel += ((targetPitch - state.pitch) * kSpring - state.pitchVel * kDamp) * dt;
  state.pitch += state.pitchVel * dt;

  state.rollVel += ((targetRoll + lugVibration - state.roll) * kSpring - state.rollVel * kDamp) * dt;
  state.roll += state.rollVel * dt;

  state.heaveVel += ((0 - state.heave) * 95 - state.heaveVel * 15) * dt;
  state.heave += state.heaveVel * dt;
}

function performanceTimeSafe() {
  return typeof performance !== 'undefined' ? performance.now() * 0.001 : Date.now() * 0.001;
}

export function wrapAngle(rad) {
  let a = rad % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}
