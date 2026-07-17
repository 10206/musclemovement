// Movement registry — which muscles do what.
//
// This file holds anatomical FACTS only: "movement X is driven by muscles Y".
// It deliberately knows nothing about the rig — no bone names, no rotation
// axes, no signs, no angle limits. That mapping lives in joints.ts, which is
// calibrated against whatever skeleton is currently loaded.
//
// The split matters: when the real anatomical model (P6) replaces the
// placeholder mannequin, joints.ts gets recalibrated and this file does not
// change at all.
//
// Sourcing: anatomical facts are not copyrightable (only a given source's
// specific wording/table/images are), so this is written from scratch against
// our own schema rather than copied from any single reference. Content was
// corroborated across OpenStax A&P 2e (CC BY), Wikipedia (CC BY-SA),
// Physiopedia, and standard kinesiology texts (Kendall, Neumann). ExRx and
// Kenhub explicitly forbid scraping/republishing and were not used as sources.

import { MUSCLES, type Muscle, type MuscleSide } from './muscles'

/** Anatomical joints we model. Mapped to concrete bones by joints.ts. */
export type JointName = 'shoulder' | 'elbow' | 'hip' | 'knee' | 'ankle' | 'spine'

/** Direction of travel at a joint, in standard anatomical terms. */
export type JointAction = 'flexion' | 'extension' | 'abduction' | 'adduction'

/** A joint moving in a direction. joints.ts resolves this to (bone, axis, sign). */
export type JointMotion = { joint: JointName; action: JointAction }

/**
 * A muscle's part in a movement.
 * - `prime`      prime mover / agonist — does the work
 * - `synergist`  assists, stabilises, or contributes at part of the range
 * - `antagonist` opposes; lengthens (often eccentrically) to control the motion
 */
export type Role = 'prime' | 'synergist' | 'antagonist'

/** `muscle` is a `key` from muscles.ts (side-agnostic). */
export type Activation = { muscle: string; role: Role }

export type MovementDef = {
  key: string
  ko: string
  en: string
  /**
   * `unilateral` — happens on one side at a time (an arm curl). Resolved
   *   against a specific side, and drivable by dragging that limb.
   * `bilateral`  — inherently whole-body/both-sides (a squat). Always resolves
   *   to both sides plus centre muscles.
   */
  laterality: 'unilateral' | 'bilateral'
  /** Joint motions that constitute this movement. Used to (a) drive the */
  /* placeholder clip generator and (b) recognise the movement from a live IK
     drag by matching against observed joint deltas. */
  motions: JointMotion[]
  muscles: Activation[]
}

// -- The registry ---------------------------------------------------------
//
// Ordering within `muscles` is meaningful for display: primes first, then
// synergists, then antagonists, each roughly in order of contribution.

