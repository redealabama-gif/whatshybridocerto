/**
 * 📊 ChartEngine - Motor de Gráficos Puro SVG
 * Baseado no Quantum CRM chart-engine.js
 * Implementação leve sem dependências externas
 */

(function() {
  'use strict';

  // Paleta oficial (AI modern): variações de roxo/azul
  const PALETTE = [
    '#8b5cf6', // purple
    '#3b82f6', // blue
    '#a78bfa', // purple (light)
    '#60a5fa', // blue (light)
    '#10b981', // green
    '#f59e0b', // yellow
    '#ef4444', // red
    '#ec4899'  // pink
  ];

  function getColor(index) {
    return PALETTE[index % PALETTE.length];
  }

  function clearContainer(container) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function ensureWrapper(container, extraClass) {
    clearContainer(container);
    const wrapper = document.createElement('div');
    wrapper.className = 'whl-chart ' + (extraClass || '');
    container.appendChild(wrapper);
    return wrapper;
  }

  function renderEmptyState(container, message) {
    const wrapper = ensureWrapper(container, 'whl-chart--empty');
    const msg = document.createElement('div');
    msg.className = 'whl-chart-empty';
    // v9.3.8 SECURITY FIX: message é parametro do caller — pode vir de erro do backend.
    const safeMessage = String(message || 'Sem dados suficientes para exibir o gráfico ainda.')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    msg.innerHTML = `
      <div style="text-align:center;padding:20px;color:rgba(255,255,255,0.5);">
        <div style="font-size:32px;margin-bottom:8px;">📊</div>
        <div>${safeMessage}</div>
      </div>
    `;
    wrapper.appendChild(msg);
    return { type: 'empty', destroy: () => clearContainer(container) };
  }

  function normalizeDatasets(datasets) {
    if (!Array.isArray(datasets) || !datasets.length) {
      return [{ label: 'Valor', data: [] }];
    }
    return datasets.map((ds, index) => ({
      label: ds.label || `Série ${index + 1}`,
      data: Array.isArray(ds.data) ? ds.data : [],
      color: ds.color || getColor(index),
      fill: !!ds.fill
    }));
  }

  /**
   * Gráfico de Barras (vertical ou horizontal)
   */
  function renderBarChart(container, config) {
    if (!container) return null;

    const labels = config.labels || [];
    const datasets = normalizeDatasets(config.datasets);
    const orientation = config.orientation === 'horizontal' ? 'horizontal' : 'vertical';

    const allValues = datasets.flatMap(d => d.data || []);
    const maxValue = Math.max(0, ...allValues);
    if (!maxValue || !labels.length) {
      return renderEmptyState(container, config.emptyMessage);
    }

    const wrapper = ensureWrapper(container, `whl-chart--bar whl-chart--${orientation}`);
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    const barsContainer = document.createElement('div');
    barsContainer.style.cssText = `
      display:flex;
      ${orientation === 'vertical' ? 'align-items:flex-end;gap:8px;height:120px;' : 'flex-direction:column;gap:6px;'}
    `;
    wrapper.appendChild(barsContainer);

    labels.forEach((label, idx) => {
      const group = document.createElement('div');
      group.style.cssText = orientation === 'vertical' 
        ? 'flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;'
        : 'display:flex;align-items:center;gap:8px;';

      datasets.forEach((ds, dsIndex) => {
        const value = ds.data[idx] || 0;
        const pct = maxValue ? (value / maxValue) * 100 : 0;

        const bar = document.createElement('div');
        bar.style.cssText = `
          background:linear-gradient(135deg, ${ds.color}, ${adjustColor(ds.color, -20)});
          border-radius:4px;
          transition:all 0.3s ease;
          position:relative;
          min-width:4px;
          min-height:4px;
          ${orientation === 'vertical' 
            ? `width:100%;height:${pct}%;` 
            : `height:20px;width:${pct}%;`}
        `;
        bar.title = `${ds.label}: ${value.toLocaleString()}`;

        // Hover effect
        bar.addEventListener('mouseenter', () => {
          bar.style.transform = 'scale(1.05)';
          bar.style.boxShadow = `0 4px 12px ${ds.color}40`;
        });
        bar.addEventListener('mouseleave', () => {
          bar.style.transform = 'scale(1)';
          bar.style.boxShadow = 'none';
        });

        if (value > 0) {
          const valueLabel = document.createElement('span');
          valueLabel.style.cssText = `
            position:absolute;
            ${orientation === 'vertical' ? 'top:-18px;left:50%;transform:translateX(-50%);' : 'right:4px;'}
            font-size:10px;
            font-weight:600;
            color:${ds.color};
          `;
          valueLabel.textContent = value.toLocaleString();
          bar.appendChild(valueLabel);
        }

        group.appendChild(bar);
      });

      const labelEl = document.createElement('div');
      labelEl.style.cssText = `
        font-size:10px;
        color:rgba(255,255,255,0.6);
        text-align:center;
        margin-top:${orientation === 'vertical' ? '4px' : '0'};
        ${orientation === 'horizontal' ? 'min-width:60px;' : ''}
      `;
      labelEl.textContent = label;
      
      if (orientation === 'vertical') {
        group.appendChild(labelEl);
      } else {
        group.insertBefore(labelEl, group.firstChild);
      }

      barsContainer.appendChild(group);
    });

    // Legenda
    if (datasets.length > 1) {
      const legend = createLegend(datasets);
      wrapper.appendChild(legend);
    }

    return { type: 'bar', destroy: () => clearContainer(container) };
  }

  /**
   * Gráfico de Linha usando SVG
   */
  function renderLineChart(container, config) {
    if (!container) return null;

    const labels = config.labels || [];
    const datasets = normalizeDatasets(config.datasets);
    const series = datasets[0];

    const values = series.data || [];
    const maxValue = Math.max(0, ...values);
    if (!maxValue || !labels.length) {
      return renderEmptyState(container, config.emptyMessage);
    }

    const wrapper = ensureWrapper(container, 'whl-chart--line');
    
    const width = 380;
    const height = 160;
    const paddingLeft = 40;
    const paddingRight = 10;
    const paddingTop = 20;
    const paddingBottom = 30;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.cssText = 'width:100%;height:auto;';
    wrapper.appendChild(svg);

    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    const stepX = labels.length > 1 ? plotWidth / (labels.length - 1) : plotWidth;

    // Grid horizontal
    for (let i = 0; i <= 4; i++) {
      const y = paddingTop + (plotHeight * i / 4);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', paddingLeft);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width - paddingRight);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'rgba(255,255,255,0.1)');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
    }

    // Área preenchida
    if (series.fill !== false) {
      const areaPoints = values.map((v, idx) => {
        const x = paddingLeft + stepX * idx;
        const ratio = maxValue ? v / maxValue : 0;
        const y = paddingTop + (1 - ratio) * plotHeight;
        return `${x},${y}`;
      });
      
      const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      areaPath.setAttribute('points', 
        `${paddingLeft},${height - paddingBottom} ${areaPoints.join(' ')} ${paddingLeft + stepX * (values.length - 1)},${height - paddingBottom}`
      );
      areaPath.setAttribute('fill', `url(#gradient-${series.color.replace('#', '')})`);
      areaPath.setAttribute('opacity', '0.3');
      
      // Definir gradiente
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
      gradient.setAttribute('id', `gradient-${series.color.replace('#', '')}`);
      gradient.setAttribute('x1', '0%');
      gradient.setAttribute('y1', '0%');
      gradient.setAttribute('x2', '0%');
      gradient.setAttribute('y2', '100%');
      
      const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop1.setAttribute('offset', '0%');
      stop1.setAttribute('stop-color', series.color);
      gradient.appendChild(stop1);
      
      const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop2.setAttribute('offset', '100%');
      stop2.setAttribute('stop-color', 'transparent');
      gradient.appendChild(stop2);
      
      defs.appendChild(gradient);
      svg.appendChild(defs);
      svg.appendChild(areaPath);
    }

    // Linha
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    const points = values.map((v, idx) => {
      const x = paddingLeft + stepX * idx;
      const ratio = maxValue ? v / maxValue : 0;
      const y = paddingTop + (1 - ratio) * plotHeight;
      return `${x},${y}`;
    }).join(' ');

    path.setAttribute('points', points);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', series.color);
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);

    // Pontos
    values.forEach((v, idx) => {
      const x = paddingLeft + stepX * idx;
      const ratio = maxValue ? v / maxValue : 0;
      const y = paddingTop + (1 - ratio) * plotHeight;

      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(x));
      dot.setAttribute('cy', String(y));
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', series.color);
      dot.setAttribute('stroke', '#1a1a2e');
      dot.setAttribute('stroke-width', '2');
      dot.style.cursor = 'pointer';
      
      // Tooltip on hover
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${labels[idx]}: ${v.toLocaleString()}`;
      dot.appendChild(title);
      
      svg.appendChild(dot);
    });

    // Rótulos no eixo X
    labels.forEach((label, idx) => {
      const x = paddingLeft + stepX * idx;
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x));
      text.setAttribute('y', String(height - 8));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', 'rgba(255,255,255,0.5)');
      text.setAttribute('font-size', '10');
      text.textContent = label;
      svg.appendChild(text);
    });

    return { type: 'line', destroy: () => clearContainer(container) };
  }

  /**
   * Gráfico Donut/Pizza usando conic-gradient
   */
  function renderDonutChart(container, config) {
    if (!container) return null;

    const items = (config.items || []).filter(i => i && typeof i.value === 'number' && i.value > 0);
    const total = items.reduce((acc, cur) => acc + (cur.value || 0), 0);

    if (!total) {
      return renderEmptyState(container, config.emptyMessage);
    }

    const wrapper = ensureWrapper(container, 'whl-chart--donut');
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;';

    const donutSize = config.size || 140;
    const donutWrapper = document.createElement('div');
    donutWrapper.style.cssText = `position:relative;width:${donutSize}px;height:${donutSize}px;`;
    wrapper.appendChild(donutWrapper);

    const donut = document.createElement('div');
    donut.style.cssText = `
      width:100%;
      height:100%;
      border-radius:50%;
      position:relative;
    `;

    let current = 0;
    const segments = [];

    items.forEach((item, index) => {
      const value = item.value || 0;
      const pct = (value / total) * 100;
      const from = current;
      const to = current + pct;
      current = to;
      const color = item.color || getColor(index);
      segments.push(`${color} ${from.toFixed(2)}% ${to.toFixed(2)}%`);
    });

    donut.style.backgroundImage = `conic-gradient(${segments.join(', ')})`;

    // Centro (buraco do donut)
    const center = document.createElement('div');
    center.style.cssText = `
      position:absolute;
      top:50%;
      left:50%;
      transform:translate(-50%, -50%);
      width:${donutSize * 0.6}px;
      height:${donutSize * 0.6}px;
      background:rgba(26, 26, 46, 1);
      border-radius:50%;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
    `;

    const totalLabel = document.createElement('div');
    totalLabel.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.5);';
    totalLabel.textContent = config.totalLabel || 'Total';
    center.appendChild(totalLabel);

    const totalValue = document.createElement('div');
    totalValue.style.cssText = 'font-size:18px;font-weight:700;color:#fff;';
    totalValue.textContent = total.toLocaleString();
    center.appendChild(totalValue);

    donutWrapper.appendChild(donut);
    donutWrapper.appendChild(center);

    // Legenda
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;';

    items.forEach((item, index) => {
      const pct = total ? (item.value / total) * 100 : 0;
      const itemEl = document.createElement('div');
      itemEl.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;';

      const dot = document.createElement('span');
      dot.style.cssText = `
        width:8px;
        height:8px;
        border-radius:50%;
        background:${item.color || getColor(index)};
      `;
      itemEl.appendChild(dot);

      const label = document.createElement('span');
      label.style.color = 'rgba(255,255,255,0.7)';
      label.textContent = `${item.label || 'Item'} (${pct.toFixed(1)}%)`;
      itemEl.appendChild(label);

      legend.appendChild(itemEl);
    });

    wrapper.appendChild(legend);

    return { type: 'donut', destroy: () => clearContainer(container) };
  }

  /**
   * Gauge radial (para taxas/percentuais)
   */
  function renderGauge(container, config) {
    if (!container) return null;

    const value = typeof config.value === 'number' ? config.value : 0;
    const clamped = Math.max(0, Math.min(100, value));
    const color = config.color || (clamped >= 70 ? '#10b981' : clamped >= 40 ? '#f59e0b' : '#ef4444');

    const wrapper = ensureWrapper(container, 'whl-chart--gauge');
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';

    const size = config.size || 100;
    const svgNS = 'http://www.w3.org/2000/svg';
    const strokeWidth = 8;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    const gaugeWrapper = document.createElement('div');
    gaugeWrapper.style.cssText = `position:relative;width:${size}px;height:${size}px;`;

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.style.cssText = 'width:100%;height:100%;transform:rotate(-90deg);';

    // Fundo
    const circleBg = document.createElementNS(svgNS, 'circle');
    circleBg.setAttribute('cx', String(size / 2));
    circleBg.setAttribute('cy', String(size / 2));
    circleBg.setAttribute('r', String(radius));
    circleBg.setAttribute('fill', 'none');
    circleBg.setAttribute('stroke', 'rgba(255,255,255,0.1)');
    circleBg.setAttribute('stroke-width', String(strokeWidth));
    svg.appendChild(circleBg);

    // Progresso
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', String(size / 2));
    circle.setAttribute('cy', String(size / 2));
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', String(strokeWidth));
    circle.setAttribute('stroke-linecap', 'round');

    const offset = circumference * (1 - clamped / 100);
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = String(offset);
    circle.style.transition = 'stroke-dashoffset 0.5s ease';
    svg.appendChild(circle);

    gaugeWrapper.appendChild(svg);

    // Centro com valor
    const center = document.createElement('div');
    center.style.cssText = `
      position:absolute;
      top:50%;
      left:50%;
      transform:translate(-50%, -50%);
      text-align:center;
    `;

    const valueEl = document.createElement('div');
    valueEl.style.cssText = `font-size:${size / 4}px;font-weight:700;color:${color};`;
    valueEl.textContent = clamped.toFixed(1).replace('.0', '') + '%';
    center.appendChild(valueEl);

    if (config.label) {
      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.5);';
      labelEl.textContent = config.label;
      center.appendChild(labelEl);
    }

    gaugeWrapper.appendChild(center);
    wrapper.appendChild(gaugeWrapper);

    return { type: 'gauge', destroy: () => clearContainer(container) };
  }

  /**
   * KPI Card
   */
  function renderKPICard(container, config) {
    if (!container) return null;

    const wrapper = ensureWrapper(container, 'whl-chart--kpi');
    wrapper.style.cssText = `
      background: rgba(26, 26, 46, 0.8);
      border: 1px solid rgba(139, 92, 246, 0.2);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      transition: all 0.3s ease;
    `;

    // Hover effect
    wrapper.addEventListener('mouseenter', () => {
      wrapper.style.transform = 'translateY(-2px)';
      wrapper.style.boxShadow = '0 8px 25px rgba(139, 92, 246, 0.2)';
    });
    wrapper.addEventListener('mouseleave', () => {
      wrapper.style.transform = 'translateY(0)';
      wrapper.style.boxShadow = 'none';
    });

    if (config.icon) {
      const icon = document.createElement('div');
      icon.style.cssText = 'font-size:24px;';
      icon.textContent = config.icon;
      wrapper.appendChild(icon);
    }

    const value = document.createElement('div');
    value.style.cssText = `
      font-size: 28px;
      font-weight: 800;
      background: linear-gradient(135deg, ${config.color || '#8b5cf6'}, ${config.secondaryColor || '#3b82f6'});
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    `;
    value.textContent = typeof config.value === 'number' 
      ? config.value.toLocaleString() 
      : String(config.value || '0');
    wrapper.appendChild(value);

    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.5px;';
    label.textContent = config.label || 'Valor';
    wrapper.appendChild(label);

    if (config.change !== undefined) {
      const change = document.createElement('div');
      const isPositive = config.change >= 0;
      change.style.cssText = `
        font-size:11px;
        color:${isPositive ? '#10b981' : '#ef4444'};
        display:flex;
        align-items:center;
        gap:4px;
      `;
      change.innerHTML = `${isPositive ? '↑' : '↓'} ${Math.abs(config.change).toFixed(1)}%`;
      wrapper.appendChild(change);
    }

    return { type: 'kpi', destroy: () => clearContainer(container) };
  }

  // Helpers
  function createLegend(datasets) {
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:8px;';

    datasets.forEach((ds, index) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;';

      const dot = document.createElement('span');
      dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${ds.color || getColor(index)};`;
      item.appendChild(dot);

      const label = document.createElement('span');
      label.style.color = 'rgba(255,255,255,0.7)';
      label.textContent = ds.label;
      item.appendChild(label);

      legend.appendChild(item);
    });

    return legend;
  }

  function adjustColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
    const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }

  // API Pública
  window.ChartEngine = {
    PALETTE,
    getColor,
    renderBarChart,
    renderLineChart,
    renderDonutChart,
    renderGauge,
    renderKPICard,
    renderEmptyState,
    clearContainer
  };

  console.log('[ChartEngine] ✅ Motor de gráficos inicializado');
})();
