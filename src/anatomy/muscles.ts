// Muscle registry — the single source of truth for id <-> muscle identity.
//
// `id` is the value baked into every vertex's `aMuscleId` attribute by
// tools/build-anatomy.mjs, and the index highlight/HighlightLUT.ts colours by.
// Nothing else may assign ids: this file owns the numbering so a given id
// always means the same muscle everywhere in the app — including inside the
// shipped GLB, so changing an id here means rebuilding the model.
//
// Which BodyParts3D/Z-Anatomy meshes make up each muscle is deliberately NOT
// here — that's tools/anatomy-map.mjs, which is asset-pipeline concern. This
// file stays pure anatomy.
//
// Coverage: every muscle named in movements.ts, left/right pairs included.
// Individual heads are listed separately where the movement table counts them
// (hamstrings, quadriceps) because an Activation references one key at a time.

/** Coarse anatomical region, used for grouping/filtering in later UI. */
export type MuscleGroup = 'shoulder' | 'arm' | 'forearm' | 'trunk' | 'thigh' | 'calf'

export type MuscleSide = 'L' | 'R' | 'C'

export type Muscle = {
  /** 1:1 with the `aMuscleId` vertex attribute. 0 is reserved for "none". */
  id: number
  /** Stable identifier shared by the L/R pair, e.g. 'deltoid_anterior'. */
  key: string
  /** Korean anatomical name. */
  ko: string
  /** English name. */
  en: string
  /** Latin (official anatomical) name. */
  la: string
  group: MuscleGroup
  side: MuscleSide
}

/** One entry per anatomical muscle; `sides` expands it into 1-2 `Muscle` records. */
type MuscleDef = {
  key: string
  ko: string
  en: string
  la: string
  group: MuscleGroup
  sides: readonly MuscleSide[]
}

