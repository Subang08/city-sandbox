import { clamp01, lerp, smoothstep } from '../../lib/mathx.js';

/**
 * Animation library - model-independent. Every function drives Group pivots of a
 * CharacterModel rig; swapping in a GLB rig means re-implementing these five
 * functions, nothing else in the codebase changes.
 */

const BASE = {
  hipsY: 1.0,
  torso: 0,
  armL: 0,
  armR: 0,
  legL: 0,
  legR: 0,
  kneeL: 0,
  kneeR: 0,
  head: 0,
  lean: 0,
};

function reset(model) {
  model.hips.position.y = BASE.hipsY;
  model.hips.position.x = 0;
  model.hips.position.z = 0;
  model.hips.rotation.set(0, 0, 0);
  model.torso.rotation.set(0, 0, 0);
  model.armL.rotation.set(0, 0, 0);
  model.armR.rotation.set(0, 0, 0);
  model.legL.rotation.set(0, 0, 0);
  model.legR.rotation.set(0, 0, 0);
  model.head.rotation.set(0, 0, 0);
  model.carrySocket.rotation.set(0, 0, 0);
}

export function animateIdle(model, t, speedScale = 1) {
  reset(model);
  const breathe = Math.sin(t * 1.4 * speedScale) * 0.02;
  model.hips.position.y = BASE.hipsY + breathe;
  model.torso.rotation.x = -0.02 + Math.sin(t * 0.7) * 0.02;
  model.armL.rotation.x = 0.06 + Math.sin(t * 1.1) * 0.04;
  model.armR.rotation.x = -0.06 + Math.sin(t * 1.3 + 1) * 0.04;
  model.armL.rotation.z = 0.12;
  model.armR.rotation.z = -0.12;
  model.head.rotation.y = Math.sin(t * 0.35) * 0.5;
  model.head.rotation.x = Math.sin(t * 0.23) * 0.08;
}

export function animateWalk(model, t, speed = 1.3, carry = false) {
  reset(model);
  const stride = clamp01(speed / 1.6);
  const phase = t * (5.2 + stride * 2.4);
  const swing = 0.42 + stride * 0.35;
  model.legL.rotation.x = Math.sin(phase) * swing;
  model.legR.rotation.x = Math.sin(phase + Math.PI) * swing;
  model.armL.rotation.x = Math.sin(phase + Math.PI) * (carry ? 0.12 : swing * 0.72);
  model.armR.rotation.x = Math.sin(phase) * (carry ? 0.12 : swing * 0.72);
  model.armL.rotation.z = 0.1 + (carry ? 0.35 : 0);
  model.armR.rotation.z = -0.1 - (carry ? 0.35 : 0);
  if (carry) {
    model.armL.rotation.x = -1.25 + Math.sin(phase) * 0.06;
    model.armR.rotation.x = -1.25 + Math.sin(phase + 1) * 0.06;
  }
  model.hips.position.y = BASE.hipsY + Math.abs(Math.sin(phase)) * 0.045 - 0.02;
  model.hips.rotation.y = Math.sin(phase) * 0.12;
  model.torso.rotation.y = -Math.sin(phase) * 0.16;
  model.torso.rotation.x = carry ? -0.06 : 0.08;
  model.head.rotation.x = carry ? 0.08 : -0.04;
}

export function animateCarry(model, t, speed = 1.2, objectHeavy = false) {
  reset(model);
  const phase = t * (4.4 + speed);
  model.legL.rotation.x = Math.sin(phase) * 0.3;
  model.legR.rotation.x = Math.sin(phase + Math.PI) * 0.3;
  model.armL.rotation.x = -1.15;
  model.armR.rotation.x = -1.15;
  model.armL.rotation.z = 0.3;
  model.armR.rotation.z = -0.3;
  model.hips.position.y = BASE.hipsY + Math.abs(Math.sin(phase)) * 0.03 - 0.05;
  model.torso.rotation.x = objectHeavy ? -0.18 : -0.08;
  model.hips.rotation.y = Math.sin(phase) * 0.08;
}

export function animateTalk(model, t) {
  reset(model);
  const gesture = Math.sin(t * 3.1);
  model.armR.rotation.x = -0.9 + gesture * 0.25;
  model.armR.rotation.z = -0.5 + gesture * 0.12;
  model.armL.rotation.x = -0.2;
  model.armL.rotation.z = 0.3;
  model.torso.rotation.y = gesture * 0.12;
  model.head.rotation.y = gesture * 0.18;
  model.head.rotation.x = Math.sin(t * 4.2) * 0.06;
}

export function animateRest(model, t) {
  reset(model);
  model.hips.position.y = BASE.hipsY - 0.42;
  model.hips.rotation.x = 0.15;
  model.legL.rotation.x = 1.1;
  model.legR.rotation.x = 1.25;
  model.torso.rotation.x = -0.12;
  model.armL.rotation.x = -0.5 + Math.sin(t * 1.6) * 0.05;
  model.armR.rotation.x = -0.35 + Math.sin(t * 1.9) * 0.06;
  model.armL.rotation.z = 0.5;
  model.armR.rotation.z = -0.45;
  model.head.rotation.x = -0.1;
}

/**
 * Task-specific work motions. Every task keeps both feet planted, which reads
 * correctly at diorama scale and avoids IK work.
 */
