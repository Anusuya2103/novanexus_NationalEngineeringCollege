.PHONY: all install data train evaluate explain api frontend clean demo demo-data submission-docs check-submission

# One-command full pipeline (data → train → evaluate → explain)
# Then start API + frontend in separate terminals.
all: install data train evaluate explain
	@echo ""
	@echo "============================================"
	@echo "  Pipeline complete!"
	@echo "  Start services in separate terminals:"
	@echo "    make api       (FastAPI on :8000)"
	@echo "    make frontend  (React on :5173)"
	@echo "============================================"

# ── Python pipeline ────────────────────────────────────────────────────────────
install:
	pip install -r requirements.txt

data:
	python src/data/generate_ehr.py
	python src/data/generate_cgm.py
	python src/data/build_windows.py

train:
	python src/models/train.py

evaluate:
	python src/models/evaluate.py

explain:
	python src/models/explain.py

# ── Services ───────────────────────────────────────────────────────────────────
api:
	uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload

frontend:
	cd frontend && npm install && npm run dev

frontend-build:
	cd frontend && npm install && npm run build

# Small self-contained synthetic P0001 demo bundle; does not regenerate the cohort.
demo-data:
	python scripts/prepare_demo_data.py

submission-docs:
	python scripts/build_submission_docs.py

check-submission:
	python scripts/check_submission.py

demo: demo-data
	docker compose up --build

# ── Cleanup ────────────────────────────────────────────────────────────────────
clean:
	rm -rf data/raw/*.parquet data/raw/*.csv data/processed/ results/metrics.json results/plots/*.png
	find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true

clean-models:
	rm -f results/fusion_model.pt results/ablation_*.pt results/logreg.pkl results/xgboost.pkl results/calibration_temp.json
