/**
 * player-controller.js — deterministic first-person capsule controller.
 *
 * Physics only: no DOM, no rendering, no game rules.  It moves a capsule
 * through static collision, keeps a camera at eye height, and owns yaw/pitch.
 *
 * COLLISION
 *   Pass any object with `capsuleIntersect(capsule, opts)` and
 *   `rayIntersect(ray)`: a kit `CollisionWorld` (recommended — BVH-backed and
 *   character aware, see collision-world.js), a `CompositeCollision`, or a
 *   three `Octree`.  Passing a plain Object3D builds an Octree from it.
 *
 * UNITS & CONVENTIONS
 *   Metres, seconds, radians; three.js Y-up.  Every length/speed default is
 *   multiplied by `unitScale`, so `{ unitScale: 39.37 }` gives the same feel
 *   in inch-based (Quake/CoD) maps.  Explicit options are taken as given.
 *   The capsule's `start`/`end` are the centres of its bottom/top spheres;
 *   `height` includes both caps.  Positions without `{ eye: true }` are FEET
 *   positions (bottom of the capsule).
 *   yaw 0 looks down -Z; positive yaw turns LEFT (three.js convention).
 *   Look input follows mouse `movementX/Y`: +look.x turns RIGHT, +look.y
 *   looks DOWN (set `invertY` to flip).  The camera gets rotation
 *   (pitch, yaw, 0) in 'YXZ' order unless `driveCameraRotation: false`, in
 *   which case the game rotates the camera and movement follows its heading.
 *
 * DETERMINISM
 *   Simulation runs in fixed steps (`fixedTimeStep`, default 1/120 s) driven
 *   only by the dt passed to update(); no clocks, no randomness.  The same
 *   input sequence and dts always produce bit-identical positions.
 *   getSnapshot()/restoreSnapshot() capture the full simulation state for
 *   rollback / client prediction.
 *
 * CONSTRUCTOR
 *   new PlayerController(camera, collision, options)
 *     camera     Object3D placed at the eye (a Camera, or null for headless use)
 *     collision  CollisionWorld | CompositeCollision | Octree | Object3D | null
 *
 * OPTIONS (defaults in metres; see PLAYER_DEFAULTS)
 *   radius 0.35, height 1.8, crouchHeight 1.2, eyeHeight 1.6, crouchEyeHeight 1.05
 *   stepHeight 0.45        auto step-up without jumping (stairs, kerbs, thresholds)
 *   snapDownHeight = stepHeight   keep walking down stairs/ramps instead of hopping
 *   maxSlopeAngle 50°      steeper surfaces are walls
 *   moveSpeed 5, sprintSpeed 7.5, crouchSpeed 2.5 (m/s)
 *   groundAcceleration 60, airAcceleration 20 (m/s²)
 *   gravity 20 (m/s²), jumpHeight 1.0 (m; exact apex), jumpSpeed (derived)
 *   maxFallSpeed 50, groundSnapSpeed 2, groundProbeDistance 0.1, skin 0.002
 *   coyoteTime 0.1 s, jumpBufferTime 0.12 s, stepSupportTime 0.18 s
 *   fixedTimeStep 1/120, maxSubSteps 8, maxDelta 0.1, maxCollisionIterations 5,
 *   maxCollisionStep radius/4 (longer moves are split to avoid tunnelling)
 *   lookSensitivity 0.002 rad per look unit, maxPitch 1.5 rad, invertY false,
 *   driveCameraRotation true
 *   spawn (feet Vector3/{x,y,z}; default = camera position as eye), spawnIsEye,
 *   yaw, pitch (default = camera orientation), fallResetY (respawn below this)
 *   ladders: [{ center, right, normal, halfWidth, halfDepth, bottom, top }] or
 *   { volumes: [...] }; ladderClimbSpeed 4.5, ladderGripSpeed 3, ladderReach 0.3,
 *   ladderPushSpeed 5.5, ladderExitSpeed 5.5, ladderTopClearance 0.1,
 *   ladderExitTime 0.3, ladderStallTime 0.4, ladderMountBias 0.25
 *
 * INPUT OBJECT (update(dt, input) / setInput(input); all fields optional)
 *   move   {x, y} | Vector2 | [x, y]   x = strafe right (+), y = forward (+), -1..1
 *   look   {x, y} | Vector2 | [x, y]   deltas since last update (mouse pixels)
 *   yaw, pitch                         absolute radians (network / replay input)
 *   jump         held state (edge-detected)   jumpPressed  one-shot edge
 *   sprint, crouch                     held booleans
 *   Aliases kept from the game copies: forward/backward, strafe/moveRight/
 *   moveLeft/right/left, KeyW/KeyA/KeyS/KeyD, Space, ShiftLeft, ControlLeft, KeyC,
 *   run, duck, lookX/lookY.
 *
 * METHODS
 *   update(dt, input?) -> state      accumulate dt, run fixed steps, sync camera
 *   step(dt = fixedTimeStep)         exactly one simulation step (tests/servers)
 *   setInput(input), jump(), setEnabled(bool)
 *   reset(pos = spawn, { eye, resolve = true, yaw, pitch }), respawn(...)
 *   setSpawn(pos, { eye }), setPosition(feet), setLook(yaw, pitch)
 *   setCollisionWorld(world) (alias setCollisionOctree), buildCollision(object3d)
 *   setLadders(source), getSnapshot(), restoreSnapshot(snapshot)
 *   getForward(target), getFeetPosition()
 *   state { position, feetPosition, velocity, grounded, crouched, onLadder,
 *           worldReady, yaw, pitch }; isGrounded, isOnLadder, feetPosition, eyeHeight
 */

import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Octree } from 'three/addons/math/Octree.js';

export const PLAYER_DEFAULTS = Object.freeze({
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.2,
  eyeHeight: 1.6,
  crouchEyeHeight: 1.05,
  stepHeight: 0.45,
  maxSlopeAngle: 50,
  moveSpeed: 5,
  sprintSpeed: 7.5,
  crouchSpeed: 2.5,
  groundAcceleration: 60,
  airAcceleration: 20,
  gravity: 20,
  jumpHeight: 1,
  maxFallSpeed: 50,
  groundSnapSpeed: 2,
  groundProbeDistance: 0.1,
  maxGroundProbeRiseSpeed: 0.25,
  skin: 0.002,
  fixedTimeStep: 1 / 120,
  maxSubSteps: 8,
  maxDelta: 0.1,
  maxCollisionIterations: 5,
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  stepSupportTime: 0.18,
  lookSensitivity: 0.002,
  maxPitch: 1.5,
  ladderClimbSpeed: 4.5,
  ladderGripSpeed: 3,
  ladderReach: 0.3,
  ladderPushSpeed: 5.5,
  ladderExitSpeed: 5.5,
  ladderTopClearance: 0.1,
  ladderExitTime: 0.3,
  ladderStallTime: 0.4,
  ladderMountBias: 0.25,
});

