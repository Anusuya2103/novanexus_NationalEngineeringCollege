"""
fusion_model.py
---------------
GRU + MLP fusion architecture for HealthTwin.

Architecture:
  Static EHR vector (12 features)
          |
      MLP Encoder (64-d)  [2 layers, BN, Dropout]
          |
          +──────────────────────────────────────+
                                                 |
  Time-series window [24 steps x 7 features]    |
          |                                      |
      GRU Encoder (128-d)  [2 layers, Dropout]  |
          |                                      |
          +────── Concat (192-d) ────────────────+
                        |
                  Fusion MLP (192 -> 128 -> 64)
                        |
          +─────────────+──────────────+
          |                            |
    Sigmoid head               Forecast head
  (hyperglycaemia prob)    (glucose @+30/60/90/120 min, MSE)

MC Dropout: dropout is kept ACTIVE at inference for uncertainty estimation.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class StaticEncoder(nn.Module):
    """MLP encoder for the static EHR feature vector."""

    def __init__(self, input_dim: int = 12, hidden_dim: int = 64,
                 dropout: float = 0.3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 64),
            nn.LayerNorm(64),       # LayerNorm works for any batch size, incl. 1
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(64, hidden_dim),
            nn.ReLU(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class GRUEncoder(nn.Module):
    """Bidirectional GRU encoder for the multivariate time-series window."""

    def __init__(self, input_dim: int = 7, hidden_dim: int = 64,
                 num_layers: int = 2, dropout: float = 0.3):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers
        self.gru = nn.GRU(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
            bidirectional=True,
        )
        self.proj = nn.Linear(hidden_dim * 2, hidden_dim)   # bidir -> hidden_dim

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, T, C)
        out, _ = self.gru(x)           # (B, T, 2*hidden)
        # Use the last time step
        last = out[:, -1, :]           # (B, 2*hidden)
        return F.relu(self.proj(last)) # (B, hidden_dim)


class FusionModel(nn.Module):
    """
    Full fusion model: Static MLP + GRU -> Fusion MLP -> dual heads.

    Outputs:
        prob      : (B,)    sigmoid probability of hyperglycaemia in next 2h
        forecast  : (B, 4)  glucose (mg/dL) at +30/60/90/120 min
    """

    def __init__(
        self,
        ehr_input_dim: int = 12,
        ts_input_dim: int = 7,
        static_hidden: int = 64,
        gru_hidden: int = 64,
        fusion_hidden: int = 128,
        n_forecast: int = 4,
        dropout: float = 0.3,
    ):
        super().__init__()
        self.static_encoder = StaticEncoder(ehr_input_dim, static_hidden, dropout)
        self.gru_encoder = GRUEncoder(ts_input_dim, gru_hidden, num_layers=2, dropout=dropout)

        concat_dim = static_hidden + gru_hidden  # 64 + 64 = 128

        self.fusion = nn.Sequential(
            nn.Linear(concat_dim, fusion_hidden),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(fusion_hidden, 64),
            nn.ReLU(),
            nn.Dropout(dropout),
        )

        # Classification head
        self.cls_head = nn.Linear(64, 1)

        # Forecast head (auxiliary)
        self.forecast_head = nn.Linear(64, n_forecast)

    def forward(
        self,
        x_ts: torch.Tensor,   # (B, T, C)
        x_ehr: torch.Tensor,  # (B, F)
    ) -> tuple:
        static_feat = self.static_encoder(x_ehr)    # (B, 64)
        ts_feat = self.gru_encoder(x_ts)             # (B, 64)
        fused = torch.cat([static_feat, ts_feat], dim=1)  # (B, 128)
        h = self.fusion(fused)                       # (B, 64)

        prob = torch.sigmoid(self.cls_head(h)).squeeze(-1)   # (B,)
        forecast = self.forecast_head(h)                      # (B, 4)
        return prob, forecast

    def predict_with_uncertainty(
        self,
        x_ts: torch.Tensor,
        x_ehr: torch.Tensor,
        n_samples: int = 30,
    ) -> dict:
        """
        MC Dropout uncertainty estimation.
        Uses eval() mode but re-enables dropout layers only.

        Returns dict with:
            prob_mean    : float
            prob_lower   : float  (5th percentile)
            prob_upper   : float  (95th percentile)
            forecast_mean: list
        """
        import numpy as np

        # Enable dropout in eval mode by temporarily patching
        def enable_dropout(m):
            if type(m) == nn.Dropout:
                m.train()

        self.eval()
        self.apply(enable_dropout)   # only Dropout layers go to train

        probs = []
        forecasts = []

        with torch.no_grad():
            for _ in range(n_samples):
                p, f = self.forward(x_ts, x_ehr)
                probs.append(p.cpu().numpy())
                forecasts.append(f.cpu().numpy())

        self.eval()  # back to full eval

        probs_arr = np.array(probs)
        forecasts_arr = np.array(forecasts)

        return {
            "prob_mean":     float(probs_arr.mean(axis=0).squeeze()),
            "prob_lower":    float(np.percentile(probs_arr, 5, axis=0).squeeze()),
            "prob_upper":    float(np.percentile(probs_arr, 95, axis=0).squeeze()),
            "forecast_mean": forecasts_arr.mean(axis=0).squeeze().tolist(),
        }


# ── Ablation variants ──────────────────────────────────────────────────────────

class GlucoseOnlyModel(nn.Module):
    """Ablation: GRU on glucose channel only, no EHR."""

    def __init__(self, dropout: float = 0.3):
        super().__init__()
        self.gru = nn.GRU(input_size=1, hidden_size=64, num_layers=2,
                          batch_first=True, dropout=dropout, bidirectional=True)
        self.proj = nn.Linear(128, 64)
        self.cls_head = nn.Linear(64, 1)
        self.forecast_head = nn.Linear(64, 4)

    def forward(self, x_ts: torch.Tensor, x_ehr: torch.Tensor) -> tuple:
        x_gluc = x_ts[:, :, :1]   # first channel = glucose
        out, _ = self.gru(x_gluc)
        h = F.relu(self.proj(out[:, -1, :]))
        prob = torch.sigmoid(self.cls_head(h)).squeeze(-1)
        forecast = self.forecast_head(h)
        return prob, forecast


class WearablesNoEHRModel(nn.Module):
    """Ablation: GRU on all time-series channels, no EHR."""

    def __init__(self, ts_input_dim: int = 7, dropout: float = 0.3):
        super().__init__()
        self.gru = nn.GRU(input_size=ts_input_dim, hidden_size=64, num_layers=2,
                          batch_first=True, dropout=dropout, bidirectional=True)
        self.proj = nn.Linear(128, 64)
        self.cls_head = nn.Linear(64, 1)
        self.forecast_head = nn.Linear(64, 4)

    def forward(self, x_ts: torch.Tensor, x_ehr: torch.Tensor) -> tuple:
        out, _ = self.gru(x_ts)
        h = F.relu(self.proj(out[:, -1, :]))
        prob = torch.sigmoid(self.cls_head(h)).squeeze(-1)
        forecast = self.forecast_head(h)
        return prob, forecast
