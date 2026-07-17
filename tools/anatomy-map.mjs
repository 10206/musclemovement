// Mapping: our muscle registry  <->  BodyParts3D/Z-Anatomy source node names,
// plus the rigging rule for each muscle.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS THE WHOLE TRICK
// ---------------------------------------------------------------------------
// Research said rigging an anatomical atlas is 2-4 months of Blender work.
// That estimate is for muscles that *deform* — bellies that bulge as they
// shorten, corrected per-muscle with shape keys. We don't need that: the app
// only demonstrates gross joint movement.
//
// Strip that away and almost every muscle is rigid: vastus lateralis only
// ever moves because the femur moves, so binding it 100% to the thigh bone is
// not an approximation, it's correct. The only muscles that need real blending
// are the ones that CROSS a joint — and for those, "which bone does this
// vertex follow?" is answered by anatomy we already researched (origin and
// insertion), not by painting.
//
// So instead of guessing weights from proximity (which happily binds a bicep
// to the spine because the spine is nearby), each muscle declares the bones it
// is anatomically attached to. Distance only decides the blend *within* those
// bones. That's what makes this tractable in code.
// ---------------------------------------------------------------------------
//
// Source data: BodyParts3D (CC BY-SA 2.1 JP) + Z-Anatomy (CC BY-SA 4.0), via
// the decimated glTF export in JohanBellander/BodyExplorer (code MIT).
// Node names below are verbatim from that export — see tools/analyze-source.mjs.
//
// `S` is substituted with 'left'/'right', `X` with 'L'/'R'.

/**
 * rig:
 *   { rigid: 'bone' }                        - muscle moves only with this bone
 *   { span: ['parent','child'], joint: 'j' } - crosses `joint`; vertices distal
 *                                              of it follow `child`, proximal
 *                                              follow `parent`, blended across
 *                                              JOINT_BLEND metres.
 */
