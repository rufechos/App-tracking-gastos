// Loads the bundled libraries only when they are needed (charts after the first paint, readers on import).
const loading = {};
export function loadScript(src) {
  if (!loading[src]) {
    loading[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { delete loading[src]; reject(new Error('No se pudo cargar ' + src.split('/').pop() + '.')); };
      document.head.appendChild(s);
    });
  }
  return loading[src];
}

export async function loadChart() {
  if (!window.Chart) await loadScript('vendor/chart.umd.js');
  return window.Chart;
}

export async function loadPdf() {
  if (!window.pdfjsLib) await loadScript('vendor/pdf.min.js');
  // A real worker: long PDFs are read without freezing the screen.
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  return window.pdfjsLib;
}
