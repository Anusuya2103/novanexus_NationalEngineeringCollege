/**
 * BodyTwin.jsx — Realistic anatomical digital twin
 *
 * Medical-illustration style (deliberately NOT cartoonish):
 * - Anatomically proportioned figure (~7.5 heads tall) drawn as one continuous
 *   silhouette: head, neck, torso, legs and feet + separate arms behind torso
 * - Volumetric skin shading: warm translucent flesh gradient, directional
 *   highlight, soft inner edge shadow (no neon outlines)
 * - Muted, anatomically accurate organ colours: cardiac red, liver brown,
 *   lung pink-grey, brain pink-grey, bone ivory — each with glossy highlight
 * - Skeleton: skull, clavicles, sternum, 8 rib pairs, spine, pelvis,
 *   femur / tibia / fibula, patellae
 * - Risk expressed only as a subtle tint / pulse on the relevant organ
 * - System callouts, patient photo slot, glucose badge and disclaimer kept
 *   from the previous version
 *
 * Props (unchanged API):
 *   band           : 'Low' | 'Moderate' | 'High' | 'Very High'
 *   prob           : 0-1  probability
 *   currentGlucose : number mg/dL
 *   metabolicState : string
 *   explainFactors : { hr_and_hrv, recent_glucose_trend, sleep,
 *                      meal_and_carbs, ehr_context, activity } — 0-100 pct
 *   patientName    : string (e.g. "P0001")
 *   patientAge     : number
 *   patientSex     : string
 *   photoUrl       : string | null
 */

import { motion } from 'framer-motion';
import { riskColor } from '../utils/fmt.js';

/* ────────────────────────────────────────────────────────────────────────────
 * Geometry — viewBox 0 0 560 640, figure centred on x=280.
 * Landmarks: crown 88 · chin 151 · shoulders 188 · waist 285 · hip 315 ·
 *            crotch 332 · knee 430 · ankle 526 · sole 560  (7.5 heads tall)
 * ──────────────────────────────────────────────────────────────────────────── */

const BODY_PATH = `
  M280,88
  C296,88 305,99 305,114
  C305,130 300,142 293,149
  C290,152 289,154 289,157
  C290,162 291,165 292,169
  C306,174 322,178 334,188
  C341,194 343,206 340,218
  C337,226 334,232 333,242
  C331,258 327,274 324,288
  C322,296 324,306 330,318
  C332,324 331,328 331,332
  C330,356 328,376 326,396
  C325,410 323,420 323,430
  C323,442 324,454 325,466
  C325,480 321,492 318,502
  C316,512 315,518 314,526
  C314,536 315,546 316,553
  C317,558 312,560 306,560
  C300,560 296,559 294,555
  C295,546 296,537 297,530
  C297,520 297,512 297,502
  C297,490 296,478 296,466
  C296,454 295,442 295,430
  C294,414 294,400 294,386
  C294,372 290,352 281,333
  C274,352 266,372 266,386
  C266,400 266,414 265,430
  C265,442 264,454 264,466
  C264,478 263,490 263,502
  C263,512 263,520 263,530
  C264,537 265,546 264,553
  C263,558 258,560 252,560
  C246,560 242,559 244,555
  C245,547 246,538 246,530
  C245,520 243,512 241,502
  C239,492 235,480 235,466
  C236,454 237,442 237,430
  C237,420 235,410 234,396
  C232,376 230,356 229,332
  C228,326 228,322 230,318
  C236,306 238,296 236,288
  C233,274 229,258 227,242
  C226,232 223,226 220,218
  C217,206 219,194 226,188
  C238,178 254,174 268,169
  C269,165 270,162 271,157
  C271,154 270,152 267,149
  C260,142 255,130 255,114
  C255,99 264,88 280,88 Z`;

/* Arms hang slightly away from the body; drawn BEHIND the torso so the
   shoulder joins seamlessly and a natural gap appears at the waist. */
const ARM_RIGHT_PATH = `
  M324,184
  C340,188 350,200 352,220
  C355,246 356,274 355,300
  C354,318 355,340 356,362
  C357,380 358,392 357,402
  C357,414 356,428 353,438
  C351,445 345,446 342,440
  C339,432 338,418 339,404
  C340,390 339,374 338,356
  C337,336 335,318 334,300
  C333,274 331,246 328,224
  C326,210 323,196 319,186
  C320,184 322,183 324,184 Z`;

