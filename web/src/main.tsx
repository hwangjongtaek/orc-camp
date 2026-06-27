import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/global.css';
import { captureBoot } from './config/bootstrap';
import { ApiClient } from './api/client';
import { RealtimeEngine } from './realtime/engine';
import { useStore } from './store/store';
import { ServicesProvider } from './app/services';
import { AssetProvider } from './assets/AssetContext';
import { App } from './App';

const boot = captureBoot();
const api = new ApiClient(boot.apiBase);
const engine = new RealtimeEngine(api, boot.wsBase);

// reduced-motion: seed + live-track (SPEC-300 §3.5 / SPEC-202 §2.5).
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
useStore.getState().setReducedMotion(mq.matches);
mq.addEventListener('change', (e) => useStore.getState().setReducedMotion(e.matches));

if (!boot.hadToken) {
  // No token in the boot URL → unauthorized view (re-run / re-open the boot URL).
  useStore.getState().setUnauthorized(true);
} else {
  engine.start();
  void api.getSettings().then((res) => {
    if (res.ok) useStore.getState().setSettings(res.data);
  });
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <ServicesProvider services={{ api, engine }}>
        <AssetProvider assetBase={boot.assetBase}>
          <App />
        </AssetProvider>
      </ServicesProvider>
    </BrowserRouter>
  </StrictMode>,
);
