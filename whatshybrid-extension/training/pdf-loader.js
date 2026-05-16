// Carrega o PDF.js (ES module) e expõe como window.pdfjsLib.
// Extraído de um <script type="module"> inline do training.html — script
// inline é bloqueado pelo CSP do MV3 (script-src 'self'); como arquivo
// externo o módulo carrega normalmente.
import * as pdfjsLib from '../lib/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
window.pdfjsLib = pdfjsLib;
