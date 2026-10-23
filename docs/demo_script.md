# HealthTwin Demo Script
## Digital Twin Challenge 2026 — Happiest Health Summit
### ~20 Minutes

---

## SEGMENT 1: Problem Statement (2 min)

**Talking points:**
- Type 2 diabetes affects 537M people globally (IDF 2021).
- Hyperglycaemia (glucose > 180 mg/dL) is the primary driver of complications.
- Most CGM alerts are reactive — they fire after the event.
- **Our question:** Can we predict the next 2-hour hyperglycaemia risk and explain it, in time to act?

**Demo:** Show the Overview tab. Point to the risk gauge, note it's pulling from a live model, not hardcoded.

---

# HealthTwin Website Demo

## 16-minute recording plan

The companion [website captions](demo/demo_captions.srt) contain the timed voiceover text. Follow the actions below while recording the shared site at `http://localhost:5173`; use the visible page navigation, scroll deliberately, and leave each result on screen long enough to read. This is a live browser walkthrough, not a still-image sequence.

| Time | Page and visible actions | Focus |
| --- | --- | --- |
| 00:00–00:50 | Start on Home. Hold the full dashboard, then move the pointer to the patient and time controls. | Introduce the synthetic-data prototype and its non-clinical purpose. |
| 00:50–03:10 | On Home, point to EHR Profile and Live Wearables; trace Data Fusion; scroll to Twin Live and Glucose History + Forecast. | Explain the shared patient window, input streams, current status, forecast horizon, and the 180 mg/dL display threshold. |
| 03:10–04:20 | Move the glucose time cursor a short distance, press Play time cursor, pause it, then open the alerts button. | Show that the selected time window drives the displayed view. Do not present an alert as a clinical rule. |
| 04:20–05:50 | Click Patient Profile. Scroll from the synthetic record through glucose, prediction, and factor sections. | Connect the patient context to the selected window; state that the record is synthetic. |
| 05:50–07:35 | Click Digital Twin. Hold the visualization, then scroll to the current model window, patient context, and factor groups. | Explain that the body graphic is a model-derived indicator view, not anatomy; distinguish attribution from causation. |
| 07:35–09:45 | Click Predictions. Show the probability, factor contribution list, window statistics, “Why now,” and Model card/limitations. | Describe the displayed score as a model output. Note absent confidence intervals and the stored-metrics caveat. |
| 09:45–12:25 | Click What-If Simulator. Show its warning; select “Millet khichdi · 34g” or another meal preset; adjust one input; click Run Custom Scenario. Hold the updated trajectory and outcome comparison. | Compare the current window with a scenario. Read the monotonicity warning and avoid claiming that an intervention causes a benefit. |
| 12:25–14:25 | Click Reports. Show Overview, then Horizons if available; scroll through comparison, provenance, and robustness checks. | Be candid: stored metrics are not independently reproduced here, confidence intervals are unavailable, and robustness checks show failures. |
| 14:25–15:20 | Click Settings. Show glucose units, threshold, horizon, data-source label, theme, and privacy log. Optionally change one preference and restore it. Click Record review only if you want a local event recorded. | Explain these are local demo preferences, not a clinical consent workflow. |
| 15:20–16:00 | Return Home. Hold the dashboard and end on the synthetic-data disclaimer. | Recap the prototype’s purpose and boundaries. |

## Recording and mix notes

- Use a real desktop/browser recorder at 1920 × 1080 and 30 fps. Keep the browser at a readable zoom and move the pointer slowly; avoid fast scrolling and cover each page’s key sections.
- Keep the patient selector on P0001 for consistency. The shared site currently shows `MOCK`; describe the displayed streams and scores as simulated/model outputs, never as live clinical data.
- Allow page transitions and scenario calculations to finish before speaking. The exact values can vary; narrate the labels and meaning rather than promising fixed numbers.
- Use the companion SRT as the caption track for the narrated edit. It is timed to a 16:00 timeline; retime after recording if pauses or page loads differ.
- Add only music you have rights to use. Choose a restrained instrumental bed, keep it well below speech (roughly 20–25 dB lower), and fade in/out over 2–3 seconds. Duck or mute it during narration if it competes with speech.
- Do not add overlay claims such as “clinically validated,” “live patient,” or “guaranteed risk reduction.” Keep the on-screen product unobstructed; captions should sit in a clear lower-third safe area.

## Accuracy checklist

- All displayed records are synthetic, and the app itself says it is not for clinical use.
- Model factor percentages are attribution for the selected window, not causal effects.
- The simulator’s saved monotonicity checks fail, so scenario results can be counterintuitive.
- The Reports page says confidence intervals are unavailable and its stored metric snapshot does not match the currently processed labels; present those values with that caveat.
- The current browser session has been verified on all seven routes. The simulator was repaired and verified with a production build and a live preset interaction before this walkthrough was written.
3. Point to the body SVG (centre): "Organ markers are model-derived — not anatomical. The glow intensity maps to risk."