export function animateWork(model, t, task = 'masonry') {
  reset(model);
  const planted = 0.06;
  switch (task) {
    case 'rebar-carry':
    case 'material': {
      animateCarry(model, t, 1.0, true);
      return;
    }
    case 'slab-pour':
    case 'pour': {
      const push = (Math.sin(t * 2.2) + 1) * 0.5;
      model.torso.rotation.x = -0.35 - push * 0.25;
      model.armL.rotation.x = -1.1 - push * 0.5;
      model.armR.rotation.x = -1.0 - push * 0.5;
      model.armL.rotation.z = 0.35;
      model.armR.rotation.z = -0.35;
      model.hips.position.y = BASE.hipsY - 0.08 - push * 0.06;
      model.legL.rotation.x = 0.25;
      model.legR.rotation.x = -0.25;
      break;
    }
    case 'masonry': {
      const hammer = Math.max(0, Math.sin(t * 5.0));
      const strike = hammer * hammer;
      model.armR.rotation.x = -1.5 + strike * 1.0;
      model.armR.rotation.z = -0.25 - strike * 0.2;
      model.armL.rotation.x = -0.75;
      model.armL.rotation.z = 0.42;
      model.torso.rotation.x = 0.08 + strike * 0.12;
      model.hips.position.y = BASE.hipsY - 0.04 - strike * 0.03;
      model.legL.rotation.x = 0.2;
      model.legR.rotation.x = -0.16;
      if (strike > 0.92) model.head.rotation.x = 0.1;
      break;
    }
    case 'signal': {
      const wave = Math.sin(t * 2.6);
      model.armR.rotation.x = -2.4 + wave * 0.5;
      model.armR.rotation.z = -0.15;
      model.armL.rotation.x = -0.3 + Math.sin(t * 1.3) * 0.2;
      model.torso.rotation.y = wave * 0.25;
      model.head.rotation.x = -0.25;
      break;
    }
    case 'survey': {
      const adjust = Math.sin(t * 0.9);
      model.torso.rotation.x = -0.28;
      model.armL.rotation.x = -1.35 + adjust * 0.1;
      model.armR.rotation.x = -1.35 - adjust * 0.1;
      model.armL.rotation.z = 0.28;
      model.armR.rotation.z = -0.28;
      model.hips.position.y = BASE.hipsY - 0.12;
      model.legL.rotation.x = 0.18;
      model.legR.rotation.x = -0.18;
      break;
    }
    case 'wiring': {
      const reach = (Math.sin(t * 1.6) + 1) * 0.5;
      model.armR.rotation.x = -2.2 - reach * 0.5;
      model.armL.rotation.x = -0.6 + reach * 0.4;
      model.armL.rotation.z = 0.3;
      model.torso.rotation.x = -0.1 * reach;
      model.head.rotation.x = -0.35 * reach;
      break;
    }
    case 'dig': {
      const scoop = (Math.sin(t * 1.8) + 1) * 0.5;
      model.torso.rotation.x = -0.3 + scoop * 0.5;
      model.armL.rotation.x = -1.2 - scoop * 0.6;
      model.armR.rotation.x = -1.2 - scoop * 0.6;
      model.hips.position.y = BASE.hipsY - 0.15 - scoop * 0.08;
      model.legL.rotation.x = 0.3;
      model.legR.rotation.x = -0.22;
      break;
    }
    case 'patrol': {
      animateWalk(model, t, 1.05, false);
      model.head.rotation.y = Math.sin(t * 0.8) * 0.6;
      return;
    }
    case 'inspect': {
      const lean = 0.4 + Math.sin(t * 1.1) * 0.08;
      model.torso.rotation.x = -lean * 0.6;
      model.armR.rotation.x = -1.1;
      model.armL.rotation.x = -0.4;
      model.head.rotation.x = -0.3;
      model.hips.position.y = BASE.hipsY - 0.1;
      break;
    }
    case 'lift': {
      const cycle = (t * 0.6) % 1;
      const lift = smoothstep(cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2);
      model.torso.rotation.x = -0.5 + lift * 0.45;
      model.armL.rotation.x = -1.4 + lift * 0.6;
      model.armR.rotation.x = -1.4 + lift * 0.6;
      model.hips.position.y = BASE.hipsY - 0.18 + lift * 0.16;
      model.legL.rotation.x = 0.35 - lift * 0.2;
      model.legR.rotation.x = -0.3 + lift * 0.2;
      break;
    }
    default: {
      const swing = Math.sin(t * 3.4);
      model.armR.rotation.x = -1.1 + swing * 0.35;
      model.armL.rotation.x = -0.5 - swing * 0.2;
      model.torso.rotation.x = 0.06;
      model.hips.position.y = BASE.hipsY - 0.03;
      model.legL.rotation.x = 0.14;
      model.legR.rotation.x = -0.1;
      break;
    }
  }
  model.legL.rotation.z = planted;
  model.legR.rotation.z = -planted;
}

export function animateByState(model, state, time, params = {}) {
  switch (state) {
    case 'WALK':
      animateWalk(model, time, params.speed || 1.3, false);
      break;
    case 'CARRY':
      animateCarry(model, time, params.speed || 1.2, Boolean(params.heavy));
      break;
    case 'WORK':
      animateWork(model, time, params.task);
      break;
    case 'TALK':
      animateTalk(model, time);
      break;
    case 'REST':
      animateRest(model, time);
      break;
    case 'IDLE':
    default:
      animateIdle(model, time, params.energy || 1);
      break;
  }
  void lerp;
}