// Defaults that carry a length unit and therefore scale with `unitScale`.
const SCALED = new Set([
  'radius', 'height', 'crouchHeight', 'eyeHeight', 'crouchEyeHeight', 'stepHeight',
  'moveSpeed', 'sprintSpeed', 'crouchSpeed', 'groundAcceleration', 'airAcceleration',
  'gravity', 'jumpHeight', 'maxFallSpeed', 'groundSnapSpeed', 'groundProbeDistance',
  'maxGroundProbeRiseSpeed', 'skin', 'ladderClimbSpeed', 'ladderGripSpeed', 'ladderReach',
  'ladderPushSpeed', 'ladderExitSpeed', 'ladderTopClearance',
]);

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _movement = new THREE.Vector3();
const _translation = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _probeRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
const _ladderWish = new THREE.Vector3();
const _stepStart = new THREE.Vector3();
const _stepEnd = new THREE.Vector3();
const _stepVelocity = new THREE.Vector3();
const _saveStart = new THREE.Vector3();
const _saveEnd = new THREE.Vector3();
const _trial = new Capsule();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const RING = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readButton(input, ...names) {
  for (const name of names) {
    if (input && input[name] !== undefined) return Boolean(input[name]);
  }
  return false;
}

function readAxis(input, positiveNames, negativeNames) {
  let value = 0;
  for (const name of positiveNames) {
    if (input && input[name] !== undefined) {
      value = Number(input[name]) || 0;
      break;
    }
  }
  for (const name of negativeNames) {
    if (input && input[name] !== undefined) {
      value -= Number(input[name]) || 0;
      break;
    }
  }
  return clamp(value, -1, 1);
}

/** {x, y} from a Vector2, plain object or [x, y] array; null when absent. */
function readPair(value) {
  if (!value) return null;
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0 };
  if (typeof value === 'object') return { x: Number(value.x) || 0, y: Number(value.y) || 0 };
  return null;
}

function copyPosition(value, fallback) {
  if (value && value.isVector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) return new THREE.Vector3(+value[0], +value[1], +value[2]);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return fallback.clone();
}

function levelAxis(value, fallback) {
  const axis = new THREE.Vector3(
    Number(value?.[0] ?? value?.x) || 0,
    0,
    Number(value?.[2] ?? value?.z) || 0,
  );
  return axis.lengthSq() < 1e-8 ? fallback.clone() : axis.normalize();
}

function wrapAngle(angle) {
  const turn = Math.PI * 2;
  return angle - turn * Math.floor((angle + Math.PI) / turn);
}

/**
 * Normalise one ladder descriptor.  A ladder is an upright box: `right` runs
 * along the rungs, `normal` points out of one climbing face, and both faces
 * are climbable.  Missing sizes default to a 0.8 m wide, 3.2 m tall ladder
 * (times `unitScale`).
 */
export function createLadderVolume(descriptor, unitScale = 1) {
  if (!descriptor) return null;
  const center = copyPosition(descriptor.center, new THREE.Vector3());
  const right = levelAxis(descriptor.right, new THREE.Vector3(1, 0, 0));
  const normal = levelAxis(descriptor.normal, new THREE.Vector3(0, 0, 1));
  const halfWidth = Math.max(0, numberOr(descriptor.halfWidth, 0.4 * unitScale));
  const halfDepth = Math.max(0, numberOr(descriptor.halfDepth, 0.1 * unitScale));
  const bottom = numberOr(descriptor.bottom, center.y - 1.6 * unitScale);
  const top = numberOr(descriptor.top, center.y + 1.6 * unitScale);
  if (!(top > bottom)) return null;
  return { name: descriptor.name ?? 'ladder', center, right, normal, halfWidth, halfDepth, bottom, top };
}

/** Accepts a bare array of descriptors or a baked `{ volumes: [...] }` file. */
export function createLadderVolumes(source, unitScale = 1) {
  const list = Array.isArray(source) ? source : (source?.volumes ?? []);
  return list.map((descriptor) => createLadderVolume(descriptor, unitScale)).filter(Boolean);
}

/**
 * Build a three Octree from a collision Object3D (world matrices applied).
 * Prefer `CollisionWorld.fromObject3D` from collision-world.js: it is faster
 * and resolves stairs, thresholds and slopes more cleanly.
 */
export function buildCollisionOctree(collisionObject) {
  if (!collisionObject || typeof collisionObject.updateWorldMatrix !== 'function') {
    throw new TypeError('buildCollisionOctree requires a three.js Object3D');
  }
  collisionObject.updateWorldMatrix(true, true);
  return new Octree().fromGraphNode(collisionObject);
}

function isCollisionWorld(value) {
  return Boolean(value) && typeof value.capsuleIntersect === 'function';
}