export const MUSCLE_SOURCES = {
  // -- shoulder girdle ---------------------------------------------------
  // The deltoid's three "parts" in the source map exactly onto the three
  // heads our registry already models: clavicular=anterior, acromial=middle,
  // spinal=posterior. All three originate on the shoulder girdle and insert
  // on the humerus, so they span the shoulder.
  deltoid_anterior: { sources: ['clavicular part of S deltoid'], rig: { span: ['chest', 'upperArm_X'], joint: 'shoulder' } },
  deltoid_medius: { sources: ['acromial part of S deltoid'], rig: { span: ['chest', 'upperArm_X'], joint: 'shoulder' } },
  deltoid_posterior: { sources: ['spinal part of S deltoid'], rig: { span: ['chest', 'upperArm_X'], joint: 'shoulder' } },
  supraspinatus: { sources: ['S supraspinatus'], rig: { span: ['chest', 'upperArm_X'], joint: 'shoulder' } },
  // Registry models only the clavicular head of pec major (the shoulder
  // flexor); the sternocostal/abdominal parts are a different action, so they
  // are deliberately not pulled in.
  pectoralis_major_clavicular: { sources: ['clavicular part of S pectoralis major'], rig: { span: ['chest', 'upperArm_X'], joint: 'shoulder' } },
  // Scapula-to-ribcage: never crosses to the arm, so it rides the chest.
  serratus_anterior: { sources: ['S serratus anterior'], rig: { rigid: 'chest' } },
  trapezius: {
    sources: ['ascending part of S trapezius', 'descending part of S trapezius', 'transverse part of S trapezius'],
    rig: { rigid: 'chest' },
  },
  latissimus_dorsi: { sources: ['S latissimus dorsi'], rig: { span: ['spine', 'upperArm_X'], joint: 'shoulder' } },
  teres_major: { sources: ['S teres major'], rig: { span: ['chest', 'upperArm_X'], joint: 'shoulder' } },
  coracobrachialis: { sources: ['S coracobrachialis'], rig: { span: ['chest', 'upperArm_X'], joint: 'shoulder' } },

  // -- upper arm ---------------------------------------------------------
  // Biceps and triceps cross both shoulder and elbow. We span the ELBOW only:
  // their proximal ends sit essentially at the shoulder's centre of rotation,
  // so the shoulder joint barely displaces them, while the elbow does all the
  // visible work. Spanning both would need a 3-bone blend for no visible gain.
  biceps_brachii: {
    sources: ['long head of S biceps brachii', 'short head of S biceps brachii'],
    rig: { span: ['upperArm_X', 'forearm_X'], joint: 'elbow' },
  },
  brachialis: { sources: ['S brachialis'], rig: { span: ['upperArm_X', 'forearm_X'], joint: 'elbow' } },
  triceps_brachii: {
    sources: ['lateral head of S triceps brachii', 'long head of S triceps brachii', 'medial head of S triceps brachii'],
    rig: { span: ['upperArm_X', 'forearm_X'], joint: 'elbow' },
  },

  // -- forearm -----------------------------------------------------------
  brachioradialis: { sources: ['S brachioradialis'], rig: { span: ['upperArm_X', 'forearm_X'], joint: 'elbow' } },
  anconeus: { sources: ['S anconeus'], rig: { span: ['upperArm_X', 'forearm_X'], joint: 'elbow' } },

  // -- trunk -------------------------------------------------------------
  // Abdominals bridge ribcage to pelvis. Spanning the spine joint lets the
  // torso bend without the belly shearing off the pelvis.
  rectus_abdominis: { sources: ['S rectus abdominis'], rig: { span: ['hips', 'chest'], joint: 'spine' } },
  external_oblique: { sources: ['S external oblique'], rig: { span: ['hips', 'chest'], joint: 'spine' } },
  internal_oblique: { sources: ['S internal oblique'], rig: { span: ['hips', 'chest'], joint: 'spine' } },
  // "Erector spinae" is a GROUP, not one muscle — the source (correctly) ships
  // its three columns separately. Registry models the group, so we union them.
  erector_spinae: {
    sources: [
      'S iliocostalis lumborum', 'S iliocostalis thoracis', 'S iliocostalis cervicis',
      'S longissimus thoracis', 'S longissimus cervicis',
      'S spinalis thoracis',
    ],
    rig: { span: ['hips', 'chest'], joint: 'spine' },
  },

  // -- hip / thigh -------------------------------------------------------
  // Same story as erector spinae: iliopsoas is psoas major + iliacus.
  iliopsoas: { sources: ['S psoas major', 'S iliacus'], rig: { span: ['hips', 'thigh_X'], joint: 'hip' } },
  gluteus_maximus: { sources: ['S gluteus maximus'], rig: { span: ['hips', 'thigh_X'], joint: 'hip' } },
  sartorius: { sources: ['S sartorius'], rig: { span: ['hips', 'thigh_X'], joint: 'hip' } },
  tensor_fasciae_latae: { sources: ['S tensor fasciae latae'], rig: { span: ['hips', 'thigh_X'], joint: 'hip' } },
  pectineus: { sources: ['S pectineus'], rig: { span: ['hips', 'thigh_X'], joint: 'hip' } },
  adductor_magnus: { sources: ['S adductor magnus'], rig: { span: ['hips', 'thigh_X'], joint: 'hip' } },
  gracilis: { sources: ['S gracilis'], rig: { span: ['hips', 'thigh_X'], joint: 'hip' } },

  // Biarticular (hip AND knee). We span the KNEE, because that's where they
  // visibly bend; their hip end sits near the hip's rotation centre.
  rectus_femoris: { sources: ['S rectus femoris'], rig: { span: ['thigh_X', 'shin_X'], joint: 'knee' } },
  biceps_femoris: {
    sources: ['long head of S biceps femoris', 'short head of S biceps femoris'],
    rig: { span: ['thigh_X', 'shin_X'], joint: 'knee' },
  },
  semitendinosus: { sources: ['S semitendinosus'], rig: { span: ['thigh_X', 'shin_X'], joint: 'knee' } },
  semimembranosus: { sources: ['S semimembranosus'], rig: { span: ['thigh_X', 'shin_X'], joint: 'knee' } },

  // Monoarticular knee extensors: femur to patella/tibia, so they cross only
  // the knee.
  vastus_lateralis: { sources: ['S vastus lateralis'], rig: { span: ['thigh_X', 'shin_X'], joint: 'knee' } },
  vastus_medialis: { sources: ['S vastus medialis'], rig: { span: ['thigh_X', 'shin_X'], joint: 'knee' } },
  vastus_intermedius: { sources: ['S vastus intermedius'], rig: { span: ['thigh_X', 'shin_X'], joint: 'knee' } },

  // -- shin / calf -------------------------------------------------------
  gastrocnemius: {
    sources: ['lateral head of S gastrocnemius', 'medial head of S gastrocnemius'],
    rig: { span: ['thigh_X', 'shin_X'], joint: 'knee' },
  },
  popliteus: { sources: ['S popliteus'], rig: { span: ['thigh_X', 'shin_X'], joint: 'knee' } },
  // Soleus and tibialis anterior originate below the knee: pure shin.
  soleus: { sources: ['S soleus'], rig: { span: ['shin_X', 'foot_X'], joint: 'ankle' } },
  tibialis_anterior: { sources: ['S tibialis anterior'], rig: { span: ['shin_X', 'foot_X'], joint: 'ankle' } },
}

