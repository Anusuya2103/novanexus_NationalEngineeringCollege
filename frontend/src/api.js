/**
 * api.js — HealthTwin typed API client v3
 * Set VITE_MOCK=1 to use fixtures instead of live API.
 */
import axios from 'axios';
import * as M from './mock/fixtures.js';

export const IS_MOCK = import.meta.env.VITE_MOCK === '1';
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const API_BASE = BASE;

const http = axios.create({ baseURL: BASE, timeout: 30000 });

function mock(val, delayMs = 80) {
  return new Promise(res => setTimeout(() => res(val), delayMs));
}

export const api = {
  health:       () => IS_MOCK ? mock({status:'ok',models_loaded:true,disclaimer:'MOCK MODE'}) : http.get('/health').then(r=>r.data),
  getMetrics:   () => IS_MOCK ? mock(M.MOCK_METRICS) : http.get('/metrics').then(r=>r.data),
  getPatients:  () => IS_MOCK ? mock(M.MOCK_PATIENTS) : http.get('/patients').then(r=>r.data),
  getPatient:   (pid) => IS_MOCK ? mock(M.MOCK_PATIENT) : http.get(`/patient/${pid}`).then(r=>r.data),
  sampleWindow: (pid) => IS_MOCK ? mock({patient_id:pid,window_index:847,label:1,x_ts_flat:Array(168).fill(0),x_ehr:Array(12).fill(0),x_ts_raw_glucose:Array(24).fill(180),x_ts_raw_full:[]}) : http.get(`/sample/${pid}`).then(r=>r.data),

  predictById:  (pid, idx) => IS_MOCK ? mock({...M.MOCK_PREDICT,window_index:idx??847}) : http.get(`/predict/${pid}${idx!=null?`?window_idx=${idx}`:''}`).then(r=>r.data),
  explainById:  (pid, idx) => IS_MOCK ? mock(M.MOCK_EXPLAIN) : http.get(`/explain/${pid}${idx!=null?`?window_idx=${idx}`:''}`).then(r=>r.data),
  whatifById:   (pid,body) => IS_MOCK ? mock(M.MOCK_WHATIF) : http.post(`/whatif/${pid}`,body).then(r=>r.data),
  getWindows:   (pid,risk='high',limit=3) => IS_MOCK ? mock(M.MOCK_WINDOWS) : http.get(`/windows/${pid}?risk=${risk}&limit=${limit}`).then(r=>r.data),

  predict:  (p) => IS_MOCK ? mock(M.MOCK_PREDICT)  : http.post('/predict',p).then(r=>r.data),
  forecast: (p) => IS_MOCK ? mock(M.MOCK_FORECAST) : http.post('/forecast',p).then(r=>r.data),
  explain:  (p) => IS_MOCK ? mock(M.MOCK_EXPLAIN)  : http.post('/explain',p).then(r=>r.data),
  whatif:   (p) => IS_MOCK ? mock(M.MOCK_WHATIF)   : http.post('/whatif',p).then(r=>r.data),
};