export class PlayerController {
  /**
   * @param {THREE.Object3D|null} camera object kept at the eye position
   * @param {object|THREE.Object3D|null} collisionSource collision world, Octree or Object3D
   * @param {object} options see the file header
   */
  constructor(camera, collisionSource = null, options = {}) {
    if (camera && !camera.isObject3D) throw new TypeError('PlayerController camera must be an Object3D or null');
    this.camera = camera ?? new THREE.Object3D();
    this.options = options;
    const unitScale = numberOr(options.unitScale, 1);
    this.unitScale = unitScale;
    const opt = (name) => numberOr(options[name], PLAYER_DEFAULTS[name] * (SCALED.has(name) ? unitScale : 1));

    this.worldOctree = null;
    this.collisionObject = null;
    this.worldReady = false;

    this.radius = Math.max(1e-4 * unitScale, opt('radius'));
    this.height = Math.max(this.radius * 2.01, opt('height'));
    this.crouchHeight = clamp(opt('crouchHeight'), this.radius * 2.01, this.height);
    this.standingEyeHeight = clamp(opt('eyeHeight'), this.radius, this.height);
    this.crouchEyeHeight = clamp(opt('crouchEyeHeight'), this.radius, this.crouchHeight);
    this.stepHeight = Math.max(0, opt('stepHeight'));
    this.snapDownHeight = Math.max(0, numberOr(options.snapDownHeight, this.stepHeight));

    this.gravity = Math.max(0, opt('gravity'));
    this.jumpHeight = Math.max(0, opt('jumpHeight'));
    this.jumpSpeed = Math.max(0, numberOr(options.jumpSpeed, Math.sqrt(2 * this.gravity * this.jumpHeight)));
    this.moveSpeed = Math.max(0, opt('moveSpeed'));
    this.sprintSpeed = Math.max(0, opt('sprintSpeed'));
    this.crouchSpeed = Math.max(0, opt('crouchSpeed'));
    this.groundAcceleration = Math.max(0, opt('groundAcceleration'));
    this.airAcceleration = Math.max(0, opt('airAcceleration'));
    this.maxFallSpeed = Math.max(0, opt('maxFallSpeed'));
    this.groundSnapSpeed = Math.max(0, opt('groundSnapSpeed'));
    this.groundProbeDistance = Math.max(this.radius * 0.01, opt('groundProbeDistance'));
    this.maxGroundProbeRiseSpeed = Math.max(0, opt('maxGroundProbeRiseSpeed'));
    this.maxSlopeAngle = clamp(opt('maxSlopeAngle'), 0, 89.9);
    this.floorNormalY = Math.cos(THREE.MathUtils.degToRad(this.maxSlopeAngle));
    this.skin = Math.max(this.radius * 1e-4, opt('skin'));

    // Fixed steps keep collision identical across frame rates.
    this.fixedTimeStep = clamp(opt('fixedTimeStep'), 1 / 1000, 1 / 20);
    this.maxSubSteps = Math.max(1, Math.floor(opt('maxSubSteps')));
    this.maxDelta = Math.max(this.fixedTimeStep, opt('maxDelta'));
    this.maxCollisionIterations = Math.max(1, Math.floor(opt('maxCollisionIterations')));
    // capsuleIntersect is an overlap test, not a sweep: long moves are split
    // so a sprint or a fall cannot pass through thin walls between samples.
    this.maxCollisionStep = Math.max(this.radius * 0.05, numberOr(options.maxCollisionStep, this.radius * 0.25));

    this.coyoteTime = Math.max(0, opt('coyoteTime'));
    this.jumpBufferTime = Math.max(0, opt('jumpBufferTime'));
    this.stepSupportTime = Math.max(0, opt('stepSupportTime'));
    this.fallResetY = Number.isFinite(options.fallResetY) ? options.fallResetY : null;

    this.lookSensitivity = opt('lookSensitivity');
    this.maxPitch = clamp(opt('maxPitch'), 0, Math.PI / 2);
    this.invertY = Boolean(options.invertY);
    this.driveCameraRotation = options.driveCameraRotation !== false;

    // Ladders are volumes rather than surfaces: the collision mesh only knows
    // the prop is solid, so climbing is driven entirely by these boxes.
    this.ladderClimbSpeed = Math.max(0, opt('ladderClimbSpeed'));
    this.ladderGripSpeed = Math.max(0, opt('ladderGripSpeed'));
    this.ladderReach = Math.max(0, opt('ladderReach'));
    this.ladderPushSpeed = Math.max(0, opt('ladderPushSpeed'));
    this.ladderExitSpeed = Math.max(0, opt('ladderExitSpeed'));
    this.ladderTopClearance = Math.max(0, opt('ladderTopClearance'));
    this.ladderExitTime = Math.max(0, opt('ladderExitTime'));
    // A ladder bolted flat against geometry can be mounted from the wrong
    // face.  Rather than hang there weightless, let go once the climb stops
    // making the progress it was asked to make.
    this.ladderStallTime = Math.max(0, opt('ladderStallTime'));
    // How squarely the player must push at a face before mounting it, so
    // strafing past a ladder does not grab it.
    this.ladderMountBias = clamp(opt('ladderMountBias'), 0, 1);

    this.velocity = new THREE.Vector3();
    this.collider = new Capsule(new THREE.Vector3(), new THREE.Vector3(), this.radius);
    this.input = { forward: 0, strafe: 0, sprint: false, crouch: false, jump: false };
    this.onFloor = false;
    this.grounded = false;
    this.crouched = false;
    this.onLadder = false;
    this.enabled = true;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.lastCollision = null;
    this._accumulator = 0;
    this._jumpBufferTimer = 0;
    this._coyoteTimer = 0;
    this._stepSupportTimer = 0;
    this._jumpHeld = false;
    this.ladders = createLadderVolumes(options.ladders, unitScale);
    this._ladder = null;
    this._ladderSide = 1;
    this._ladderExitTimer = 0;
    this._ladderStall = 0;

    _euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = wrapAngle(numberOr(options.yaw, _euler.y));
    this.pitch = clamp(numberOr(options.pitch, _euler.x), -this.maxPitch, this.maxPitch);

    if (isCollisionWorld(collisionSource)) this.setCollisionWorld(collisionSource);
    else if (collisionSource) this.buildCollision(collisionSource);

    // An omitted spawn is the camera's current eye position, so a caller can
    // construct the controller before choosing a spawn.  An explicit spawn
    // is a feet position unless `spawnIsEye` is set.
    const hasExplicitSpawn = options.spawn !== undefined;
    this.spawn = copyPosition(options.spawn, this.camera.position);
    this.spawnIsEye = options.spawnIsEye === true || (!hasExplicitSpawn && options.spawnIsEye !== false);
    this.reset(this.spawn, { eye: this.spawnIsEye, resolve: hasExplicitSpawn });
  }

  /** Build an Octree from a collision Object3D and use it. */
  buildCollision(collisionObject) {
    this.collisionObject = collisionObject || null;
    this.worldOctree = buildCollisionOctree(collisionObject);
    this.worldReady = true;
    return this.worldOctree;
  }

  /** Use a CollisionWorld, CompositeCollision or Octree. */
  setCollisionWorld(world) {
    if (!isCollisionWorld(world)) throw new TypeError('setCollisionWorld requires an object with capsuleIntersect()');
    this.worldOctree = world;
    this.collisionObject = null;
    this.worldReady = true;
    return this;
  }

  setCollisionOctree(octree) {
    return this.setCollisionWorld(octree);
  }

  /** Install climbable ladder volumes (baked file, array, or normalised volumes). */
  setLadders(source) {
    this.ladders = createLadderVolumes(source, this.unitScale);
    this._releaseLadder();
    this._ladderExitTimer = 0;
    return this;
  }

  /** Change the respawn point (a feet position unless `{ eye: true }`). */
  setSpawn(position, { eye = false } = {}) {
    this.spawn = copyPosition(position, this.spawn);
    this.spawnIsEye = Boolean(eye);
    return this;
  }