const MUSCLE_DEFS: readonly MuscleDef[] = [
  // -- shoulder --------------------------------------------------------
  { key: 'deltoid_anterior', ko: '앞어깨세모근', en: 'Anterior deltoid', la: 'Musculus deltoideus (pars clavicularis)', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'deltoid_medius', ko: '중간어깨세모근', en: 'Middle deltoid', la: 'Musculus deltoideus (pars acromialis)', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'deltoid_posterior', ko: '뒤어깨세모근', en: 'Posterior deltoid', la: 'Musculus deltoideus (pars spinalis)', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'supraspinatus', ko: '가시위근', en: 'Supraspinatus', la: 'Musculus supraspinatus', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'pectoralis_major_clavicular', ko: '큰가슴근(빗장뼈갈래)', en: 'Pectoralis major (clavicular head)', la: 'Musculus pectoralis major (caput claviculare)', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'serratus_anterior', ko: '앞톱니근', en: 'Serratus anterior', la: 'Musculus serratus anterior', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'trapezius', ko: '등세모근', en: 'Trapezius', la: 'Musculus trapezius', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'latissimus_dorsi', ko: '넓은등근', en: 'Latissimus dorsi', la: 'Musculus latissimus dorsi', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'teres_major', ko: '큰원근', en: 'Teres major', la: 'Musculus teres major', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'coracobrachialis', ko: '부리위팔근', en: 'Coracobrachialis', la: 'Musculus coracobrachialis', group: 'shoulder', sides: ['L', 'R'] },

  // -- upper arm --------------------------------------------------------
  { key: 'biceps_brachii', ko: '위팔두갈래근', en: 'Biceps brachii', la: 'Musculus biceps brachii', group: 'arm', sides: ['L', 'R'] },
  { key: 'brachialis', ko: '위팔근', en: 'Brachialis', la: 'Musculus brachialis', group: 'arm', sides: ['L', 'R'] },
  { key: 'triceps_brachii', ko: '위팔세갈래근', en: 'Triceps brachii', la: 'Musculus triceps brachii', group: 'arm', sides: ['L', 'R'] },

  // -- forearm --------------------------------------------------------
  { key: 'brachioradialis', ko: '위팔노근', en: 'Brachioradialis', la: 'Musculus brachioradialis', group: 'forearm', sides: ['L', 'R'] },
  { key: 'anconeus', ko: '팔꿈치근', en: 'Anconeus', la: 'Musculus anconeus', group: 'forearm', sides: ['L', 'R'] },

  // -- trunk --------------------------------------------------------
  { key: 'rectus_abdominis', ko: '배곧은근', en: 'Rectus abdominis', la: 'Musculus rectus abdominis', group: 'trunk', sides: ['C'] },
  { key: 'external_oblique', ko: '배바깥빗근', en: 'External oblique', la: 'Musculus obliquus externus abdominis', group: 'trunk', sides: ['L', 'R'] },
  { key: 'internal_oblique', ko: '배속빗근', en: 'Internal oblique', la: 'Musculus obliquus internus abdominis', group: 'trunk', sides: ['L', 'R'] },
  { key: 'erector_spinae', ko: '척주세움근', en: 'Erector spinae', la: 'Musculus erector spinae', group: 'trunk', sides: ['L', 'R'] },

  // -- hip / thigh --------------------------------------------------------
  { key: 'iliopsoas', ko: '엉덩허리근', en: 'Iliopsoas', la: 'Musculus iliopsoas', group: 'thigh', sides: ['L', 'R'] },
  { key: 'rectus_femoris', ko: '넙다리곧은근', en: 'Rectus femoris', la: 'Musculus rectus femoris', group: 'thigh', sides: ['L', 'R'] },
  { key: 'sartorius', ko: '넙다리빗근', en: 'Sartorius', la: 'Musculus sartorius', group: 'thigh', sides: ['L', 'R'] },
  { key: 'tensor_fasciae_latae', ko: '넙다리근막긴장근', en: 'Tensor fasciae latae', la: 'Musculus tensor fasciae latae', group: 'thigh', sides: ['L', 'R'] },
  { key: 'pectineus', ko: '두덩근', en: 'Pectineus', la: 'Musculus pectineus', group: 'thigh', sides: ['L', 'R'] },
  { key: 'gluteus_maximus', ko: '큰볼기근', en: 'Gluteus maximus', la: 'Musculus gluteus maximus', group: 'thigh', sides: ['L', 'R'] },
  { key: 'biceps_femoris', ko: '넙다리두갈래근', en: 'Biceps femoris', la: 'Musculus biceps femoris', group: 'thigh', sides: ['L', 'R'] },
  { key: 'semitendinosus', ko: '반힘줄모양근', en: 'Semitendinosus', la: 'Musculus semitendinosus', group: 'thigh', sides: ['L', 'R'] },
  { key: 'semimembranosus', ko: '반막모양근', en: 'Semimembranosus', la: 'Musculus semimembranosus', group: 'thigh', sides: ['L', 'R'] },
  { key: 'adductor_magnus', ko: '큰모음근', en: 'Adductor magnus', la: 'Musculus adductor magnus', group: 'thigh', sides: ['L', 'R'] },
  { key: 'vastus_lateralis', ko: '가쪽넓은근', en: 'Vastus lateralis', la: 'Musculus vastus lateralis', group: 'thigh', sides: ['L', 'R'] },
  { key: 'vastus_medialis', ko: '안쪽넓은근', en: 'Vastus medialis', la: 'Musculus vastus medialis', group: 'thigh', sides: ['L', 'R'] },
  { key: 'vastus_intermedius', ko: '중간넓은근', en: 'Vastus intermedius', la: 'Musculus vastus intermedius', group: 'thigh', sides: ['L', 'R'] },
  { key: 'gracilis', ko: '두덩정강근', en: 'Gracilis', la: 'Musculus gracilis', group: 'thigh', sides: ['L', 'R'] },

  // -- shin / calf --------------------------------------------------------
  { key: 'gastrocnemius', ko: '장딴지근', en: 'Gastrocnemius', la: 'Musculus gastrocnemius', group: 'calf', sides: ['L', 'R'] },
  { key: 'soleus', ko: '가자미근', en: 'Soleus', la: 'Musculus soleus', group: 'calf', sides: ['L', 'R'] },
  { key: 'tibialis_anterior', ko: '앞정강근', en: 'Tibialis anterior', la: 'Musculus tibialis anterior', group: 'calf', sides: ['L', 'R'] },
  { key: 'popliteus', ko: '오금근', en: 'Popliteus', la: 'Musculus popliteus', group: 'calf', sides: ['L', 'R'] },

  // -- appended after device testing ------------------------------------
  // These were shipped as unhighlightable scenery, which was wrong: they do
  // real work in movements the app demonstrates, so the app was showing a
  // movement while staying silent about muscles driving it. Appended rather
  // than inserted — ids are baked into the GLB's vertices, so inserting would
  // renumber everything after and silently recolour the model.

  // Rotator cuff. Absent entirely, which is a strange thing for a shoulder
  // app: these are what hold the humeral head in the socket and pull it down
  // out of the acromion's way. Without them abduction doesn't happen at all.
  { key: 'infraspinatus', ko: '가시아래근', en: 'Infraspinatus', la: 'Musculus infraspinatus', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'teres_minor', ko: '작은원근', en: 'Teres minor', la: 'Musculus teres minor', group: 'shoulder', sides: ['L', 'R'] },
  { key: 'subscapularis', ko: '어깨밑근', en: 'Subscapularis', la: 'Musculus subscapularis', group: 'shoulder', sides: ['L', 'R'] },
  // Scapular retraction — the reason the shoulder has something to pull against.
  { key: 'rhomboid_major', ko: '큰마름근', en: 'Rhomboid major', la: 'Musculus rhomboideus major', group: 'shoulder', sides: ['L', 'R'] },

  { key: 'pronator_teres', ko: '원엎침근', en: 'Pronator teres', la: 'Musculus pronator teres', group: 'forearm', sides: ['L', 'R'] },
  { key: 'quadratus_lumborum', ko: '허리네모근', en: 'Quadratus lumborum', la: 'Musculus quadratus lumborum', group: 'trunk', sides: ['L', 'R'] },

  // The frontal-plane hip. Gluteus medius is the muscle that stops the pelvis
  // dropping on every single-leg moment of a squat — omitting it from a squat
  // is a real gap, not a rounding error.
  { key: 'gluteus_medius', ko: '중간볼기근', en: 'Gluteus medius', la: 'Musculus gluteus medius', group: 'thigh', sides: ['L', 'R'] },
  { key: 'gluteus_minimus', ko: '작은볼기근', en: 'Gluteus minimus', la: 'Musculus gluteus minimus', group: 'thigh', sides: ['L', 'R'] },
  { key: 'adductor_longus', ko: '긴모음근', en: 'Adductor longus', la: 'Musculus adductor longus', group: 'thigh', sides: ['L', 'R'] },
  { key: 'adductor_brevis', ko: '짧은모음근', en: 'Adductor brevis', la: 'Musculus adductor brevis', group: 'thigh', sides: ['L', 'R'] },
] as const

/**
 * Flatten each definition's `sides` into individual `Muscle` records and
 * assign ids in declaration order, starting at 1 (0 = reserved "none", used by
 * the context muscles that fill out the figure but are never highlighted).
 *
 * Ids come from position in this list, so INSERTING a muscle renumbers every
 * one after it — and the ids are baked into the shipped GLB's vertices. Add to
 * the end, or rebuild the model (`npm run build:anatomy`).
 */
function buildRegistry(defs: readonly MuscleDef[]): Muscle[] {
  let nextId = 1
  const registry: Muscle[] = []
  for (const def of defs) {
    for (const side of def.sides) {
      registry.push({ id: nextId++, key: def.key, ko: def.ko, en: def.en, la: def.la, group: def.group, side })
    }
  }
  return registry
}

export const MUSCLES: readonly Muscle[] = buildRegistry(MUSCLE_DEFS)

export const MUSCLE_BY_ID: ReadonlyMap<number, Muscle> = new Map(MUSCLES.map((m) => [m.id, m]))

export function muscleById(id: number): Muscle | undefined {
  return MUSCLE_BY_ID.get(id)
}