const ARM_LEFT_PATH = `
  M236,184
  C220,188 210,200 208,220
  C205,246 204,274 205,300
  C206,318 205,340 204,362
  C203,380 202,392 203,402
  C203,414 204,428 207,438
  C209,445 215,446 218,440
  C221,432 222,418 221,404
  C220,390 221,374 222,356
  C223,336 225,318 226,300
  C227,274 229,246 232,224
  C234,210 237,196 241,186
  C240,184 238,183 236,184 Z`;

/* Rib pairs — sternum edge → lateral sweep, longer down to rib 7. */
const RIBS = Array.from({ length: 8 }, (_, i) => {
  const sy = 196 + i * 8.5;                      // sternal attachment height
  const ex = 264 - i * 2.6;                      // lateral extent (viewer-left)
  const ey = sy + 15 + i * 0.6;                  // costal end height
  return { sy, ex, ey };
});

/* Lumbar + thoracic vertebrae (drawn behind viscera). */
const VERTEBRAE = Array.from({ length: 17 }, (_, i) => 168 + i * 9.5); // y

function systemRisk(pct) {
  if (pct > 25) return { label: 'Elevated Risk',           color: '#EF4444', textColor: '#FCA5A5' };
  if (pct > 15) return { label: 'High Glucose Variability', color: '#F59E0B', textColor: '#FCD34D' };
  return          { label: 'Normal',                        color: '#22D3EE', textColor: '#67E8F9' };
}
/* Callout box — neutral clinical chrome, status colour only on text + dot. */
function Callout({ x, y, side, title, status, color, textColor, lineEndX, lineEndY }) {
  const boxW = 130, boxH = 42, r = 5;
  const bx = side === 'left' ? x - boxW : x;

  return (
    <g>
      <line x1={lineEndX} y1={lineEndY} x2={x} y2={y + boxH / 2}
            stroke={color} strokeWidth="0.8" strokeOpacity="0.55" strokeDasharray="3 2"/>
      <circle cx={lineEndX} cy={lineEndY} r="2.5" fill={color} fillOpacity="0.8"/>

      <rect x={bx} y={y} width={boxW} height={boxH} rx={r}
            fill="rgba(8,14,26,0.88)" stroke="rgba(148,163,184,0.35)" strokeWidth="0.8"/>
      <circle cx={bx + 12} cy={y + 12} r="2.5" fill={color} fillOpacity="0.9"/>

      <text x={bx + 20} y={y + 15} fontSize="9" fontWeight="600"
            fill="rgba(255,255,255,0.9)" fontFamily="Inter,sans-serif">
        {title}
      </text>
      <text x={bx + 20} y={y + 31} fontSize="8.5" fontWeight="500"
            fill={textColor} fontFamily="Inter,sans-serif">
        {status}
      </text>
    </g>
  );
}