  /**
   * Teleport and clear physics state.  With `resolve` (default) a position
   * that overlaps geometry — a spawn marker inside a crate — is pushed out,
   * and failing that moved to the nearest free spot.
   */
  reset(position = this.spawn, { eye = this.spawnIsEye, resolve = true, yaw, pitch } = {}) {
    const target = copyPosition(position, this.spawn);
    this.crouched = false;
    const feetY = eye ? target.y - this.standingEyeHeight : target.y;
    this.collider.start.set(target.x, feetY + this.radius, target.z);
    this.collider.end.set(target.x, feetY + this.height - this.radius, target.z);
    this.velocity.set(0, 0, 0);
    this._accumulator = 0;
    this._jumpBufferTimer = 0;
    this._coyoteTimer = 0;
    this._stepSupportTimer = 0;
    this.onFloor = false;
    this.grounded = false;
    this.lastCollision = null;
    this._releaseLadder();
    this._ladderExitTimer = 0;
    if (Number.isFinite(yaw) || Number.isFinite(pitch)) this.setLook(yaw ?? this.yaw, pitch ?? this.pitch);
    if (resolve && this.worldReady) this._resolveOverlaps();
    this._syncCamera();
    return this;
  }

  respawn(position = this.spawn, options = {}) {
    return this.reset(position, options);
  }

  setPosition(position) {
    return this.reset(position, { eye: false });
  }

  setLook(yaw, pitch = this.pitch) {
    this.yaw = wrapAngle(numberOr(yaw, this.yaw));
    this.pitch = clamp(numberOr(pitch, this.pitch), -this.maxPitch, this.maxPitch);
    this._syncCamera();
    return this;
  }

  /** Apply one frame of input; look deltas are consumed immediately. */
  setInput(input = {}) {
    if (!input) input = {};
    const move = readPair(input.move);
    this.input.forward = move
      ? clamp(move.y, -1, 1)
      : readAxis(input, ['forward', 'moveForward', 'KeyW', 'w'], ['backward', 'moveBackward', 'KeyS', 's']);
    this.input.strafe = move
      ? clamp(move.x, -1, 1)
      : readAxis(input, ['strafe', 'moveRight', 'right', 'KeyD', 'd'], ['moveLeft', 'left', 'KeyA', 'a']);

    const held = readButton(input, 'jump', 'Space', 'space');
    // `jumpPressed` is an explicit edge, so a tap between two frames — or a
    // caller that never reports a held state — still jumps exactly once.
    if ((held && !this._jumpHeld) || input.jumpPressed) this._jumpBufferTimer = this.jumpBufferTime;
    this._jumpHeld = held;
    this.input.jump = held || Boolean(input.jumpPressed);
    this.input.sprint = readButton(input, 'sprint', 'run', 'ShiftLeft', 'ShiftRight', 'shift');
    this.input.crouch = readButton(input, 'crouch', 'duck', 'ControlLeft', 'ControlRight', 'KeyC', 'c');

    if (Number.isFinite(input.yaw)) this.yaw = wrapAngle(input.yaw);
    if (Number.isFinite(input.pitch)) this.pitch = clamp(input.pitch, -this.maxPitch, this.maxPitch);
    const look = readPair(input.look) ?? { x: Number(input.lookX) || 0, y: Number(input.lookY) || 0 };
    if (look.x || look.y) {
      // Mouse convention: +x (right) turns right = negative three.js yaw;
      // +y (down) looks down = negative pitch.
      this.yaw = wrapAngle(this.yaw - look.x * this.lookSensitivity);
      const pitchDelta = look.y * this.lookSensitivity * (this.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch - pitchDelta, -this.maxPitch, this.maxPitch);
    }
    return this;
  }

