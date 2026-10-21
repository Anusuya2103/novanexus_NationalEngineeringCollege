/**
 * AnatomicalTwin.jsx — Dashboard adapter for the realistic BodyTwin figure.
 *
 * The Dashboard previously had its own cartoonish (neon-blue) twin drawing.
 * It now delegates to BodyTwin.jsx — the single, realistic anatomical
 * implementation — mapping this page's prop names onto BodyTwin's API:
 *
 *   factors          → explainFactors
 *   patientPhotoUrl  → photoUrl
 *   patientInitials  → fallback patientName
 */
import BodyTwin from './BodyTwin.jsx'

export default function AnatomicalTwin({
  band = 'Low',
  prob = 0,
  currentGlucose = null,
  metabolicState = 'Normal',
  factors = {},
  patientPhotoUrl = null,
  patientInitials = 'P',
  patientName = '',
  patientAge = null,
  patientSex = null,
}) {
  return (
    <BodyTwin
      band={band}
      prob={prob}
      currentGlucose={currentGlucose}
      metabolicState={metabolicState}
      explainFactors={factors}
      patientName={patientName || patientInitials}
      patientAge={patientAge}
      patientSex={patientSex}
      photoUrl={patientPhotoUrl}
    />
  )
}