/**
 * Muscles that are shipped but never highlighted — id 0, the registry's
 * reserved "none".
 *
 * The registry only models muscles our movement table names, which is right
 * for the data but wrong for the picture: a figure with no forearms, hands,
 * feet or face doesn't read as a human body, it reads as broken. So the rest
 * of the écorché is filled in as context. Because they carry id 0, the LUT
 * leaves them permanently untinted and a double-tap on them names nothing —
 * they are scenery, and the highlight semantics stay exactly as clean as
 * before.
 *
 * Detail is deliberately asymmetric: registry muscles keep the source's full
 * ~4k triangles because they're what the user came to look at; context is
 * capped hard because it only has to hold the silhouette.
 *
 * Order matters — first match wins.
 */
export const CONTEXT_GROUPS = [
  // Deep structures nothing can ever see: larynx, pharynx, palate, tongue,
  // eyeball, middle ear, pelvic floor, diaphragm. Listed first so they lose.
  {
    match: /aryten|cricothyroid|vocalis|thyro-|crico-|veli palatini|palatoglossus|palatopharyngeus|pharyng|glossus|geniohyoid|mylohyoid|stylohyoid|digastric|levator palpebrae|(superior|inferior|medial|lateral) rectus|(superior|inferior) oblique|stapedius|tensor tympani|coccygeus|levator ani|anal sphincter|urethra|diaphragm|interosseous membrane|longus colli|longus capitis|multifidus|rotatores|intertransversarii|interspinalis|subcostal|innermost intercostal|transversus thoracis/,
    skip: true,
  },

  // ---- LEG AND FOOT MUST COME BEFORE FOREARM AND HAND ----
  // The limbs share muscle names: "flexor digitorum longus" is in the calf but
  // "flexor digitorum profundus" is in the forearm, and "extensor digitorum"
  // is a forearm muscle while "extensor digitorum longus" is a shin muscle. A
  // forearm-first rule quietly binds calf muscles to the humerus, and they
  // then fly across the screen the moment an elbow bends. (build-anatomy.mjs
  // now also asserts every muscle sits near the bone it was bound to, which is
  // what caught this — names are a bad way to tell limbs apart, geometry isn't.)
  { match: /fibularis|peroneus|tibialis posterior|(flexor|extensor) (hallucis|digitorum) longus|plantaris|calcaneal tendon/, rig: { span: ['thigh_X', 'shin_X'], joint: 'knee' }, maxTris: 700 },
  { match: /hallucis|(flexor|extensor) digitorum brevis|of (left|right) foot|quadratus plantae|plantar ligament/, rig: { span: ['shin_X', 'foot_X'], joint: 'ankle' }, maxTris: 250 },

  // Forearm: the biggest visual hole. Crosses the elbow, so it spans it.
  { match: /(extensor|flexor) (carpi|digitorum|digiti minimi|pollicis|indicis)|pronator|supinator|palmaris|retinaculum of wrist/, rig: { span: ['upperArm_X', 'forearm_X'], joint: 'elbow' }, maxTris: 700 },
  // Hand intrinsics ride the wrist.
  { match: /lumbrical|interosseous of (left|right) hand|adductor pollicis|opponens|abductor pollicis|flexor pollicis brevis|abductor digiti minimi|flexor digiti minimi brevis/, rig: { span: ['forearm_X', 'hand_X'], joint: 'wrist' }, maxTris: 250 },

  // Rotator cuff + the pec heads our registry doesn't model: real shoulder mass.
  { match: /infraspinatus|subscapularis|teres minor/, rig: { span: ['chest', 'upperArm_X'], joint: 'shoulder' }, maxTris: 900 },
  { match: /(sternocostal|abdominal) part of (left|right) pectoralis major|pectoralis minor|subclavius/, rig: { span: ['chest', 'upperArm_X'], joint: 'shoulder' }, maxTris: 900 },

  // Neck and upper back. Rhomboids/levator scapulae/serratus posterior are
  // scapular, so they ride the chest rather than the neck.
  { match: /rhomboid|levator scapulae|serratus posterior/, rig: { rigid: 'chest' }, maxTris: 700 },
  { match: /sternocleidomastoid|scalene|platysma|splenius|semispinalis|omohyoid|sternohyoid|sternothyroid|thyrohyoid|longissimus capitis/, rig: { rigid: 'neck' }, maxTris: 700 },

  // Face. Without these the head is an empty socket above the neck.
  { match: /masseter|temporalis|pterygoid|orbicularis|zygomaticus|buccinator|risorius|mentalis|depressor|levator (labii|anguli)|nasalis|procerus|corrugator|auricular|occipitofrontalis|frontalis|occipitalis|epicranial/, rig: { rigid: 'head' }, maxTris: 500 },

  // Ribcage: only the external layer, which is what shows between the ribs.
  { match: /external intercostal|quadratus lumborum|levatores costarum/, rig: { rigid: 'chest' }, maxTris: 600 },

  // Deep hip: the glutes and adductors our movement table doesn't name still
  // carry most of the hip's shape.
  { match: /gluteus (medius|minimus)|piriformis|obturator|gemellus|quadratus femoris|adductor (brevis|longus|minimus)|psoas minor|transversus abdominis/, rig: { span: ['hips', 'thigh_X'], joint: 'hip' }, maxTris: 900 },

]

