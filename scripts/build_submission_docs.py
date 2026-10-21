"""Render the HealthTwin architecture and a metrics-aware 15-slide PDF."""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
RESULTS = ROOT / "results"
METRICS = json.loads((RESULTS / "metrics.json").read_text(encoding="utf-8"))
PAGE_W, PAGE_H = 960, 540


def render_architecture() -> Path:
    figure, axis = plt.subplots(figsize=(14, 4.5))
    figure.patch.set_facecolor("#f5f8f7")
    axis.set_facecolor("#f5f8f7")
    axis.set_xlim(0, 14)
    axis.set_ylim(0, 4.5)
    axis.axis("off")
    boxes = [
        (0.25, "Data sources", "Synthetic EHR\nCGM + wearables", "#d9eee9"),
        (2.55, "Fusion", "BiGRU + EHR MLP\n7 time-series channels", "#cfe4f3"),
        (4.85, "Twin state", "Glucose / insulin ODE\nNo EKF estimator", "#f7e4c7"),
        (7.15, "Predictor", "2-hour >180 mg/dL\nprobability + forecast", "#eadcf1"),
        (9.45, "Simulator", "Input-window what-if\nNot causal", "#f5d9d4"),
        (11.75, "Dashboard", "React UI\nVite :5173", "#dce7ca"),
    ]
    for x, title, detail, color in boxes:
        patch = FancyBboxPatch(
            (x, 1.75), 1.95, 1.25,
            boxstyle="round,pad=0.08,rounding_size=0.08",
            linewidth=1.3, edgecolor="#34434a", facecolor=color,
        )
        axis.add_patch(patch)
        axis.text(x + 0.975, 2.62, title, ha="center", va="center", fontsize=11, weight="bold", color="#1f3036")
        axis.text(x + 0.975, 2.16, detail, ha="center", va="center", fontsize=8.2, color="#34434a")
    for index in range(len(boxes) - 1):
        x_start = boxes[index][0] + 2.01
        x_end = boxes[index + 1][0] - 0.08
        axis.add_patch(FancyArrowPatch((x_start, 2.37), (x_end, 2.37), arrowstyle="-|>", mutation_scale=13, color="#34434a", linewidth=1.4))
    axis.text(7, 4.0, "HealthTwin | Synthetic-data T2D glucose-spike prototype", ha="center", fontsize=16, weight="bold", color="#19343b")
    axis.text(7, 0.8, "FastAPI :8000  |  24-step history  |  180 mg/dL threshold  |  synthetic data only", ha="center", fontsize=9, color="#46565c")
    DOCS.mkdir(parents=True, exist_ok=True)
    png_path = DOCS / "architecture.png"
    pdf_path = DOCS / "architecture.pdf"
    figure.savefig(png_path, dpi=180, bbox_inches="tight", facecolor=figure.get_facecolor())
    figure.savefig(pdf_path, bbox_inches="tight", facecolor=figure.get_facecolor())
    plt.close(figure)
    return png_path


def draw_slide(slide: canvas.Canvas, page: int, title: str, bullets: list[str], image: Path | None = None, metric_models: list[str] | None = None) -> None:
    slide.setFillColor(colors.HexColor("#f4f7f5"))
    slide.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    slide.setFillColor(colors.HexColor("#164e56"))
    slide.rect(0, PAGE_H - 68, PAGE_W, 68, stroke=0, fill=1)
    slide.setFillColor(colors.white)
    slide.setFont("Helvetica-Bold", 24)
    slide.drawString(44, PAGE_H - 46, title)
    slide.setFillColor(colors.HexColor("#24414a"))

    if image:
        slide.drawImage(ImageReader(str(image)), 55, 105, width=850, height=278, preserveAspectRatio=True, anchor="c", mask="auto")
    elif metric_models:
        y = PAGE_H - 118
        for model_name in metric_models:
            values = METRICS["models"][model_name]
            label = values.get("label", model_name)
            slide.setFont("Helvetica-Bold", 13)
            slide.drawString(65, y, label)
            slide.setFont("Helvetica", 12)
            slide.drawString(330, y, f"AUROC {values['auroc']:.4f}   AUPRC {values['auprc']:.4f}   F1 {values['f1']:.4f}   ECE {values['ece']:.4f}")
            slide.setFillColor(colors.HexColor("#b7d8ce"))
            slide.rect(65, y - 18, 610 * values["auroc"], 9, stroke=0, fill=1)
            slide.setFillColor(colors.HexColor("#24414a"))
            y -= 70
        slide.setFont("Helvetica", 11)
        slide.drawString(65, 88, "Values are read from results/metrics.json; they are not reproduced by current all-negative labels.")
    else:
        y = PAGE_H - 126
        for bullet in bullets:
            slide.setFillColor(colors.HexColor("#164e56"))
            slide.circle(58, y + 5, 4, stroke=0, fill=1)
            slide.setFillColor(colors.HexColor("#24414a"))
            slide.setFont("Helvetica", 18)
            lines = wrap_text(bullet, 89)
            for line in lines:
                slide.drawString(76, y, line)
                y -= 28
            y -= 18

    slide.setFillColor(colors.HexColor("#61747a"))
    slide.setFont("Helvetica", 10)
    slide.drawString(44, 28, "HealthTwin | Synthetic data only | Not for clinical use")
    slide.drawRightString(PAGE_W - 44, 28, f"{page:02d} / 15")
    slide.showPage()