export const MOVEMENTS: readonly MovementDef[] = [
  {
    key: 'shoulder_flexion',
    ko: '어깨 굽힘 (팔 앞으로 들기)',
    en: 'Shoulder flexion',
    laterality: 'unilateral',
    motions: [{ joint: 'shoulder', action: 'flexion' }],
    muscles: [
      { muscle: 'deltoid_anterior', role: 'prime' },
      { muscle: 'pectoralis_major_clavicular', role: 'prime' },
      { muscle: 'coracobrachialis', role: 'synergist' },
      { muscle: 'biceps_brachii', role: 'synergist' },
      // The glenohumeral joint only supplies ~120deg (see joints.ts); the rest
      // of the arc is the scapula rotating upward, and these are what rotate
      // it. Listed for abduction from the start — omitting them here was an
      // oversight, the shoulder doesn't flex overhead without them either.
      { muscle: 'serratus_anterior', role: 'synergist' },
      { muscle: 'trapezius', role: 'synergist' },
      // Rotator cuff: holds the humeral head down and in the socket so the
      // deltoid's pull becomes rotation instead of just shoving the head up.
      { muscle: 'subscapularis', role: 'synergist' },
      { muscle: 'infraspinatus', role: 'synergist' },
      { muscle: 'latissimus_dorsi', role: 'antagonist' },
      { muscle: 'teres_major', role: 'antagonist' },
      { muscle: 'deltoid_posterior', role: 'antagonist' },
    ],
  },
  {
    key: 'shoulder_abduction',
    ko: '어깨 벌림 (팔 옆으로 들기)',
    en: 'Shoulder abduction',
    laterality: 'unilateral',
    motions: [{ joint: 'shoulder', action: 'abduction' }],
    muscles: [
      // Supraspinatus initiates the first ~15deg, then the middle deltoid
      // takes over as prime mover through mid-range.
      { muscle: 'deltoid_medius', role: 'prime' },
      { muscle: 'supraspinatus', role: 'prime' },
      { muscle: 'deltoid_anterior', role: 'synergist' },
      // Serratus anterior + trapezius upwardly rotate the scapula, which is
      // what permits abduction past ~90deg at all.
      { muscle: 'serratus_anterior', role: 'synergist' },
      { muscle: 'trapezius', role: 'synergist' },
      // Without the cuff pulling the head down, the humerus jams into the
      // acromion and abduction simply stops — they're not optional here.
      { muscle: 'infraspinatus', role: 'synergist' },
      { muscle: 'teres_minor', role: 'synergist' },
      { muscle: 'subscapularis', role: 'synergist' },
      { muscle: 'latissimus_dorsi', role: 'antagonist' },
      { muscle: 'pectoralis_major_clavicular', role: 'antagonist' },
      { muscle: 'teres_major', role: 'antagonist' },
    ],
  },
  {
    key: 'shoulder_extension',
    ko: '어깨 폄 (팔 뒤로 보내기)',
    en: 'Shoulder extension',
    laterality: 'unilateral',
    motions: [{ joint: 'shoulder', action: 'extension' }],
    muscles: [
      { muscle: 'latissimus_dorsi', role: 'prime' },
      { muscle: 'deltoid_posterior', role: 'prime' },
      { muscle: 'teres_major', role: 'synergist' },
      // Long head only — it's the part of triceps that crosses the shoulder.
      { muscle: 'triceps_brachii', role: 'synergist' },
      // Scapular retraction gives the arm something to pull back against.
      { muscle: 'rhomboid_major', role: 'synergist' },
      { muscle: 'teres_minor', role: 'synergist' },
      { muscle: 'deltoid_anterior', role: 'antagonist' },
      { muscle: 'pectoralis_major_clavicular', role: 'antagonist' },
      { muscle: 'coracobrachialis', role: 'antagonist' },
    ],
  },
  {
    key: 'elbow_flexion',
    ko: '팔꿈치 굽힘 (컬)',
    en: 'Elbow flexion',
    laterality: 'unilateral',
    motions: [{ joint: 'elbow', action: 'flexion' }],
    muscles: [
      { muscle: 'biceps_brachii', role: 'prime' },
      { muscle: 'brachialis', role: 'prime' },
      { muscle: 'brachioradialis', role: 'synergist' },
      // Weak, but a genuine elbow flexor as well as a pronator.
      { muscle: 'pronator_teres', role: 'synergist' },
      { muscle: 'triceps_brachii', role: 'antagonist' },
    ],
  },
  {
    key: 'elbow_extension',
    ko: '팔꿈치 폄',
    en: 'Elbow extension',
    laterality: 'unilateral',
    motions: [{ joint: 'elbow', action: 'extension' }],
    muscles: [
      { muscle: 'triceps_brachii', role: 'prime' },
      { muscle: 'anconeus', role: 'synergist' },
      { muscle: 'biceps_brachii', role: 'antagonist' },
      { muscle: 'brachialis', role: 'antagonist' },
    ],
  },
  {
    key: 'hip_flexion',
    ko: '엉덩관절 굽힘 (무릎 올리기)',
    en: 'Hip flexion',
    laterality: 'unilateral',
    motions: [{ joint: 'hip', action: 'flexion' }],
    muscles: [
      { muscle: 'iliopsoas', role: 'prime' },
      { muscle: 'rectus_femoris', role: 'prime' },
      { muscle: 'sartorius', role: 'synergist' },
      { muscle: 'tensor_fasciae_latae', role: 'synergist' },
      { muscle: 'pectineus', role: 'synergist' },
      // The short adductors flex the hip from an extended position.
      { muscle: 'adductor_longus', role: 'synergist' },
      { muscle: 'adductor_brevis', role: 'synergist' },
      { muscle: 'gluteus_maximus', role: 'antagonist' },
      { muscle: 'biceps_femoris', role: 'antagonist' },
      { muscle: 'semitendinosus', role: 'antagonist' },
      { muscle: 'semimembranosus', role: 'antagonist' },
    ],
  },
  {
    key: 'hip_extension',
    ko: '엉덩관절 폄',
    en: 'Hip extension',
    laterality: 'unilateral',
    motions: [{ joint: 'hip', action: 'extension' }],
    muscles: [
      { muscle: 'gluteus_maximus', role: 'prime' },
      { muscle: 'biceps_femoris', role: 'prime' },
      { muscle: 'semitendinosus', role: 'prime' },
      { muscle: 'semimembranosus', role: 'prime' },
      // The posterior ("hamstring part") fibres of adductor magnus extend the hip.
      { muscle: 'adductor_magnus', role: 'synergist' },
      // Gluteus medius's posterior fibres extend as well as abduct.
      { muscle: 'gluteus_medius', role: 'synergist' },
      { muscle: 'iliopsoas', role: 'antagonist' },
      { muscle: 'rectus_femoris', role: 'antagonist' },
    ],
  },
  {
    key: 'knee_flexion',
    ko: '무릎 굽힘',
    en: 'Knee flexion',
    laterality: 'unilateral',
    motions: [{ joint: 'knee', action: 'flexion' }],
    muscles: [
      { muscle: 'biceps_femoris', role: 'prime' },
      { muscle: 'semitendinosus', role: 'prime' },
      { muscle: 'semimembranosus', role: 'prime' },
      { muscle: 'gracilis', role: 'synergist' },
      { muscle: 'sartorius', role: 'synergist' },
      // Popliteus unlocks the extended knee; gastrocnemius assists at end range.
      { muscle: 'popliteus', role: 'synergist' },
      { muscle: 'gastrocnemius', role: 'synergist' },
      { muscle: 'rectus_femoris', role: 'antagonist' },
      { muscle: 'vastus_lateralis', role: 'antagonist' },
      { muscle: 'vastus_medialis', role: 'antagonist' },
      { muscle: 'vastus_intermedius', role: 'antagonist' },
    ],
  },
  {
    key: 'knee_extension',
    ko: '무릎 폄',
    en: 'Knee extension',
    laterality: 'unilateral',
    motions: [{ joint: 'knee', action: 'extension' }],
    muscles: [
      // The four heads of quadriceps femoris act as mutual synergists — there
      // is no separate synergist tier for this movement.
      { muscle: 'rectus_femoris', role: 'prime' },
      { muscle: 'vastus_lateralis', role: 'prime' },
      { muscle: 'vastus_medialis', role: 'prime' },
      { muscle: 'vastus_intermedius', role: 'prime' },
      { muscle: 'biceps_femoris', role: 'antagonist' },
      { muscle: 'semitendinosus', role: 'antagonist' },
      { muscle: 'semimembranosus', role: 'antagonist' },
    ],
  },
  {
    key: 'trunk_flexion',
    ko: '몸통 굽힘',
    en: 'Trunk flexion',
    laterality: 'bilateral',
    motions: [{ joint: 'spine', action: 'flexion' }],
    muscles: [
      { muscle: 'rectus_abdominis', role: 'prime' },
      { muscle: 'external_oblique', role: 'synergist' },
      { muscle: 'internal_oblique', role: 'synergist' },
      // With the legs fixed, psoas pulls the trunk toward the thighs — this is
      // why a sit-up is only partly an abdominal exercise.
      { muscle: 'iliopsoas', role: 'synergist' },
      { muscle: 'quadratus_lumborum', role: 'synergist' },
      { muscle: 'erector_spinae', role: 'antagonist' },
    ],
  },
  {
    key: 'squat',
    ko: '스쿼트',
    en: 'Squat',
    laterality: 'bilateral',
    // Closed-chain: hips and knees flex together on the way down and extend
    // together on the way up. There is no single antagonist — the hip flexors
    // and ankle dorsiflexors lengthen eccentrically to control the descent.
    motions: [
      { joint: 'hip', action: 'flexion' },
      { joint: 'knee', action: 'flexion' },
      { joint: 'ankle', action: 'flexion' },
    ],
    muscles: [
      { muscle: 'rectus_femoris', role: 'prime' },
      { muscle: 'vastus_lateralis', role: 'prime' },
      { muscle: 'vastus_medialis', role: 'prime' },
      { muscle: 'vastus_intermedius', role: 'prime' },
      { muscle: 'gluteus_maximus', role: 'prime' },
      { muscle: 'biceps_femoris', role: 'prime' },
      { muscle: 'semitendinosus', role: 'prime' },
      { muscle: 'semimembranosus', role: 'prime' },
      { muscle: 'adductor_magnus', role: 'synergist' },
      // The frontal plane. Gluteus medius/minimus are what stop the pelvis
      // dropping and the knee caving in — the most common thing a squat
      // actually fails on, and the app was silent about them.
      { muscle: 'gluteus_medius', role: 'synergist' },
      { muscle: 'gluteus_minimus', role: 'synergist' },
      { muscle: 'adductor_longus', role: 'synergist' },
      // Trunk muscles here are anti-flexion / bracing, not movers.
      { muscle: 'erector_spinae', role: 'synergist' },
      { muscle: 'rectus_abdominis', role: 'synergist' },
      { muscle: 'external_oblique', role: 'synergist' },
      // Dorsiflexors control how far the shin travels over the foot.
      { muscle: 'tibialis_anterior', role: 'synergist' },
      { muscle: 'gastrocnemius', role: 'synergist' },
      { muscle: 'soleus', role: 'synergist' },
    ],
  },
  {
    key: 'sit_to_stand',
    ko: '앉았다 일어서기',
    en: 'Sit to stand',
    laterality: 'bilateral',
    motions: [
      { joint: 'hip', action: 'extension' },
      { joint: 'knee', action: 'extension' },
    ],
    muscles: [
      { muscle: 'rectus_femoris', role: 'prime' },
      { muscle: 'vastus_lateralis', role: 'prime' },
      { muscle: 'vastus_medialis', role: 'prime' },
      { muscle: 'vastus_intermedius', role: 'prime' },
      { muscle: 'gluteus_maximus', role: 'prime' },
      { muscle: 'biceps_femoris', role: 'prime' },
      { muscle: 'semitendinosus', role: 'prime' },
      { muscle: 'semimembranosus', role: 'prime' },
      { muscle: 'gluteus_medius', role: 'synergist' },
      { muscle: 'gluteus_minimus', role: 'synergist' },
      { muscle: 'erector_spinae', role: 'synergist' },
      { muscle: 'rectus_abdominis', role: 'synergist' },
      // Tibialis anterior drives the momentum-transfer phase (pulling the
      // shin forward over the foot); the calf stabilises once upright.
      { muscle: 'tibialis_anterior', role: 'synergist' },
      { muscle: 'gastrocnemius', role: 'synergist' },
      { muscle: 'soleus', role: 'synergist' },
    ],
  },
] as const