/**
 * Skeleton parts we deliberately do NOT ship.
 *
 * The source is a full medical atlas; this is an exercise reference. The
 * cranial interior alone costs more triangles than both femurs (ethmoid is
 * 22k on its own) and can never be seen or moved. Dropping it buys budget
 * back for the muscles, which are the actual subject of the app.
 */
export const BONE_EXCLUDE = [
  /tooth|incisor|canine|premolar|molar/, // 32 separate meshes
  /ethmoid|vomer|palatine|lacrimal|sphenoid|nasal concha|nasal septum/, // deep cranial
  /incus|malleus|stapes/, // ear ossicles, millimetres across
  /sesamoid/,
]

/**
 * Skeleton meshes -> rig bone, for the bone-mode layer.
 *
 * Bones are perfectly rigid by definition, so this is a plain lookup with no
 * blending. Matched by regex against the source node name (lower-cased), first
 * match wins — order matters.
 */
export const BONE_RULES = [
  // limbs (most specific first)
  [/^(left|right) humerus$/, 'upperArm_X'],
  [/^(left|right) (radius|ulna)$/, 'forearm_X'],
  // The thumb has no "... finger" suffix in the source ("distal phalanx of
  // left thumb"), so the digit-name group must not require it.
  [/(carpal|metacarpal|phalanx of (left|right) (thumb|index|middle|ring|little)( finger)?|(left|right) (scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate))/, 'hand_X'],
  [/^(left|right) (femur|patella)$/, 'thigh_X'],
  [/^(left|right) (tibia|fibula)$/, 'shin_X'],
  [/(talus|calcaneus|navicular|cuboid|cuneiform|metatarsal|phalanx of (left|right) (big|second|third|fourth|little) toe)/, 'foot_X'],
  // girdles
  [/^(left|right) (scapula|clavicle)$/, 'shoulder_X'],
  [/hip bone|sacrum|coccyx/, 'hips'],
  // axial
  [/(lumbar vertebra)/, 'spine'],
  [/(thoracic vertebra)|rib|sternum|costal cartilage|manubrium|xiphoid/, 'chest'],
  [/(cervical vertebra)|^atlas$|^axis$|hyoid/, 'neck'],
  [/skull|mandible|maxilla|cranium|frontal bone|parietal|occipital|temporal|nasal|zygomatic/, 'head'],
]

/**
 * Per-mesh triangle ceiling for the bone layer, by region.
 *
 * Bones are big smooth shapes carrying far more tessellation than their
 * silhouette needs at phone scale — the ribcage and cranium together are 62%
 * of the skeleton's triangles. Muscles are deliberately absent from this
 * table: they're what the user is here to look at, and they already arrive
 * capped at 4k, so they ship untouched.
 */
export const BONE_SIMPLIFY = [
  [/rib|costal cartilage|sternum|manubrium|xiphoid/, 1200],
  [/skull|cranium|frontal bone|parietal|occipital|temporal|zygomatic|maxilla|mandible|nasal/, 2000],
  [/scapula/, 3000],
  [/vertebra|atlas|axis|sacrum|coccyx/, 900],
  [/phalanx|metacarpal|metatarsal|carpal|cuneiform|cuboid|navicular|scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate/, 250],
  [/hip bone|femur|tibia|fibula|humerus|radius|ulna|clavicle|patella|talus|calcaneus/, 2500],
]

/** Blend half-width around a joint, in metres. ~4cm reads as a natural crease
 * at this scale: tight enough that the belly stays with its own bone, wide
 * enough that the surface doesn't visibly kink at full flexion. */
export const JOINT_BLEND = 0.04

export function expandSide(pattern, side) {
  return pattern.replace(/\bS\b/g, side === 'L' ? 'left' : 'right').replace(/_X\b/g, `_${side}`)
}
