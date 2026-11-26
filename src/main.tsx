import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store/useStore';
import { exportActions } from './io/actions';
import { buildSvg, renderEps, renderPdf, renderPng } from './io/export';
import { buildPptx } from './io/pptx';
import { diagramsFromPptx, diagramFromPowerPointSvg } from './io/pptImport';
import { parse } from './dsl/parser';
import { generate, syncCode } from './dsl/generator';
import './styles.css';

// Debug / scripting handle (console): BlockIllustrator.useStore.getState()
(window as any).BlockIllustrator = { useStore, exportActions, buildSvg, renderPng, renderPdf, renderEps, buildPptx, diagramsFromPptx, diagramFromPowerPointSvg, parse, generate, syncCode };

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
