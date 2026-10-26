import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
// Anek Latin by Ek Type (an Indian type foundry), bundled so it works offline.
import '@fontsource-variable/anek-latin/standard.css';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