def wrap_text(text: str, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) > width and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def render_presentation(architecture_image: Path) -> None:
    output_path = DOCS / "presentation.pdf"
    deck = canvas.Canvas(str(output_path), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    slides = [
        ("HealthTwin", ["A synthetic-data digital twin prototype for T2D glucose-spike risk.", "Happiest Health Digital Twin Challenge submission", "Team and member details are pending confirmation."]),
        ("The problem", ["A reactive alert arrives after glucose has crossed its threshold.", "Prototype question: can a two-hour spike risk be estimated and explained?", "Target event: glucose >180 mg/dL within two hours."]),
        ("Healthcare use case | India", ["Clinician-supervised review: patient history → risk estimate → factor review → what-if exploration.", "Indian meal examples and Asian-Indian BMI cutoffs are intended context features.", "No clinician workflow integration or clinical evaluation has been performed."]),
        ("Data and cohort", ["Procedurally generated synthetic EHR and 5-minute CGM/wearable traces.", "Generators describe a 500-patient cohort; the checked-in demo bundle uses P0001 only.", "Wearable relationships and physiology are simplified assumptions, not validated data."]),
        ("System architecture", [], architecture_image),
        ("Physiological twin", ["Bergman-inspired glucose, insulin, remote-action, and gut compartments.", "Inputs include carbohydrates, activity, sleep, stress, and medication adherence.", "The current code does not include the EKF/Bayesian estimator mentioned in planning notes."]),
        ("Predictor and features", ["24 history steps × 7 channels plus 12 static EHR features.", "Bidirectional GRU and EHR MLP feed a fusion head for classification and four forecast horizons.", "XGBoost and logistic regression are tabular baselines."]),
        ("Stored results snapshot", [], None),
        ("Metrics validity and uncertainty", ["The metrics artifact reports 239,316 train windows and 58.31% positives.", "Current label arrays have 997,150 / 213,675 / 213,675 entries and contain only zeros.", "Metrics are not reproducible from current arrays; no confidence intervals are stored."]),
        ("Simulator demonstration", ["Select the synthetic patient P0001.", "Inspect history and factors, then submit a carbohydrate/activity/medication what-if.", "Displayed changes are model simulations, not causal effects or treatment advice."]),
        ("Robustness status", ["Activity and carbohydrate monotonicity checks are documented as failing.", "No 5-seed confidence intervals, distribution-shift suite, or external validation result is present.", "Release gate: rebuild data, models, and metrics together, then rerun the checks."]),
        ("Explainability and guardrails", ["Factor groups are normalized for display; importance is not causal attribution.", "Risk bands are model-defined, not medical standards.", "The UI and API carry synthetic-data and non-clinical disclaimers."]),
        ("Limitations", ["Synthetic-only cohort and rule-based wearables.", "Stored metric/data mismatch; forecast performance and clinical utility are unverified.", "No real-world safety, privacy certification, or prospective validation."]),
        ("Potential impact", ["A future validated tool could help teams review risk trajectories and intervention hypotheses.", "This prototype supports technical exploration only.", "Any clinical study requires governance, consent, and prospective evaluation."]),
        ("Roadmap and release gates", ["Regenerate the synthetic cohort and check label, split, and timestamp integrity.", "Retrain all models; reproduce metrics with patient-level confidence intervals and stress tests.", "Review the demo with clinicians, finalize public artifacts and team details, then publish."]),
    ]
    for page, entry in enumerate(slides, start=1):
        title, bullets = entry[0], entry[1]
        if page == 5:
            draw_slide(deck, page, title, bullets, image=architecture_image)
        elif page == 8:
            draw_slide(deck, page, title, bullets, metric_models=[
                "ablation_glucose_only", "ablation_wearables_no_ehr", "fusion_full", "xgboost", "logreg"
            ])
        else:
            draw_slide(deck, page, title, bullets)
    deck.save()


def main() -> None:
    diagram = render_architecture()
    render_presentation(diagram)
    print("Generated docs/architecture.png, docs/architecture.pdf, and docs/presentation.pdf (15 slides).")


if __name__ == "__main__":
    main()