export const MOVEMENT_BY_KEY: ReadonlyMap<string, MovementDef> = new Map(
  MOVEMENTS.map((m) => [m.key, m]),
)

// -- Resolution against the muscle registry -------------------------------

/** An activation resolved to concrete `Muscle` records (i.e. real ids). */
export type ResolvedActivation = { muscle: Muscle; role: Role }

const MUSCLES_BY_KEY_SIDE = new Map<string, Muscle>(
  MUSCLES.map((m) => [`${m.key}:${m.side}`, m]),
)

/**
 * Resolve a movement's side-agnostic muscle keys into concrete `Muscle`
 * records for a given side.
 *
 * - A `unilateral` movement resolves against `side` ('L' or 'R'); muscles that
 *   only exist as a centre structure (e.g. rectus abdominis) still resolve.
 * - A `bilateral` movement ignores `side` and resolves both sides plus centre.
 *
 * Unknown muscle keys are dropped rather than throwing: the registry is the
 * source of truth for what exists, and a movement naming a muscle we don't
 * model yet should degrade quietly rather than break the render.
 */
export function resolveMovement(
  movement: MovementDef,
  side: MuscleSide = 'L',
): ResolvedActivation[] {
  const sides: MuscleSide[] =
    movement.laterality === 'bilateral' ? ['L', 'R', 'C'] : [side, 'C']

  const out: ResolvedActivation[] = []
  const seen = new Set<number>()

  for (const activation of movement.muscles) {
    for (const s of sides) {
      const muscle = MUSCLES_BY_KEY_SIDE.get(`${activation.muscle}:${s}`)
      if (muscle && !seen.has(muscle.id)) {
        seen.add(muscle.id)
        out.push({ muscle, role: activation.role })
      }
    }
  }
  return out
}

/**
 * Find the movement that best matches a set of observed joint motions —
 * used to name/highlight what the user just did with an IK drag.
 *
 * Scores by how much of the movement's motion set the observation covers,
 * penalising movements that require motions we didn't observe. Returns null
 * when nothing matches, so a drag that isn't a movement we model highlights
 * nothing rather than something wrong.
 */
export function matchMovement(observed: readonly JointMotion[]): MovementDef | null {
  if (observed.length === 0) return null

  const key = (m: JointMotion) => `${m.joint}:${m.action}`
  const observedKeys = new Set(observed.map(key))

  let best: MovementDef | null = null
  let bestScore = 0

  for (const movement of MOVEMENTS) {
    const required = movement.motions.map(key)
    const matched = required.filter((k) => observedKeys.has(k)).length
    if (matched === 0) continue

    // Full coverage of the movement's motions, then prefer the movement whose
    // motion set is closest in size to what we saw (so a lone knee flexion
    // matches 'knee_flexion', not 'squat').
    const coverage = matched / required.length
    const precision = matched / observedKeys.size
    const score = coverage * precision

    if (score > bestScore) {
      bestScore = score
      best = movement
    }
  }
  return best
}