  /** Queue a jump without synthesising a held input state. */
  jump() {
    this._jumpBufferTimer = this.jumpBufferTime;
    return this;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.velocity.set(0, 0, 0);
      this._accumulator = 0;
      this._releaseLadder();
    }
    return this;
  }

  /**
   * Advance by a frame's `deltaSeconds` (clamped to maxDelta) in fixed steps.
   * `input` is optional; when omitted the previous movement input persists.
   */
  update(deltaSeconds, input) {
    if (input !== undefined) this.setInput(input);
    if (!this.enabled) {
      this._syncCamera();
      return this.state;
    }
    const dt = clamp(numberOr(deltaSeconds, 0), 0, this.maxDelta);
    this._accumulator = Math.min(this._accumulator + dt, this.fixedTimeStep * this.maxSubSteps);
    let steps = 0;
    // A tiny tolerance keeps float rounding in the accumulator from dropping
    // a step when dt is exactly the fixed step (1/60 = two 1/120 steps).
    while (this._accumulator >= this.fixedTimeStep - 1e-9 && steps < this.maxSubSteps) {
      this._stepFixed(this.fixedTimeStep);
      this._accumulator = Math.max(0, this._accumulator - this.fixedTimeStep);
      steps += 1;
    }
    this._syncCamera();
    return this.state;
  }

  /** Run exactly one simulation step, bypassing the accumulator. */
  step(deltaSeconds = this.fixedTimeStep) {
    if (!this.enabled) return this.state;
    this._stepFixed(clamp(numberOr(deltaSeconds, this.fixedTimeStep), 0, this.maxDelta));
    this._syncCamera();
    return this.state;
  }

  get state() {
    return {
      position: this.camera.position,
      feetPosition: this.feetPosition,
      velocity: this.velocity,
      grounded: this.onFloor,
      crouched: this.crouched,
      onLadder: this.onLadder,
      worldReady: this.worldReady,
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }

  get isOnLadder() {
    return this.onLadder;
  }

  get isGrounded() {
    return this.onFloor;
  }

  get position() {
    return this.camera.position;
  }

  get feetPosition() {
    return new THREE.Vector3(this.collider.start.x, this.collider.start.y - this.radius, this.collider.start.z);
  }

  getFeetPosition() {
    return this.feetPosition;
  }

  get eyeHeight() {
    return this.crouched ? this.crouchEyeHeight : this.standingEyeHeight;
  }

  set eyeHeight(value) {
    this.standingEyeHeight = clamp(numberOr(value, this.standingEyeHeight), this.radius, this.height);
  }

  get currentHeight() {
    return this.crouched ? this.crouchHeight : this.height;
  }

  /** Flat unit vector the player is facing. */
  getForward(target = new THREE.Vector3()) {
    this._heading(target, _right);
    return target;
  }

  /** Complete simulation state as plain JSON-safe data. */
  getSnapshot() {
    return {
      start: this.collider.start.toArray(),
      end: this.collider.end.toArray(),
      velocity: this.velocity.toArray(),
      yaw: this.yaw,
      pitch: this.pitch,
      onFloor: this.onFloor,
      crouched: this.crouched,
      onLadder: this.onLadder,
      ladder: this.ladders.indexOf(this._ladder),
      ladderSide: this._ladderSide,
      ladderExitTimer: this._ladderExitTimer,
      ladderStall: this._ladderStall,
      accumulator: this._accumulator,
      jumpBufferTimer: this._jumpBufferTimer,
      coyoteTimer: this._coyoteTimer,
      stepSupportTimer: this._stepSupportTimer,
      jumpHeld: this._jumpHeld,
      input: { ...this.input },
    };
  }

  restoreSnapshot(snapshot) {
    this.collider.start.fromArray(snapshot.start);
    this.collider.end.fromArray(snapshot.end);
    this.velocity.fromArray(snapshot.velocity);
    this.yaw = snapshot.yaw;
    this.pitch = snapshot.pitch;
    this.onFloor = this.grounded = Boolean(snapshot.onFloor);
    this.crouched = Boolean(snapshot.crouched);
    this._ladder = this.ladders[snapshot.ladder] ?? null;
    this.onLadder = Boolean(snapshot.onLadder && this._ladder);
    this._ladderSide = snapshot.ladderSide;
    this._ladderExitTimer = snapshot.ladderExitTimer;
    this._ladderStall = snapshot.ladderStall;
    this._accumulator = snapshot.accumulator;
    this._jumpBufferTimer = snapshot.jumpBufferTimer;
    this._coyoteTimer = snapshot.coyoteTimer;
    this._stepSupportTimer = snapshot.stepSupportTimer;
    this._jumpHeld = snapshot.jumpHeld;
    Object.assign(this.input, snapshot.input);
    this._syncCamera();
    return this;
  }

  _stepFixed(dt) {
    this._stepSupportTimer = Math.max(0, this._stepSupportTimer - dt);
    const wasOnFloor = this.onFloor;
    this._coyoteTimer = wasOnFloor ? this.coyoteTime : Math.max(0, this._coyoteTimer - dt);
    this._jumpBufferTimer = Math.max(0, this._jumpBufferTimer - dt);

    this._updateCrouchState();
    this._updateLadderState(dt);

    // A jump always leaves the ladder, pushing back off the face so the
    // player clears it instead of immediately re-grabbing.
    if (this.onLadder && this._jumpBufferTimer > 0) {
      this._detachLadder({ pushOff: this.ladderPushSpeed, hop: this.jumpSpeed * 0.6 });
      this._jumpBufferTimer = 0;
    }

    let jumped = false;
    if (!this.onLadder && this._jumpBufferTimer > 0 && (this.onFloor || this._coyoteTimer > 0)) {
      this.velocity.y = this.jumpSpeed;
      this.onFloor = this.grounded = false;
      this._jumpBufferTimer = 0;
      this._coyoteTimer = 0;
      this._stepSupportTimer = 0;
      jumped = true;
    }

    let verticalSpeed;
    if (this.onLadder) {
      this._updateLadderVelocity();
      verticalSpeed = this.velocity.y;
    } else {
      this._updateHorizontalVelocity(dt);
      if (this.onFloor) {
        // A small downward bias keeps the capsule on gently uneven floors.
        // Right after a step-up the capsule may be held only by the tread
        // edge in front of it; snapping down there would drop it back
        // against a thin threshold, so hold height while that edge is found.
        if (this.velocity.y <= 0) {
          this.velocity.y = this._stepSupportTimer > 0 && this._probeStepSupport() ? 0 : -this.groundSnapSpeed;
        }
        verticalSpeed = this.velocity.y;
      } else {
        const before = this.velocity.y;
        this.velocity.y = Math.max(before - this.gravity * dt, -this.maxFallSpeed);
        // Moving by the average of the start and end speed integrates
        // constant gravity exactly: the apex equals jumpHeight at any rate.
        verticalSpeed = (before + this.velocity.y) * 0.5;
      }
    }

    const travel = Math.hypot(this.velocity.x, verticalSpeed, this.velocity.z) * dt;
    const moveSteps = Math.max(1, Math.ceil(travel / this.maxCollisionStep));
    const moveDt = dt / moveSteps;
    const climbSpeedY = verticalSpeed;
    const previousFeetY = this.collider.start.y - this.radius;
    const canStep = !this.onLadder && climbSpeedY <= 0 && (wasOnFloor || this._coyoteTimer > 0);
    let moveY = verticalSpeed;
    let groundedDuringMove = false;
    for (let i = 0; i < moveSteps; i += 1) {
      _stepStart.copy(this.collider.start);
      _stepEnd.copy(this.collider.end);
      _stepVelocity.copy(this.velocity);
      _movement.set(this.velocity.x * moveDt, moveY * moveDt, this.velocity.z * moveDt);
      const velocityYBefore = this.velocity.y;
      this.collider.translate(_movement);
      this._resolveCollisions();
      // Landing or a ceiling changed vertical speed: later slices follow it.
      if (this.velocity.y !== velocityYBefore) moveY = this.velocity.y;

      const wanted = Math.hypot(_movement.x, _movement.z);
      if (canStep && !this.onLadder && wanted > this.radius * 1e-3) {
        const progress = ((this.collider.start.x - _stepStart.x) * _movement.x
          + (this.collider.start.z - _stepStart.z) * _movement.z) / wanted;
        // Stalled either in position (riser) or in speed (an Octree edge
        // normal that lifted the capsule but cancelled its forward speed).
        const speedBefore = Math.hypot(_stepVelocity.x, _stepVelocity.z);
        const speedAfter = Math.hypot(this.velocity.x, this.velocity.z);
        const stalled = progress < wanted * 0.8 || speedAfter < speedBefore * 0.8;
        if (stalled && this._tryStep(_stepStart, _stepEnd, _movement)) {
          // The rejected low path may have clipped speed against the riser.
          this.velocity.set(_stepVelocity.x, 0, _stepVelocity.z);
          moveY = 0;
        }
      }
      // Rung tops are walkable-facing triangles.  On a ladder they must not
      // arrest the climb the way a floor would.
      if (this.onLadder) {
        this.velocity.y = climbSpeedY;
        moveY = climbSpeedY;
      }
      groundedDuringMove = groundedDuringMove || this.onFloor;
    }

    if (this.onLadder) {
      this.onFloor = this.grounded = false;
      this._updateLadderExit(dt, previousFeetY);
    } else {
      // Keep a floor contact found by an earlier slice even if the last one
      // only moved tangentially and generated no overlap.
      if (!groundedDuringMove && this.velocity.y <= this.maxGroundProbeRiseSpeed) {
        groundedDuringMove = this._probeGround() || (this._stepSupportTimer > 0 && this._probeStepSupport());
      }
      if (!groundedDuringMove && wasOnFloor && !jumped && this.velocity.y <= 0) {
        groundedDuringMove = this._snapDown();
      }
      this.onFloor = this.grounded = groundedDuringMove;
      if (groundedDuringMove && this.velocity.y < 0) this.velocity.y = 0;
    }

    if (this.fallResetY !== null && this.collider.start.y - this.radius < this.fallResetY) {
      this.reset(this.spawn, { eye: this.spawnIsEye, resolve: true });
    }
  }

  _updateHorizontalVelocity(dt) {
    this._wishDirection(_wish);
    // After leaving a ladder, carry the push-off through the air until it
    // clears the rails; braking it lands the player on the ladder's top edge.
    if (!this.onFloor && this._ladderExitTimer > 0 && _wish.lengthSq() < 1e-6) return;
    const speed = this.crouched ? this.crouchSpeed : (this.input.sprint ? this.sprintSpeed : this.moveSpeed);
    _wish.multiplyScalar(speed);
    const acceleration = this.onFloor ? this.groundAcceleration : this.airAcceleration;
    const maxChange = acceleration * dt;
    this.velocity.x += clamp(_wish.x - this.velocity.x, -maxChange, maxChange);
    this.velocity.z += clamp(_wish.z - this.velocity.z, -maxChange, maxChange);
  }

  _updateCrouchState() {
    const wantCrouch = this.input.crouch;
    if (wantCrouch && !this.crouched) {
      this._setCapsuleHeight(this.crouchHeight);
      this.crouched = true;
    } else if (!wantCrouch && this.crouched && this._canUseHeight(this.height)) {
      this._setCapsuleHeight(this.height);
      this.crouched = false;
    }
  }

  /** Flat forward/right basis from yaw (or from the camera when it is game-driven). */
  _heading(forward, right) {
    if (this.driveCameraRotation) {
      forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      return;
    }
    forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    else forward.normalize();
    right.set(-forward.z, 0, forward.x);
  }

  /** Flat wish direction from the current input, in world space. */
  _wishDirection(target) {
    this._heading(_forward, _right);
    target.set(0, 0, 0);
    target.addScaledVector(_forward, this.input.forward);
    target.addScaledVector(_right, this.input.strafe);
    if (target.lengthSq() > 1) target.normalize();
    return target;
  }

  // ---------------------------------------------------------------- stepping

  /**
   * Auto step-up after a blocked move.  First the full-capsule method (rise,
   * advance, settle onto the tread), which is exact with CollisionWorld.
   * If that cannot find a clean landing — Octree edge normals, or a
   * threshold narrower than the capsule — fall back to probing the tread
   * with rays and holding the capsule on its edge for `stepSupportTime`.
   */
  _tryStep(start, end, movement) {
    if (!this.stepHeight || !this.worldReady) return false;
    return this._tryStepCapsule(start, end, movement) || this._tryStepProbe(start, end, movement);
  }

  /** True if raising the capsule from start/end by `rise` hits a ceiling. */
  _blockedOverhead(start, end, rise) {
    const increment = this.radius * 0.25;
    _trial.radius = this.radius;
    for (let height = Math.min(increment, rise); ; height = Math.min(height + increment, rise)) {
      _trial.start.copy(start);
      _trial.end.copy(end);
      _trial.start.y += height;
      _trial.end.y += height;
      const overhead = this._capsuleIntersect(_trial);
      if (overhead && overhead.depth > this.skin
        && (overhead.contacts ?? [overhead.normal]).some((n) => n.y < -0.1)) return true;
      if (height >= rise) return false;
    }
  }

  _tryStepCapsule(start, end, movement) {
    const rise = this.stepHeight + this.skin;
    if (this._blockedOverhead(start, end, rise)) return false;
    _trial.start.x += movement.x;
    _trial.start.z += movement.z;
    _trial.end.x += movement.x;
    _trial.end.z += movement.z;
    const blocked = this._capsuleIntersect(_trial);
    if (blocked && blocked.depth > this.skin) return false;
    const dropIncrement = this.radius * 0.125;
    for (let drop = 0; drop < rise;) {
      const distance = Math.min(dropIncrement, rise - drop);
      _trial.start.y -= distance;
      _trial.end.y -= distance;
      drop += distance;
      const contact = this._capsuleIntersect(_trial);
      if (!contact || contact.depth <= this.skin) continue;
      if (!(contact.contacts ?? [contact.normal]).every((n) => n.y >= this.floorNormalY)) return false;
      _translation.copy(contact.normal).multiplyScalar(contact.depth + (contact.contacts ? 0 : this.skin));
      _trial.translate(_translation);
      const gained = _trial.start.y - start.y;
      if (gained <= this.skin || gained > this.stepHeight + this.skin * 2) return false;
      const overlap = this._capsuleIntersect(_trial);
      if (overlap && overlap.depth > this.skin) return false;
      this.collider.start.copy(_trial.start);
      this.collider.end.copy(_trial.end);
      this.onFloor = this.grounded = true;
      this.velocity.y = 0;
      return true;
    }
    return false;
  }

  _tryStepProbe(start, end, movement) {
    const travel = Math.hypot(movement.x, movement.z);
    const dirX = movement.x / travel;
    const dirZ = movement.z / travel;
    const feetY = start.y - this.radius;
    const top = feetY + this.stepHeight + this.skin;
    const minRise = this.radius * 0.03;
    let rise = -Infinity;
    // Sample the tread just past the riser and at the capsule's new front,
    // so thresholds narrower than the capsule are still found.
    for (const ahead of [this.radius + this.skin * 4, this.radius + travel * 0.5, this.radius + travel + this.radius * 0.125]) {
      _probeRay.origin.set(start.x + dirX * ahead, top, start.z + dirZ * ahead);
      const hit = this.worldOctree.rayIntersect(_probeRay, 0, this.stepHeight + this.skin);
      if (!hit || hit.distance < this.skin || hit.distance > this.stepHeight + this.skin) continue;
      hit.triangle.getNormal(_normal);
      if (_normal.y < this.floorNormalY) continue;
      const hitY = (hit.point ?? hit.position).y;
      const candidate = hitY - feetY + this.skin;
      if (candidate >= minRise && candidate <= this.stepHeight + this.skin) rise = Math.max(rise, candidate);
    }
    if (!(rise > 0)) return false;
    if (this._blockedOverhead(start, end, rise)) return false;
    _trial.start.x += movement.x;
    _trial.start.z += movement.z;
    _trial.end.x += movement.x;
    _trial.end.z += movement.z;
    const contact = this._capsuleIntersect(_trial);
    if (contact && contact.depth > this.skin) return false;
    this.collider.start.copy(_trial.start);
    this.collider.end.copy(_trial.end);
    this._stepSupportTimer = this.stepSupportTime;
    this.onFloor = this.grounded = true;
    this.velocity.y = 0;
    return true;
  }

  /**
   * Support ring just outside the capsule at feet level.  After a probe step
   * the capsule is held by the tread in front of it; probing only under the
   * centre would lose that support before the centre crosses the riser.
   */
  _probeStepSupport() {
    if (!this.worldReady) return false;
    const feetY = this.collider.start.y - this.radius;
    const reach = this.radius * 1.125;
    const lift = this.radius * 0.03;
    for (const [cos, sin] of RING) {
      _probeRay.origin.set(this.collider.start.x + cos * reach, feetY + lift, this.collider.start.z + sin * reach);
      const hit = this.worldOctree.rayIntersect(_probeRay, 0, lift * 2);
      if (!hit || hit.distance > lift * 2) continue;
      hit.triangle.getNormal(_normal);
      if (_normal.y >= this.floorNormalY) return true;
    }
    return false;
  }

  /**
   * Keep contact when walking down stairs or over a crest: if the player
   * was grounded, did not jump, and the floor is at most `snapDownHeight`
   * below, settle onto it instead of launching into a short fall.
   */
  _snapDown() {
    if (!(this.snapDownHeight > 0) || !this.worldReady) return false;
    _saveStart.copy(this.collider.start);
    _saveEnd.copy(this.collider.end);
    const increment = this.radius * 0.5;
    for (let dropped = 0; dropped < this.snapDownHeight;) {
      const distance = Math.min(increment, this.snapDownHeight - dropped);
      this.collider.start.y -= distance;
      this.collider.end.y -= distance;
      dropped += distance;
      const hit = this._capsuleIntersect(this.collider);
      if (!hit || hit.depth <= this.skin) continue;
      if ((hit.contacts ?? [hit.normal]).some((n) => n.y >= this.floorNormalY)) {
        this._resolveCollisions();
        if (this.onFloor) return true;
      }
      break;
    }
    this.collider.start.copy(_saveStart);
    this.collider.end.copy(_saveEnd);
    this.onFloor = this.grounded = false;
    return false;
  }

  // ----------------------------------------------------------------- ladders

  /** Where the capsule sits relative to a ladder, or null when out of reach. */
  _ladderContact(ladder) {
    if (!ladder) return null;
    const feetY = this.collider.start.y - this.radius;
    const headY = this.collider.end.y + this.radius;
    // Reach above the rails so a climber clears the lip in _updateLadderExit
    // rather than silently losing contact on the way up.
    if (headY < ladder.bottom || feetY > ladder.top + this.ladderTopClearance * 2) return null;
    const dx = this.collider.start.x - ladder.center.x;
    const dz = this.collider.start.z - ladder.center.z;
    const along = dx * ladder.right.x + dz * ladder.right.z;
    if (Math.abs(along) > ladder.halfWidth + this.radius) return null;
    const across = dx * ladder.normal.x + dz * ladder.normal.z;
    const standoff = ladder.halfDepth + this.radius;
    if (Math.abs(across) > standoff + this.ladderReach) return null;
    return { along, across, standoff, feetY, side: across >= 0 ? 1 : -1 };
  }

  _updateLadderState(dt) {
    this._ladderExitTimer = Math.max(0, this._ladderExitTimer - dt);
    if (this.onLadder) {
      if (!this._ladderContact(this._ladder)) this._detachLadder();
      return;
    }
    if (this._ladderExitTimer > 0 || this.ladders.length === 0) return;
    this._wishDirection(_ladderWish);
    if (_ladderWish.lengthSq() < 1e-6) return;
    for (const ladder of this.ladders) {
      const contact = this._ladderContact(ladder);
      if (!contact) continue;
      // Nothing left to climb means this is a ledge to walk off, not a mount.
      if (ladder.top - contact.feetY < this.ladderTopClearance) continue;
      const into = -(_ladderWish.x * ladder.normal.x + _ladderWish.z * ladder.normal.z) * contact.side;
      if (into < this.ladderMountBias) continue;
      this.onLadder = true;
      this._ladder = ladder;
      this._ladderSide = contact.side;
      this._stepSupportTimer = 0;
      return;
    }
  }

  /** Climb velocity is set outright (crisp, and gravity is off while attached). */
  _updateLadderVelocity() {
    const ladder = this._ladder;
    const side = this._ladderSide;
    this._wishDirection(_ladderWish);
    // Pushing at the face climbs, pulling away descends, strafing steps off.
    const into = -(_ladderWish.x * ladder.normal.x + _ladderWish.z * ladder.normal.z) * side;
    const along = _ladderWish.x * ladder.right.x + _ladderWish.z * ladder.right.z;
    this.velocity.y = into * this.ladderClimbSpeed;
    // Close any gap to the face but never push into it, which would fight
    // the collision resolver and jitter the camera.
    const contact = this._ladderContact(ladder);
    const gap = contact ? Math.abs(contact.across) - contact.standoff : 0;
    const grip = gap > 0 ? Math.min(gap / this.fixedTimeStep, this.ladderGripSpeed) : 0;
    const strafe = along * this.ladderClimbSpeed * 0.5;
    this.velocity.x = ladder.right.x * strafe - ladder.normal.x * side * grip;
    this.velocity.z = ladder.right.z * strafe - ladder.normal.z * side * grip;
  }

  /** Leave the ladder once the player tops out, lands, or stops making headway. */
  _updateLadderExit(dt, previousFeetY) {
    const ladder = this._ladder;
    const feetY = this.collider.start.y - this.radius;
    const wanted = Math.abs(this.velocity.y) * dt;
    if (wanted > this.radius * 1e-4 && Math.abs(feetY - previousFeetY) < wanted * 0.25) {
      this._ladderStall += dt;
      if (this._ladderStall >= this.ladderStallTime) {
        this._detachLadder();
        return;
      }
    } else {
      this._ladderStall = 0;
    }
    if (this.velocity.y > 0 && feetY >= ladder.top + this.ladderTopClearance) {
      // Step over the lip away from the climbing face and let gravity land it.
      this._detachLadder({ pushOff: -this.ladderExitSpeed });
      return;
    }
    // Rails usually stop above the ground and the capsule rests a skin clear
    // of it, so also let go as soon as a floor is underfoot.
    if (this.velocity.y < 0 && (feetY <= ladder.bottom || this._probeGround())) this._detachLadder();
  }

  _detachLadder({ pushOff = 0, hop = 0 } = {}) {
    const ladder = this._ladder;
    const side = this._ladderSide;
    this._releaseLadder();
    this._ladderExitTimer = this.ladderExitTime;
    if (ladder && pushOff !== 0) {
      this.velocity.x = ladder.normal.x * side * pushOff;
      this.velocity.z = ladder.normal.z * side * pushOff;
    }
    if (hop !== 0) this.velocity.y = hop;
  }

  _releaseLadder() {
    this.onLadder = false;
    this._ladder = null;
    this._ladderStall = 0;
  }

  // --------------------------------------------------------------- collision

  _setCapsuleHeight(height) {
    const feetY = this.collider.start.y - this.radius;
    this.collider.end.y = feetY + height - this.radius;
  }

  _canUseHeight(height) {
    if (!this.worldReady) return true;
    const feetY = this.collider.start.y - this.radius;
    _trial.radius = this.radius;
    _trial.start.copy(this.collider.start);
    _trial.end.set(this.collider.end.x, feetY + height - this.radius, this.collider.end.z);
    const result = this.worldOctree.capsuleIntersect(_trial);
    return !result || result.depth <= this.skin;
  }

  _capsuleIntersect(capsule) {
    return this.worldOctree.capsuleIntersect(capsule, {
      floorNormalY: this.floorNormalY,
      skin: this.skin,
      stepHeight: this.stepHeight,
    });
  }

  _isFree(capsule) {
    const result = this._capsuleIntersect(capsule);
    return !result || result.depth <= this.skin;
  }

  /** Translation that resolves one intersection result (Octree-safe). */
  _resolution(result, target) {
    _normal.copy(result.normal).normalize();
    const depth = Math.max(0, result.depth);
    // CollisionWorld results already include skin and support policy.
    // Octree results do not: add skin, and resolve walkable contacts
    // vertically so gravity on a slope never becomes a downhill slide.
    if (!result.contacts && _normal.y >= this.floorNormalY) return target.set(0, (depth + this.skin) / _normal.y, 0);
    return target.copy(_normal).multiplyScalar(depth + (result.contacts ? 0 : this.skin));
  }

  /**
   * Push an overlapping capsule (spawn marker inside a crate, teleport into
   * a wall) back into free space.  A shallow overlap is pushed out directly.
   * When that fails — or would push the capsule DOWN, which is what a
   * surface test does when the capsule's centre is below a crate's top —
   * the nearest free spot is chosen from a fixed, distance-sorted set of
   * candidates (up, sideways and diagonal), so the result is deterministic.
   * Being wholly inside a closed solid without touching any face cannot be
   * detected by surface queries and is left alone.
   */
  _resolveOverlaps() {
    if (!this.worldReady || this._isFree(this.collider)) return true;
    _saveStart.copy(this.collider.start);
    _saveEnd.copy(this.collider.end);
    for (let i = 0; i < this.maxCollisionIterations * 4; i += 1) {
      const result = this._capsuleIntersect(this.collider);
      if (!result || result.depth <= this.skin) break;
      this.collider.translate(this._resolution(result, _translation));
    }
    const pushedDown = this.collider.start.y < _saveStart.y - this.skin * 2;
    const pushedFar = this.collider.start.distanceTo(_saveStart) > this.radius * 2;
    if (!pushedDown && !pushedFar && this._isFree(this.collider)) return true;

    this.collider.start.copy(_saveStart);
    this.collider.end.copy(_saveEnd);
    _trial.radius = this.radius;
    for (const [x, y, z] of this._unstuckCandidates()) {
      _trial.start.set(_saveStart.x + x, _saveStart.y + y, _saveStart.z + z);
      _trial.end.set(_saveEnd.x + x, _saveEnd.y + y, _saveEnd.z + z);
      if (this._isFree(_trial)) {
        this.collider.start.copy(_trial.start);
        this.collider.end.copy(_trial.end);
        return true;
      }
    }
    return false;
  }

  /** Offsets within ~2.5 capsule heights, nearest first (ties keep generation order). */
  _unstuckCandidates() {
    if (this._candidateCache?.radius === this.radius) return this._candidateCache.list;
    const spacing = this.radius * 0.5;
    const list = [];
    for (let up = 0; up <= 24; up += 1) {
      list.push([0, up * spacing, 0]);
      for (let ring = 1; ring <= 16; ring += 1) {
        const directions = ring < 4 ? 8 : 16;
        for (let d = 0; d < directions; d += 1) {
          const angle = (d / directions) * Math.PI * 2;
          list.push([Math.cos(angle) * ring * spacing, up * spacing, Math.sin(angle) * ring * spacing]);
        }
      }
    }
    list.shift();
    const order = list.map((offset, index) => ({ offset, index, distance: Math.hypot(...offset) }));
    order.sort((a, b) => a.distance - b.distance || a.index - b.index);
    this._candidateCache = { radius: this.radius, list: order.map((entry) => entry.offset) };
    return this._candidateCache.list;
  }

  /** Resolve penetration and project velocity along contact planes. */
  _resolveCollisions(updateGround = true) {
    let grounded = false;
    let bestGroundY = -1;
    this.lastCollision = null;
    if (!this.worldReady) {
      if (updateGround) this.onFloor = this.grounded = false;
      return;
    }
    for (let i = 0; i < this.maxCollisionIterations; i += 1) {
      const result = this._capsuleIntersect(this.collider);
      if (!result || result.depth <= this.skin) break;
      this.collider.translate(this._resolution(result, _translation));
      this.lastCollision = result;
      for (const contact of result.contacts ?? [result.normal]) {
        _normal.copy(contact).normalize();
        if (_normal.y >= this.floorNormalY) {
          grounded = true;
          if (_normal.y > bestGroundY) {
            bestGroundY = _normal.y;
            this.groundNormal.copy(_normal);
          }
          // Keep requested horizontal speed on walkable surfaces; projecting
          // gravity onto them is what made players slide on floors.
          if (this.velocity.y < 0) this.velocity.y = 0;
        } else {
          // Only remove velocity INTO a wall — never reflect it — and flatten
          // upward-facing riser/seam normals so running into them cannot
          // convert forward speed into a launch ("propelled to oblivion").
          if (_normal.y > 0) _normal.set(_normal.x, 0, _normal.z).normalize();
          const intoSurface = this.velocity.dot(_normal);
          if (intoSurface < 0) this.velocity.addScaledVector(_normal, -intoSurface);
        }
      }
    }
    if (updateGround) {
      this.onFloor = this.grounded = grounded;
      if (grounded && this.velocity.y < 0) this.velocity.y = 0;
    }
  }

  /**
   * Confirm a walkable floor right under the feet independently of capsule
   * penetration.  Near a floor/wall seam an Octree can merge both contacts
   * into a wall-heavy normal; this short ray keeps the floor.
   */
  _probeGround() {
    if (!this.worldReady || typeof this.worldOctree.rayIntersect !== 'function') return false;
    const feetY = this.collider.start.y - this.radius;
    _probeRay.origin.set(this.collider.start.x, feetY + this.groundProbeDistance, this.collider.start.z);
    const reach = this.groundProbeDistance + this.skin * 2;
    const hit = this.worldOctree.rayIntersect(_probeRay, 0, reach);
    if (!hit || hit.distance > reach) return false;
    hit.triangle.getNormal(_normal);
    if (_normal.y < this.floorNormalY) return false;
    this.groundNormal.copy(_normal);
    return true;
  }

  _syncCamera() {
    const feetY = this.collider.start.y - this.radius;
    this.camera.position.set(this.collider.start.x, feetY + this.eyeHeight, this.collider.start.z);
    if (this.driveCameraRotation) this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

export default PlayerController;