export default function BodyTwin({
  band = 'Low',
  prob = 0,
  currentGlucose = null,
  metabolicState = 'Normal',
  explainFactors = {},
  patientName = '',
  patientAge = null,
  patientSex = null,
  photoUrl = null,
}) {
  const c = riskColor(band);
  const glowOpacity = 0.10 + prob * 0.30;

  // Map factor groups → system risks
  const cardioRisk  = systemRisk(explainFactors.hr_and_hrv            ?? 0);
  const metabRisk   = systemRisk(explainFactors.recent_glucose_trend  ?? 0);
  const respRisk    = systemRisk(explainFactors.sleep                 ?? 0);
  const digestRisk  = systemRisk(explainFactors.meal_and_carbs        ?? 0);
  const neuroRisk   = systemRisk(explainFactors.ehr_context           ?? 0);
  const musclRisk   = systemRisk(explainFactors.activity              ?? 0);

  const initials = patientName
    ? patientName.replace(/\D/g, '').slice(0, 2) || patientName.slice(0, 2).toUpperCase()
    : '?';

  return (
    <div className="flex flex-col items-center select-none"
         aria-label={`Digital twin visualization. Risk band: ${band}`}>

      {/* TWIN LIVE tag */}
      <div className="flex items-center gap-2 mb-2">
        <motion.div className="w-2 h-2 rounded-full bg-cyan-400"
          animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }}/>
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-widest">Twin Live</span>
      </div>

      <svg
        viewBox="0 0 560 640"
        className="w-full max-w-lg"
        style={{ maxHeight: '520px' }}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Anatomical digital twin with organ system annotations"
      >
        <defs>
          {/* Warm translucent flesh — light from upper-left */}
          <linearGradient id="btSkin" x1="10%" y1="0%" x2="90%" y2="100%">
            <stop offset="0%"   stopColor="#F5D6C2" stopOpacity="0.36"/>
            <stop offset="45%"  stopColor="#DCA98D" stopOpacity="0.28"/>
            <stop offset="100%" stopColor="#8B5A47" stopOpacity="0.36"/>
          </linearGradient>

          {/* Directional highlight on skin */}
          <radialGradient id="btHi" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#FFF4EA" stopOpacity="0.22"/>
            <stop offset="100%" stopColor="#FFF4EA" stopOpacity="0"/>
          </radialGradient>

          {/* Neutral background vignette (no neon) */}
          <radialGradient id="btBg" cx="50%" cy="45%" r="55%">
            <stop offset="0%"   stopColor="#243347" stopOpacity="0.55"/>
            <stop offset="100%" stopColor="#0A1628" stopOpacity="0"/>
          </radialGradient>

          {/* Risk tint — used sparingly over the torso */}
          <radialGradient id="btRisk" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={c} stopOpacity={glowOpacity * 0.8}/>
            <stop offset="100%" stopColor={c} stopOpacity="0"/>
          </radialGradient>
          {/* Organ gradients — anatomically muted */}
          <linearGradient id="btBrain" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#DCBCB0"/><stop offset="100%" stopColor="#B98D82"/>
          </linearGradient>
          <linearGradient id="btLung" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#E3ADA6"/><stop offset="100%" stopColor="#BC7E7A"/>
          </linearGradient>
          <linearGradient id="btHeart" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#A8343A"/><stop offset="100%" stopColor="#66181E"/>
          </linearGradient>
          <linearGradient id="btLiver" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#96533A"/><stop offset="100%" stopColor="#5E2E1D"/>
          </linearGradient>
          <linearGradient id="btStomach" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#E5B79E"/><stop offset="100%" stopColor="#C4876A"/>
          </linearGradient>
          <linearGradient id="btKidney" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8C423C"/><stop offset="100%" stopColor="#572622"/>
          </linearGradient>
          <linearGradient id="btPancreas" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#E3CE96"/><stop offset="100%" stopColor="#BCA264"/>
          </linearGradient>
          <linearGradient id="btColon" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#DEB695"/><stop offset="100%" stopColor="#BC8F6D"/>
          </linearGradient>
          <linearGradient id="btSmall" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#E7BBA4"/><stop offset="100%" stopColor="#C9917A"/>
          </linearGradient>
          <linearGradient id="btSpleen" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#7E3A44"/><stop offset="100%" stopColor="#54242C"/>
          </linearGradient>
          <linearGradient id="btBone" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#F2ECDC"/><stop offset="100%" stopColor="#CDC3AA"/>
          </linearGradient>

          {/* Soft blur for depth shading */}
          <filter id="btBlur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5"/>
          </filter>
          <filter id="btBlurWide" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="7"/>
          </filter>
          {/* Very subtle halo for the beating heart / pulsing pancreas only */}
          <filter id="btGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>

          {/* Everything inside the body silhouette (for depth shading) */}
          <clipPath id="btClip">
            <path d={BODY_PATH}/>
            <path d={ARM_LEFT_PATH}/>
            <path d={ARM_RIGHT_PATH}/>
          </clipPath>
        </defs>

        {/* ── Background vignette + faint clinical rings (no neon) ── */}
        <ellipse cx="280" cy="330" rx="150" ry="230" fill="url(#btBg)"/>
        <circle cx="280" cy="330" r="195" fill="none" stroke="#94A3B8"
                strokeWidth="0.4" strokeOpacity="0.10" strokeDasharray="8 6"/>
        <circle cx="280" cy="330" r="212" fill="none" stroke="#94A3B8"
                strokeWidth="0.4" strokeOpacity="0.06" strokeDasharray="4 12"/>
        {/* ══ SKIN SURFACE — arms behind torso, then the body ══ */}
        <g>
          <path d={ARM_LEFT_PATH}  fill="url(#btSkin)"/>
          <path d={ARM_RIGHT_PATH} fill="url(#btSkin)"/>
          <path d={BODY_PATH}      fill="url(#btSkin)"/>
        </g>

        {/* ══ DEPTH SHADING (clipped to the figure) ══ */}
        <g clipPath="url(#btClip)">
          {/* Soft inner edge shadow — gives the silhouette volume */}
          <g filter="url(#btBlur)" opacity="0.5">
            <path d={BODY_PATH}      fill="none" stroke="#2E1710" strokeWidth="8"/>
            <path d={ARM_LEFT_PATH}  fill="none" stroke="#2E1710" strokeWidth="8"/>
            <path d={ARM_RIGHT_PATH} fill="none" stroke="#2E1710" strokeWidth="8"/>
          </g>

          {/* Directional highlights (light from upper-left) */}
          <ellipse cx="258" cy="235" rx="48" ry="135" fill="url(#btHi)" filter="url(#btBlurWide)"/>
          <ellipse cx="270" cy="110" rx="16" ry="18"  fill="url(#btHi)" filter="url(#btBlur)"/>
          <ellipse cx="216" cy="300" rx="14" ry="70"  fill="url(#btHi)" filter="url(#btBlurWide)" opacity="0.7"/>
          <ellipse cx="344" cy="300" rx="14" ry="70"  fill="url(#btHi)" filter="url(#btBlurWide)" opacity="0.7"/>

          {/* Under-chest / waist shading */}
          <ellipse cx="280" cy="270" rx="52" ry="16" fill="#33190F"
                   opacity="0.20" filter="url(#btBlurWide)"/>
          <ellipse cx="280" cy="336" rx="46" ry="14" fill="#33190F"
                   opacity="0.16" filter="url(#btBlurWide)"/>
        </g>

        {/* Silhouette contour — warm, soft, never neon */}
        <path d={BODY_PATH}     fill="none" stroke="rgba(255,226,205,0.32)" strokeWidth="1.1"/>
        <path d={ARM_LEFT_PATH} fill="none" stroke="rgba(255,226,205,0.26)" strokeWidth="1"/>
        <path d={ARM_RIGHT_PATH} fill="none" stroke="rgba(255,226,205,0.26)" strokeWidth="1"/>

        {/* ══ SKELETON ══ */}
        <g fill="none" strokeLinecap="round">
          {/* Skull hint inside the head */}
          <ellipse cx="280" cy="114" rx="24" ry="20" stroke="url(#btBone)"
                   strokeWidth="1.6" opacity="0.30"/>
          <path d="M266,138 Q280,148 294,138" stroke="url(#btBone)"
                strokeWidth="1.4" opacity="0.25"/>

          {/* Cervical + thoracic + lumbar vertebrae (behind viscera) */}
          <g opacity="0.34">
            {VERTEBRAE.map((y, i) => (
              <rect key={y} x={i < 2 ? 275.5 : 274.5} y={y}
                    width={i < 2 ? 9 : 11} height="6.5" rx="2"
                    fill="url(#btBone)" stroke="#A79A7E" strokeWidth="0.4"/>
            ))}
          </g>

          {/* Clavicles */}
          <path d="M278,177 Q300,178 320,187" stroke="url(#btBone)"
                strokeWidth="2.4" opacity="0.55"/>
          <path d="M282,177 Q260,178 240,187" stroke="url(#btBone)"
                strokeWidth="2.4" opacity="0.55"/>

          {/* Sternum: manubrium + body + xiphoid */}
          <path d="M276,182 Q280,178 284,182 L284,258 Q280,264 276,258 Z"
                fill="url(#btBone)" stroke="#A79A7E" strokeWidth="0.5" opacity="0.5"/>

          {/* Ribcage — 8 pairs, anatomically curved (drawn over the lungs) */}
          <g stroke="url(#btBone)" strokeWidth="1.5" opacity="0.42">
            {RIBS.map((r, i) => (
              <g key={i}>
                <path d={`M277,${r.sy} C268,${r.sy} ${r.ex + 6},${r.ey - 9} ${r.ex},${r.ey}`}/>
                <path d={`M283,${r.sy} C292,${r.sy} ${560 - r.ex - 6},${r.ey - 9} ${560 - r.ex},${r.ey}`}/>
              </g>
            ))}
          </g>
          {/* Costal margin arch (ribcage bottom) */}
          <path d="M248,264 Q264,276 280,272 Q296,276 312,264"
                stroke="url(#btBone)" strokeWidth="1.8" opacity="0.40"/>

          {/* Pelvis: iliac wings + sacrum + pubic arch */}
          <g stroke="url(#btBone)" strokeWidth="1.7" opacity="0.42">
            <path d="M276,296 Q252,300 241,312 Q236,324 244,334 Q258,340 272,336"/>
            <path d="M284,296 Q308,300 319,312 Q324,324 316,334 Q302,340 288,336"/>
            <path d="M276,304 Q280,326 280,338 Q280,326 284,304"/>
            <path d="M264,340 Q272,350 280,351 Q288,350 296,340"/>
          </g>

          {/* Femoral heads + leg bones */}
          <g stroke="url(#btBone)" fill="none">
            <circle cx="250" cy="334" r="7" strokeWidth="1.6" opacity="0.45"/>
            <circle cx="310" cy="334" r="7" strokeWidth="1.6" opacity="0.45"/>
            <path d="M250,341 Q249,386 251,424" strokeWidth="4" opacity="0.30"/>
            <path d="M310,341 Q311,386 309,424" strokeWidth="4" opacity="0.30"/>
            <path d="M251,438 Q253,482 255,520" strokeWidth="3.4" opacity="0.28"/>
            <path d="M309,438 Q307,482 305,520" strokeWidth="3.4" opacity="0.28"/>
            <path d="M244,440 Q242,486 247,518" strokeWidth="1.4" opacity="0.22"/>
            <path d="M316,440 Q318,486 313,518" strokeWidth="1.4" opacity="0.22"/>
            {/* Humerus hint in each arm */}
            <path d="M334,200 Q344,252 346,296 Q348,340 349,394" strokeWidth="3.4" opacity="0.22"/>
            <path d="M226,200 Q216,252 214,296 Q212,340 211,394" strokeWidth="3.4" opacity="0.22"/>
          </g>

          {/* Patellae (kneecaps) */}
          <ellipse cx="251" cy="430" rx="6.5" ry="7.5" fill="url(#btBone)"
                   stroke="#A79A7E" strokeWidth="0.5" opacity="0.5"/>
          <ellipse cx="309" cy="430" rx="6.5" ry="7.5" fill="url(#btBone)"
                   stroke="#A79A7E" strokeWidth="0.5" opacity="0.5"/>
        </g>
        {/* ══ ORGANS — anatomically muted colours, glossy highlights ══ */}

        {/* Brain (pink-grey with gyri) */}
        <g>
          <ellipse cx="280" cy="112" rx="20" ry="15" fill="url(#btBrain)"
                   stroke="#96695F" strokeWidth="0.9"/>
          <path d="M280,98 L280,126" stroke="#96695F" strokeWidth="0.9" opacity="0.8"/>
          <g stroke="#A5776B" strokeWidth="0.7" fill="none" opacity="0.75">
            <path d="M266,106 Q271,102 276,105 Q272,110 267,111"/>
            <path d="M284,104 Q289,101 294,105 Q289,109 285,110"/>
            <path d="M265,116 Q271,113 277,116 Q272,120 267,121"/>
            <path d="M283,115 Q289,112 295,116 Q290,120 285,121"/>
          </g>
          <ellipse cx="273" cy="105" rx="5" ry="3" fill="#FFF6EE" opacity="0.20"/>
          {/* Brainstem */}
          <path d="M280,126 Q281,132 280,137" stroke="#B98D82" strokeWidth="3.5"
                strokeLinecap="round" opacity="0.8"/>
        </g>

        {/* Lungs — pink-grey, gentle breathing */}
        <motion.g animate={{ opacity: [0.93, 1, 0.93] }}
                  transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}>
          {/* Patient's right lung = viewer's left */}
          <path d="M262,185 C251,189 246,203 245,222 C244,241 247,253 253,259
                   C261,265 271,261 274,249 C277,233 277,207 273,194
                   C270,187 266,184 262,185 Z"
                fill="url(#btLung)" stroke="#A96A66" strokeWidth="0.9"/>
          {/* Patient's left lung = viewer's right */}
          <path d="M298,185 C309,189 314,203 315,222 C316,241 313,253 307,259
                   C299,265 289,261 286,249 C283,233 283,207 287,194
                   C290,187 294,184 298,185 Z"
                fill="url(#btLung)" stroke="#A96A66" strokeWidth="0.9"/>
          {/* Bronchial tree */}
          <g stroke="#C68B85" strokeWidth="1" fill="none" opacity="0.7">
            <path d="M280,186 L280,206"/>
            <path d="M280,206 Q271,212 266,224 M280,206 Q289,212 294,224"/>
            <path d="M266,224 Q262,234 261,244 M294,224 Q298,234 299,244"/>
          </g>
          <ellipse cx="256" cy="198" rx="5" ry="7" fill="#FFF6EE" opacity="0.16"/>
          <ellipse cx="304" cy="198" rx="5" ry="7" fill="#FFF6EE" opacity="0.16"/>
        </motion.g>
        {/* Heart — deep cardiac red, beating; risk colour only as thin stroke */}
        <g filter="url(#btGlow)">
          <motion.path
            d="M277,204 C273,200 274,193 279,192 C283,191 286,193 288,196
               C291,192 296,191 300,194 C304,197 304,203 301,207
               C303,218 299,230 291,238 C285,243 279,240 276,232
               C272,222 272,211 277,204 Z"
            fill="url(#btHeart)" stroke={cardioRisk.color} strokeWidth="1"
            strokeOpacity="0.55"
            animate={{ scale: [1, 1.035, 1] }}
            transition={{ duration: 0.85, repeat: Infinity, ease: 'easeInOut' }}
            style={{ transformOrigin: '288px 217px' }}/>
          {/* Coronary vessels */}
          <path d="M284,201 Q287,215 288,234" stroke="#D4727A" strokeWidth="0.9"
                fill="none" opacity="0.65"/>
          <path d="M279,208 Q288,205 297,208" stroke="#D4727A" strokeWidth="0.8"
                fill="none" opacity="0.55"/>
          {/* Aortic arch */}
          <path d="M288,193 Q291,182 285,177" stroke="#9B4A4E" strokeWidth="4.5"
                fill="none" strokeLinecap="round" opacity="0.75"/>
          <ellipse cx="281" cy="197" rx="4" ry="3" fill="#FFE9E4" opacity="0.22"/>
        </g>

        {/* Diaphragm dome */}
        <path d="M241,258 Q280,244 319,258" stroke="#C89B8E" strokeWidth="2"
              fill="none" opacity="0.45"/>

        {/* Kidneys (retroperitoneal — behind liver / stomach) */}
        <g stroke="#4C211E" strokeWidth="0.8">
          <path d="M252,274 Q244,276 243,288 Q243,300 250,304 Q257,306 259,298
                   Q261,288 258,280 Q256,274 252,274 Z" fill="url(#btKidney)"/>
          <path d="M308,274 Q316,276 317,288 Q317,300 310,304 Q303,306 301,298
                   Q299,288 302,280 Q304,274 308,274 Z" fill="url(#btKidney)"/>
        </g>

        {/* Spleen (behind stomach) */}
        <path d="M314,261 Q322,259 324,268 Q325,277 318,281 Q313,282 311,275
                 Q310,265 314,261 Z"
              fill="url(#btSpleen)" stroke="#43202A" strokeWidth="0.8"/>
        {/* Liver — reddish-brown, right upper quadrant (viewer-left) */}
        <g>
          <path d="M243,262 Q252,254 268,254 Q286,255 297,262 Q301,270 296,278
                   Q292,290 280,294 Q264,298 252,292 Q244,284 243,272 Z"
                fill="url(#btLiver)" stroke="#4E2517" strokeWidth="0.9"/>
          {/* Lobe division + gloss */}
          <path d="M283,257 Q281,272 278,292" stroke="#4E2517" strokeWidth="0.8"
                fill="none" opacity="0.6"/>
          <ellipse cx="258" cy="263" rx="9" ry="4" fill="#FFF3E8" opacity="0.18"/>
        </g>

        {/* Pancreas — pale tan; pulses with metabolic risk (callout target) */}
        <motion.path
          d="M264,302 Q258,298 260,292 Q264,287 272,290 Q280,293 290,294
             Q302,293 312,290 Q316,291 315,296 Q312,301 304,302
             Q292,305 280,305 Q270,306 264,302 Z"
          fill="url(#btPancreas)" stroke={metabRisk.color} strokeWidth="1.1"
          strokeOpacity="0.5"
          animate={{ strokeOpacity: [0.28, 0.65, 0.28] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          filter="url(#btGlow)"/>

        {/* Stomach — pale pink-tan, viewer-right (patient's left) */}
        <g>
          <path d="M296,260 Q304,254 312,258 Q320,263 320,274 Q320,288 312,296
                   Q304,303 296,300 Q290,296 291,290 Q293,284 298,280
                   Q303,274 302,268 Q300,262 296,260 Z"
                fill="url(#btStomach)" stroke="#B0765B" strokeWidth="0.9"/>
          <path d="M306,262 Q300,274 304,288" stroke="#B0765B" strokeWidth="0.7"
                fill="none" opacity="0.5"/>
          <ellipse cx="310" cy="265" rx="6" ry="3.5" fill="#FFF6EE" opacity="0.20"/>
        </g>

        {/* ══ INTESTINES ══ */}
        {/* Small intestine — coiled mass (capped at the pelvic floor) */}
        <g>
          <path d="M262,312 Q256,320 259,328 Q263,334 274,335 Q286,336 295,331
                   Q302,326 302,317 Q300,310 292,307 Q278,302 268,305
                   Q263,307 262,312 Z"
                fill="url(#btSmall)" stroke="#B87F68" strokeWidth="0.8"/>
          <g stroke="#B87F68" strokeWidth="1.1" fill="none" opacity="0.55">
            <path d="M266,316 Q274,312 282,316 Q288,320 284,326 Q279,331 271,328 Q265,325 266,316"/>
            <path d="M273,330 Q280,327 287,330 Q293,333 290,335"/>
            <path d="M286,310 Q294,314 298,322 Q300,328 296,331"/>
          </g>
          <ellipse cx="272" cy="311" rx="6" ry="3" fill="#FFF6EE" opacity="0.16"/>
        </g>

        {/* Large intestine — frame around the small bowel (thick tube) */}
        <g stroke="url(#btColon)" strokeWidth="9.5" fill="none"
           strokeLinecap="round" strokeLinejoin="round">
          {/* Ascending colon (patient's right = viewer's left) */}
          <path d="M256,330 L254,314"/>
          {/* Hepatic flexure → transverse → splenic flexure */}
          <path d="M254,314 Q256,306 268,304 Q284,302 298,305 Q306,307 307,314"/>
          {/* Descending colon (patient's left = viewer's right) */}
          <path d="M307,314 L305,330"/>
          {/* Sigmoid → rectum */}
          <path d="M305,330 Q300,341 291,340 Q285,339 281,333"/>
        </g>
        {/* Haustra segmentation */}
        <g stroke="#A8795A" strokeWidth="0.8" fill="none" opacity="0.45">
          <path d="M251,318 L258,318 M251,323 L258,323 M252,328 L259,328"/>
          <path d="M303,318 L310,318 M303,323 L310,323 M302,328 L309,328"/>
          <path d="M267,301 L265,307 M277,300 L276,306 M287,300 L287,306 M296,302 L297,308"/>
        </g>
        {/* Gloss */}
        <ellipse cx="256" cy="319" rx="2" ry="5" fill="#FFF6EE" opacity="0.20"/>
        {/* ══ SURFACE ANATOMY over the viscera (skin-level detail) ══ */}
        <g>
          {/* Neck shadow under the jaw */}
          <ellipse cx="280" cy="160" rx="13" ry="6" fill="#33190F"
                   opacity="0.22" filter="url(#btBlur)"/>
          {/* Pectorals */}
          <path d="M277,201 Q262,204 250,214 Q247,226 252,234 Q264,238 277,233"
                fill="rgba(158,86,70,0.10)" stroke="rgba(94,48,37,0.30)" strokeWidth="1"/>
          <path d="M283,201 Q298,204 310,214 Q313,226 308,234 Q296,238 283,233"
                fill="rgba(158,86,70,0.10)" stroke="rgba(94,48,37,0.30)" strokeWidth="1"/>
          {/* Deltoid caps */}
          <path d="M232,196 Q244,206 248,224" fill="none"
                stroke="rgba(94,48,37,0.22)" strokeWidth="1"/>
          <path d="M328,196 Q316,206 312,224" fill="none"
                stroke="rgba(94,48,37,0.22)" strokeWidth="1"/>
          {/* Linea alba + tendinous inscriptions (rectus abdominis) */}
          <path d="M280,240 L280,318" fill="none"
                stroke="rgba(94,48,37,0.22)" strokeWidth="1"/>
          <g fill="none" stroke="rgba(94,48,37,0.16)" strokeWidth="1">
            <path d="M264,256 Q280,259 296,256"/>
            <path d="M263,274 Q280,277 297,274"/>
            <path d="M263,292 Q280,295 297,292"/>
            <path d="M264,310 Q280,313 296,310"/>
          </g>
          {/* Linea semilunaris */}
          <path d="M263,242 Q259,272 261,312" fill="none"
                stroke="rgba(94,48,37,0.15)" strokeWidth="1"/>
          <path d="M297,242 Q301,272 299,312" fill="none"
                stroke="rgba(94,48,37,0.15)" strokeWidth="1"/>
          {/* Umbilicus */}
          <ellipse cx="280" cy="300" rx="2.2" ry="2.8"
                   fill="rgba(58,26,18,0.55)"/>
        </g>

        {/* Risk tint — a soft haze only when probability is elevated */}
        {prob > 0.35 && (
          <ellipse cx="280" cy="250" rx="70" ry="115" fill="url(#btRisk)"/>
        )}

        {/* ══ 6 SYSTEM CALLOUT BOXES ══ */}
        <Callout
          title="Neurological"
          status={neuroRisk.label}
          color={neuroRisk.color}
          textColor={neuroRisk.textColor}
          side="left" x={178} y={96}
          lineEndX={260} lineEndY={116}
        />
        <Callout
          title="Cardiovascular System"
          status={cardioRisk.label}
          color={cardioRisk.color}
          textColor={cardioRisk.textColor}
          side="left" x={178} y={190}
          lineEndX={276} lineEndY={222}
        />
        <Callout
          title="Metabolic System"
          status={metabRisk.label}
          color={metabRisk.color}
          textColor={metabRisk.textColor}
          side="left" x={178} y={282}
          lineEndX={270} lineEndY={297}
        />
        <Callout
          title="Respiratory System"
          status={respRisk.label}
          color={respRisk.color}
          textColor={respRisk.textColor}
          side="right" x={382} y={190}
          lineEndX={310} lineEndY={216}
        />
        <Callout
          title="Digestive System"
          status={digestRisk.label}
          color={digestRisk.color}
          textColor={digestRisk.textColor}
          side="right" x={382} y={282}
          lineEndX={312} lineEndY={286}
        />
        <Callout
          title="Musculoskeletal"
          status={musclRisk.label}
          color={musclRisk.color}
          textColor={musclRisk.textColor}
          side="right" x={382} y={430}
          lineEndX={314} lineEndY={432}
        />
        {/* ── Patient photo slot — top center ── */}
        <g>
          <circle cx="280" cy="40" r="28" fill="#0B1628"
                  stroke="rgba(148,163,184,0.55)" strokeWidth="1.2"/>
          <circle cx="280" cy="40" r="31" fill="none"
                  stroke="rgba(148,163,184,0.18)" strokeWidth="0.6"/>

          {photoUrl ? (
            <>
              <defs>
                <clipPath id="btPhotoClip">
                  <circle cx="280" cy="40" r="26"/>
                </clipPath>
              </defs>
              <image href={photoUrl} x="254" y="14" width="52" height="52"
                     clipPath="url(#btPhotoClip)" preserveAspectRatio="xMidYMid slice"/>
            </>
          ) : (
            <>
              {/* Neutral initials fallback */}
              <circle cx="280" cy="33" r="10" fill="#334155" fillOpacity="0.7"/>
              <path d="M260,58 Q260,46 280,46 Q300,46 300,58"
                    fill="#334155" fillOpacity="0.5"/>
              <text x="280" y="38" textAnchor="middle" fontSize="10" fontWeight="700"
                    fill="#CBD5E1" fontFamily="Inter,sans-serif" letterSpacing="1">
                {initials}
              </text>
            </>
          )}

          <text x="280" y="76" textAnchor="middle" fontSize="8.5" fontWeight="600"
                fill="rgba(255,255,255,0.85)" fontFamily="Inter,sans-serif">
            {patientName}
          </text>
          {patientAge && (
            <text x="280" y="87" textAnchor="middle" fontSize="7.5"
                  fill="rgba(148,163,184,0.8)" fontFamily="Inter,sans-serif">
              {patientAge}yr · {patientSex}
            </text>
          )}
        </g>

        {/* ── Current glucose badge (pelvis overlay) ── */}
        {currentGlucose != null && (
          <g>
            <rect x="234" y="352" width="92" height="20" rx="4"
                  fill="rgba(8,14,26,0.9)" stroke={metabRisk.color}
                  strokeWidth="0.8" strokeOpacity="0.7"/>
            <text x="280" y="366" textAnchor="middle" fontSize="8.5" fontWeight="700"
                  fill={metabRisk.color} fontFamily="Inter,sans-serif">
              {Math.round(currentGlucose)} mg/dL · {metabolicState}
            </text>
          </g>
        )}

        {/* ── Disclaimer ── */}
        <text x="280" y="630" textAnchor="middle" fontSize="7"
              fill="rgba(71,85,105,0.8)" fontFamily="Inter,sans-serif">
          model-derived indicators · not anatomical
        </text>
      </svg>
    </div>
  );
}








