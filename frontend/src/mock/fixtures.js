/**
 * Mock fixtures for VITE_MOCK=1 mode.
 * Schema-identical to real API responses.
 */
export const MOCK_PATIENTS = {
  patient_ids: ["P0001","P0002","P0003"], count: 3,
};
export const MOCK_PATIENT = {
  patient: {
    patient_id:"P0001",age:58,sex:"M",bmi:31.2,hba1c_pct:8.1,
    sbp_mmhg:138,dbp_mmhg:86,medication:"Metformin",
    diabetes_duration_yrs:9,prior_hyper_events_90d:12,
    n_comorbidities:2,comorbid_hypertension:1,comorbid_dyslipidemia:1,
    TCF7L2_risk:1,KCNJ11_risk:0,PPARG_risk:0,
  },
  latest_window:{window_index:847,label:1,prob_mean:0.73,risk_band:"High",last_glucose_mgdl:194.2},
  disclaimer:"Simulated data. Not clinical advice.",
};
export const MOCK_PREDICT = {
  prob_mean:0.73,prob_lower:0.61,prob_upper:0.84,
  risk_band:"High",true_label:1,window_index:847,
  forecast:[{horizon_min:30,glucose_mgdl:198},{horizon_min:60,glucose_mgdl:207},{horizon_min:90,glucose_mgdl:203},{horizon_min:120,glucose_mgdl:191}],
  forecast_lower:[187,194,188,175],forecast_upper:[209,221,218,207],
  baseline_models:{xgboost_prob:0.81,logreg_prob:0.68},
  threshold_mgdl:180,horizon_hours:2,
  disclaimer:"Simulated data. Model outputs are not clinical advice.",
};
export const MOCK_EXPLAIN = {
  factor_contributions:[
    {factor:"recent_glucose_trend",label:"Recent Glucose Trend",pct:30.4,rank:1},
    {factor:"hr_and_hrv",          label:"Heart Rate & HRV",    pct:19.2,rank:2},
    {factor:"meal_and_carbs",      label:"Meal & Carbs",        pct:14.2,rank:3},
    {factor:"ehr_context",         label:"EHR Context",         pct:12.8,rank:4},
    {factor:"activity",            label:"Activity",            pct:11.3,rank:5},
    {factor:"sleep",               label:"Sleep",               pct:11.1,rank:6},
    {factor:"medication",          label:"Medication",          pct:1.0, rank:7},
  ],
  factors:{recent_glucose_trend:30.4,hr_and_hrv:19.2,meal_and_carbs:14.2,ehr_context:12.8,activity:11.3,sleep:11.1,medication:1.0},
  sum_check_pct:100.0,
  window_glucose_stats:{glucose_mean:187.4,glucose_std:18.2,glucose_min:161.0,glucose_max:214.6,glucose_last:194.2,glucose_slope_mgdl_per_15min:2.8},
  disclaimer:"Simulated data. Model outputs are not clinical advice.",
};
export const MOCK_WHATIF = {
  baseline_prob:0.73,intervention_prob:0.54,diff_percentage_points:-19.0,
  baseline_risk_band:"High",intervention_risk_band:"Moderate",
  forecast_baseline:[198,207,203,191],forecast_intervention:[182,188,181,169],
  uncertainty_baseline:{lower:0.61,upper:0.84},uncertainty_intervention:{lower:0.42,upper:0.66},
  interventions_applied:{reduce_carbs_g:30,increase_steps:500},
  disclaimer:"model simulation, not causal or clinical advice",
};
export const MOCK_FORECAST = {
  prob_mean:0.73,prob_lower:0.61,prob_upper:0.84,
  forecast:[{horizon_min:30,glucose_mgdl:198},{horizon_min:60,glucose_mgdl:207},{horizon_min:90,glucose_mgdl:203},{horizon_min:120,glucose_mgdl:191}],
  forecast_lower:[187,194,188,175],forecast_upper:[209,221,218,207],
  forecast_method:"linear_extrapolation",
  display_series:{
    historical:Array.from({length:24},(_,i)=>({t_min:(i-23)*15,glucose_mgdl:160+Math.sin(i/3)*30+i*1.5})),
    predicted:[{t_min:30,glucose_mgdl:198,lower:187,upper:209},{t_min:60,glucose_mgdl:207,lower:194,upper:221},{t_min:90,glucose_mgdl:203,lower:188,upper:218},{t_min:120,glucose_mgdl:191,lower:175,upper:207}],
    threshold:180,
  },
  disclaimer:"Simulated data. Model outputs are not clinical advice.",
};
export const MOCK_WINDOWS = {
  windows:[
    {window_index:847,prob_mean:0.73,risk_band:"High",true_label:1,last_glucose:194.2,above_threshold:true},
    {window_index:923,prob_mean:0.81,risk_band:"Very High",true_label:1,last_glucose:221.5,above_threshold:true},
    {window_index:412,prob_mean:0.65,risk_band:"High",true_label:1,last_glucose:183.1,above_threshold:true},
  ],
  patient_id:"P0001",risk_filter:"high",
};
export const MOCK_METRICS = {
  dataset_info:{n_patients:120,simulation_days:30,cgm_interval_min:5,input_window_hours:6,label_horizon_hours:2,hyperglycaemia_threshold_mgdl:180,class_balance:{train:{n_total:239316,n_positive:139541,n_negative:99775,pos_rate:0.583,pos_weight:0.715},val:{n_total:51282,n_positive:26473,n_negative:24809,pos_rate:0.516,pos_weight:0.937},test:{n_total:51282,n_positive:25760,n_negative:25522,pos_rate:0.502,pos_weight:0.990}}},
  models:{
    fusion_full:{auroc:0.9157,auprc:0.9221,f1:0.8186,precision:0.8312,recall:0.8063,specificity:0.8298,ece:0.0582,confusion_matrix:{tp:20768,fp:4210,tn:21312,fn:4992},forecast:{"+30min":{mae:28.4,rmse:36.1},"+60min":{mae:31.2,rmse:39.8},"+90min":{mae:33.1,rmse:41.9},"+120min":{mae:34.7,rmse:43.2}},label:"Full Fusion (GRU + EHR)"},
    ablation_glucose_only:{auroc:0.8142,auprc:0.8458,f1:0.6876,label:"GRU (glucose only)"},
    ablation_wearables_no_ehr:{auroc:0.9080,auprc:0.9128,f1:0.8136,label:"GRU + Wearables"},
    xgboost:{auroc:0.9417,auprc:0.9452,f1:0.8501,label:"XGBoost"},
    logreg:{auroc:0.9059,auprc:0.9092,f1:0.8108,label:"Logistic Regression"},
  },
  honest_comparison:{fusion_auroc:0.9157,xgboost_auroc:0.9417,diff_percentage_points:-2.6,note:"Full fusion model underperforms vs. XGBoost by 2.60 percentage points on AUROC. On synthetic data, tree models can match or beat deep learning — this is expected."},
  sanity_tests:{activity_reduces_risk:{passed:false,mean_delta_pp:5.6,pct_windows_increased:94.5,n_tested:200,status:"FAIL",honest_note:"FAIL: intervention does NOT consistently reduce risk on this synthetic dataset."},low_carbs_reduces_risk:{passed:false,mean_delta_pp:8.97,pct_windows_increased:67.0,n_tested:200,status:"FAIL",honest_note:"FAIL: intervention does NOT consistently reduce risk on this synthetic dataset."}},
  ablation_table:[{model:"GRU (glucose only)",auroc:0.8142,auprc:0.8458,f1:0.6876},{model:"GRU + Wearables (no EHR)",auroc:0.9080,auprc:0.9128,f1:0.8136},{model:"Full Fusion (GRU + EHR)",auroc:0.9157,auprc:0.9221,f1:0.8186},{model:"XGBoost (tabular)",auroc:0.9417,auprc:0.9452,f1:0.8501},{model:"Logistic Regression",auroc:0.9059,auprc:0.9092,f1:0.8108}],
};
