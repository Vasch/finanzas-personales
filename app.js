import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://wdwlacdxlvrlthognfzn.supabase.co'
const SUPABASE_KEY = 'sb_publishable_3j__spC7dmwoMYibLZPXPQ_eTm-nC-6'
const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const state = { movs: [], dic: [], pres: [], charts: {}, mesSeleccionado: '' }

const fmt = n => '$' + Math.round(n).toLocaleString('es-CL')
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b && b.classList && b.classList.remove('active'))
    document.querySelectorAll('.tab').forEach(t => t && t.classList && t.classList.remove('active'))
    btn.classList.add('active')
    const tab = document.getElementById('tab-' + btn.dataset.tab)
    if (tab) tab.classList.add('active')
    if (btn.dataset.tab === 'movimientos') renderMovs()
    if (btn.dataset.tab === 'diccionario') renderDic()
    if (btn.dataset.tab === 'presupuestos') renderPres()
    if (btn.dataset.tab === 'inicio') renderInicio()
  })
})

function hashMov(m) {
  return `${m.fecha}_${m.descripcion}_${m.cargo}_${m.abono}_${m.fuente}`.replace(/\s+/g,'_')
}

function parseFechaChile(fecha) {
  const parts = fecha.split('/')
  if (parts.length < 2) return null
  const dia = parts[0].padStart(2,'0')
  const mes = parts[1].padStart(2,'0')
  let anio = parts[2] || new Date().getFullYear().toString()
  if (anio.length === 2) anio = '20' + anio
  return `${anio}-${mes}-${dia}`
}

function clasificar(desc, dic, abono) {
  const descUp = desc.toUpperCase()
  for (const d of dic) {
    if (descUp.includes(d.codigo.toUpperCase())) {
      return { categoria: d.categoria, tipo: d.tipo }
    }
  }
  if (abono > 0) return { categoria: 'Ingreso sin clasificar', tipo: 'Ingreso' }
  return { categoria: 'Sin clasificar', tipo: 'Sin clasificar' }
}

async function cargarDatos() {
  const [movs, dic, pres] = await Promise.all([
    sb.from('movimientos').select('*').order('fecha', { ascending: false }),
    sb.from('diccionario').select('*').order('categoria'),
    sb.from('presupuestos').select('*')
  ])
  state.movs = movs.data || []
  state.dic = dic.data || []
  state.pres = pres.data || []
}

function detectarFormato(rows) {
  const flat = rows.flat().map(c => String(c || '').toUpperCase())
  const hasTC = flat.some(c => c.includes('TITULAR') || c.includes('MOVIMIENTOS FACTURADOS') || c.includes('MOVIMIENTOS NACIONALES'))
  const hasDebito = flat.some(c => c.includes('CUENTA:') || c.includes('CARGOS (PESOS)') || c.includes('CARGOS (CLP)'))
  if (hasTC) return 'tc'
  if (hasDebito) return 'debito'
  return null
}

function parsearDebito(rows) {
  const movs = []
  let headerIdx = -1
  let colFecha = -1, colDesc = -1, colCargo = -1, colAbono = -1
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(c => String(c || '').toUpperCase().trim())
    const fechaIdx = row.findIndex(c => c === 'FECHA')
    const descIdx = row.findIndex(c => c.includes('DESCRIPCI'))
    const cargoIdx = row.findIndex(c => c.includes('CARGO'))
    const abonoIdx = row.findIndex(c => c.includes('ABONO'))
    if (fechaIdx >= 0 && descIdx >= 0 && cargoIdx >= 0) {
      headerIdx = i; colFecha = fechaIdx; colDesc = descIdx; colCargo = cargoIdx
      colAbono = abonoIdx >= 0 ? abonoIdx : cargoIdx + 1
      break
    }
  }
  if (headerIdx === -1) return []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue
    const fechaRaw = String(row[colFecha] || '').trim()
    if (!/^\d{1,2}\/\d{1,2}/.test(fechaRaw)) continue
    const desc = String(row[colDesc] || '').trim()
    if (!desc || desc.toUpperCase().includes('SALDO INICIAL') || desc.toUpperCase().includes('SALDO FINAL')) continue
    const cargo = parseFloat(String(row[colCargo] || '0').replace(/[^\d.-]/g,'')) || 0
    const abono = parseFloat(String(row[colAbono] || '0').replace(/[^\d.-]/g,'')) || 0
    if (cargo === 0 && abono === 0) continue
    const fecha = parseFechaChile(fechaRaw)
    if (!fecha) continue
    movs.push({ fecha, descripcion: desc, cargo, abono, fuente: 'Débito' })
  }
  return movs
}

function parsearTC(rows) {
  const movs = []
  for (const row of rows) {
    if (!row || row.length < 5) continue
    let fechaRaw = null, desc = null, monto = 0
    for (const cell of row) {
      const s = String(cell || '').trim()
      if (!fechaRaw && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) fechaRaw = s
    }
    if (!fechaRaw) continue
    for (let i = 0; i < row.length; i++) {
      const s = String(row[i] || '').trim()
      if (s.length > 8 && !/^\d+\/\d+/.test(s) && !/^[\d\s\/,.-]+$/.test(s) && !s.toUpperCase().includes('TITULAR')) {
        desc = s; break
      }
    }
    for (let i = row.length - 1; i >= 0; i--) {
      const n = parseFloat(String(row[i] || '').replace(/[^\d.-]/g,''))
      if (!isNaN(n) && Math.abs(n) >= 100 && Math.abs(n) < 100000000) { monto = n; break }
    }
    if (!desc || monto === 0) continue
    const fecha = parseFechaChile(fechaRaw)
    if (!fecha) continue
    if (monto < 0) movs.push({ fecha, descripcion: desc, cargo: 0, abono: Math.abs(monto), fuente: 'TC' })
    else movs.push({ fecha, descripcion: desc, cargo: monto, abono: 0, fuente: 'TC' })
  }
  return movs
}

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return
  const statusEl = document.getElementById('upload-status')
  statusEl.innerHTML = '<div class="status-msg info">Procesando archivo...</div>'
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: false })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    const formato = detectarFormato(rows)
    if (!formato) { statusEl.innerHTML = '<div class="status-msg err">Formato no detectado.</div>'; return }
    let parsed = formato === 'tc' ? parsearTC(rows) : parsearDebito(rows)
    if (parsed.length === 0) { statusEl.innerHTML = '<div class="status-msg err">Sin movimientos.</div>'; return }
    await cargarDatos()
    const aInsertar = []
    const hashesEnArchivo = new Set()
    let duplicados = 0
    for (const m of parsed) {
      let h = hashMov(m)
      let contador = 1
      while (hashesEnArchivo.has(h)) { contador++; h = hashMov(m) + '_' + contador }
      if (state.movs.some(x => x.hash === h)) { duplicados++; continue }
      hashesEnArchivo.add(h)
      const { categoria, tipo } = clasificar(m.descripcion, state.dic, m.abono)
      const mesNum = m.fecha.slice(5,7)
      const mes = MESES[parseInt(mesNum)-1]
      aInsertar.push({ ...m, hash: h, categoria, tipo, mes })
    }
    if (aInsertar.length > 0) {
      let insertados = 0
      for (const m of aInsertar) {
        const { error } = await sb.from('movimientos').insert(m)
        if (error && error.code === '23505') duplicados++
        else if (error) throw error
        else insertados++
      }
    }
    await sb.from('archivos_subidos').insert({
      nombre: file.name, movimientos_agregados: aInsertar.length, movimientos_duplicados: duplicados
    })
    statusEl.innerHTML = `<div class="status-msg ok">✓ ${aInsertar.length} movimientos agregados. ${duplicados > 0 ? duplicados + ' duplicados ignorados.' : ''}</div>`
    await cargarDatos()
    renderInicio()
    e.target.value = ''
  } catch (err) {
    statusEl.innerHTML = `<div class="status-msg err">Error: ${err.message}</div>`
  }
})

function movsFiltradosPorMes() {
  if (!state.mesSeleccionado) return state.movs
  return state.movs.filter(m => m.fecha.startsWith(state.mesSeleccionado))
}

function renderSelectorMes() {
  const sel = document.getElementById('f-mes-inicio')
  const meses = [...new Set(state.movs.map(m => m.fecha.slice(0,7)))].sort().reverse()
  sel.innerHTML = '<option value="">Todos los meses</option>' + meses.map(m => {
    const [y,mm] = m.split('-')
    return `<option value="${m}" ${state.mesSeleccionado===m?'selected':''}>${MESES[parseInt(mm)-1]} ${y}</option>`
  }).join('')
  sel.onchange = () => { state.mesSeleccionado = sel.value; renderInicio() }
}

function renderInicio() {
  renderSelectorMes()
  const movs = movsFiltradosPorMes()
  const ingresos = movs.filter(m => m.tipo === 'Ingreso').reduce((s,m) => s + (m.abono || 0) + (m.cargo || 0), 0)
  const egresos = movs.filter(m => m.tipo !== 'Ingreso' && m.tipo !== 'Movimiento interno' && m.cargo > 0).reduce((s,m) => s + m.cargo, 0)
  const interno = movs.filter(m => m.tipo === 'Movimiento interno').reduce((s,m) => s + (m.cargo || 0) + (m.abono || 0), 0)
  const neto = ingresos - egresos
  const sinClasificar = movs.filter(m => m.categoria === 'Sin clasificar').length

  document.getElementById('metrics-inicio').innerHTML = `
    <div class="metric"><div class="metric-label">Ingresos totales</div><div class="metric-value abono">${fmt(ingresos)}</div></div>
    <div class="metric"><div class="metric-label">Egresos totales</div><div class="metric-value cargo">${fmt(egresos)}</div></div>
    <div class="metric"><div class="metric-label">Neto</div><div class="metric-value neutral">${fmt(neto)}</div></div>
    <div class="metric"><div class="metric-label">Movimiento interno</div><div class="metric-value neutral">${fmt(interno)}</div></div>
    <div class="metric"><div class="metric-label">Sin clasificar</div><div class="metric-value neutral">${sinClasificar}</div></div>
  `
  renderChartMensual(state.movs)
  renderChartCategoria(movs)
  renderChartIngresos(movs)
  renderChartInterno(movs)
}

function renderChartMensual(movs) {
  const byMes = {}
  movs.forEach(m => {
    if (m.tipo === 'Movimiento interno') return
    const key = m.fecha.slice(0,7)
    if (!byMes[key]) byMes[key] = { ingresos: 0, egresos: 0 }
    if (m.tipo === 'Ingreso') byMes[key].ingresos += (m.abono || 0) + (m.cargo || 0)
    else if (m.cargo > 0) byMes[key].egresos += m.cargo
  })
  const keys = Object.keys(byMes).sort()
  const labels = keys.map(k => { const [y,m] = k.split('-'); return MESES[parseInt(m)-1] + ' ' + y.slice(2) })
  if (state.charts.mensual) state.charts.mensual.destroy()
  state.charts.mensual = new Chart(document.getElementById('chart-mensual'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Ingresos', data: keys.map(k => byMes[k].ingresos), backgroundColor: '#6ee7a8' },
      { label: 'Egresos', data: keys.map(k => byMes[k].egresos), backgroundColor: '#f87171' }
    ]},
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#a69fbf', font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}` } } },
      scales: {
        x: { ticks: { color: '#a69fbf' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#a69fbf', callback: v => v >= 1000000 ? '$'+(v/1e6).toFixed(1)+'M' : v >= 1000 ? '$'+(v/1000).toFixed(0)+'K' : '$'+v }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  })
}

function renderChartCategoria(movs) {
  const byCat = {}
  movs.forEach(m => {
    if (m.tipo !== 'Ingreso' && m.tipo !== 'Movimiento interno' && m.cargo > 0) {
      byCat[m.categoria] = (byCat[m.categoria] || 0) + m.cargo
    }
  })
  const sorted = Object.entries(byCat).sort((a,b) => b[1] - a[1]).slice(0, 15)
  const colors = ['#a78bfa','#7dd3fc','#fbbf60','#f87171','#6ee7a8','#f0997b','#d4537e','#5dcaa5','#97c459','#ef9f27','#AFA9EC','#85B7EB','#F5C4B3','#B5D4F4','#C0DD97']
  if (state.charts.cat) state.charts.cat.destroy()
  state.charts.cat = new Chart(document.getElementById('chart-cat'), {
    type: 'bar',
    data: { labels: sorted.map(e => e[0]), datasets: [{ label: 'Gasto', data: sorted.map(e => e[1]), backgroundColor: colors }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } } },
      scales: {
        x: { ticks: { color: '#a69fbf', callback: v => v >= 1000000 ? '$'+(v/1e6).toFixed(1)+'M' : v >= 1000 ? '$'+(v/1000).toFixed(0)+'K' : '$'+v }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#a69fbf', font: { size: 11 } }, grid: { display: false } }
      }
    }
  })
}

function renderChartIngresos(movs) {
  const byCat = {}
  movs.forEach(m => {
    if (m.tipo === 'Ingreso') byCat[m.categoria] = (byCat[m.categoria] || 0) + (m.abono || 0) + (m.cargo || 0)
  })
  const sorted = Object.entries(byCat).sort((a,b) => b[1] - a[1])
  const colors = ['#6ee7a8','#7dd3fc','#a78bfa','#fbbf60','#f0997b','#5dcaa5','#97c459']
  if (state.charts.ing) state.charts.ing.destroy()
  state.charts.ing = new Chart(document.getElementById('chart-ing'), {
    type: 'bar',
    data: { labels: sorted.map(e => e[0]), datasets: [{ label: 'Ingreso', data: sorted.map(e => e[1]), backgroundColor: colors }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } } },
      scales: {
        x: { ticks: { color: '#a69fbf', callback: v => v >= 1000000 ? '$'+(v/1e6).toFixed(1)+'M' : v >= 1000 ? '$'+(v/1000).toFixed(0)+'K' : '$'+v }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#a69fbf', font: { size: 11 } }, grid: { display: false } }
      }
    }
  })
}

function renderChartInterno(movs) {
  const byCat = {}
  movs.forEach(m => {
    if (m.tipo === 'Movimiento interno') byCat[m.categoria] = (byCat[m.categoria] || 0) + (m.cargo || 0) + (m.abono || 0)
  })
  const sorted = Object.entries(byCat).sort((a,b) => b[1] - a[1])
  if (state.charts.interno) state.charts.interno.destroy()
  state.charts.interno = new Chart(document.getElementById('chart-interno'), {
    type: 'bar',
    data: { labels: sorted.map(e => e[0]), datasets: [{ label: 'Movimiento', data: sorted.map(e => e[1]), backgroundColor: '#a78bfa' }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } } },
      scales: {
        x: { ticks: { color: '#a69fbf', callback: v => v >= 1000000 ? '$'+(v/1e6).toFixed(1)+'M' : v >= 1000 ? '$'+(v/1000).toFixed(0)+'K' : '$'+v }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#a69fbf', font: { size: 11 } }, grid: { display: false } }
      }
    }
  })
}

function renderMovs() {
  const mesSel = document.getElementById('f-mes')
  const catSel = document.getElementById('f-cat')
  const meses = [...new Set(state.movs.map(m => m.fecha.slice(0,7)))].sort().reverse()
  const cats = [...new Set(state.movs.map(m => m.categoria))].sort()
  mesSel.innerHTML = '<option value="">Todos los meses</option>' + meses.map(m => {
    const [y,mm] = m.split('-')
    return `<option value="${m}">${MESES[parseInt(mm)-1]} ${y}</option>`
  }).join('')
  catSel.innerHTML = '<option value="">Todas las categorías</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('')
  aplicarFiltros()
}

function aplicarFiltros() {
  const mes = document.getElementById('f-mes').value
  const cat = document.getElementById('f-cat').value
  const tipo = document.getElementById('f-tipo').value
  const texto = document.getElementById('f-texto').value.toLowerCase()
  let filtered = state.movs
  if (mes) filtered = filtered.filter(m => m.fecha.startsWith(mes))
  if (cat) filtered = filtered.filter(m => m.categoria === cat)
  if (tipo) filtered = filtered.filter(m => m.tipo === tipo)
  if (texto) filtered = filtered.filter(m => m.descripcion.toLowerCase().includes(texto))
  const container = document.getElementById('movs-list')
  if (filtered.length === 0) { container.innerHTML = '<div class="empty">Sin movimientos.</div>'; return }
  container.innerHTML = filtered.map(m => {
    const monto = m.cargo > 0 ? `-${fmt(m.cargo)}` : `+${fmt(m.abono)}`
    const cls = m.cargo > 0 ? 'cargo' : 'abono'
    const badgeCls = m.tipo === 'Necesario' ? 'nec' : m.tipo === 'Prescindible' ? 'pres' : m.tipo === 'Ingreso' ? 'ing' : m.tipo === 'Movimiento interno' ? 'ing' : 'unc'
    const fechaFmt = m.fecha.slice(8,10) + '/' + m.fecha.slice(5,7)
    return `<div class="mov-row" onclick="editarMov(${m.id})">
      <span class="mov-fecha">${fechaFmt}</span>
      <div><div class="mov-desc">${m.descripcion}</div><div class="mov-cat">${m.categoria} · ${m.fuente}</div></div>
      <span class="badge ${badgeCls}">${m.tipo}</span>
      <span class="mov-monto ${cls}">${monto}</span>
    </div>`
  }).join('')
}

;['f-mes','f-cat','f-tipo','f-texto'].forEach(id => {
  document.getElementById(id).addEventListener('input', aplicarFiltros)
})

window.editarMov = (id) => {
  const m = state.movs.find(x => x.id === id)
  if (!m) return
  const cats = [...new Set(state.movs.map(x => x.categoria).concat(state.dic.map(d => d.categoria)))].filter(c => c && c !== 'Sin clasificar').sort()
  showModal(`
    <h3>Editar movimiento</h3>
    <p style="font-size:12px;color:var(--text-dim)">${m.descripcion}</p>
    <label>Categoría (elige existente o escribe nueva)</label>
    <select id="m-cat-select">
      <option value="__nueva__">+ Crear nueva categoría...</option>
      ${cats.map(c => `<option value="${c}" ${c===m.categoria?'selected':''}>${c}</option>`).join('')}
    </select>
    <input type="text" id="m-cat-nueva" placeholder="Nombre nueva categoría" style="display:none;margin-top:6px" />
    <label>Tipo</label>
    <select id="m-tipo">
      <option value="Necesario" ${m.tipo==='Necesario'?'selected':''}>Necesario</option>
      <option value="Prescindible" ${m.tipo==='Prescindible'?'selected':''}>Prescindible</option>
      <option value="Ingreso" ${m.tipo==='Ingreso'?'selected':''}>Ingreso</option>
      <option value="Movimiento interno" ${m.tipo==='Movimiento interno'?'selected':''}>Movimiento interno</option>
      <option value="Sin clasificar" ${m.tipo==='Sin clasificar'?'selected':''}>Sin clasificar</option>
    </select>
    <label><input type="checkbox" id="m-add-dic" checked /> Guardar en diccionario</label>
    <label>Código a guardar</label>
    <input type="text" id="m-codigo" value="${m.descripcion.slice(0,40)}" />
    <div class="modal-actions">
      <button class="btn-small" onclick="closeModal()">Cancelar</button>
      <button class="btn-primary" onclick="guardarMov(${id})">Guardar</button>
    </div>
  `)
  const sel = document.getElementById('m-cat-select')
  const inp = document.getElementById('m-cat-nueva')
  sel.addEventListener('change', () => { inp.style.display = sel.value === '__nueva__' ? 'block' : 'none' })
  if (!cats.includes(m.categoria)) { sel.value = '__nueva__'; inp.style.display = 'block'; inp.value = m.categoria }
}

window.guardarMov = async (id) => {
  const selVal = document.getElementById('m-cat-select').value
  const nuevaVal = document.getElementById('m-cat-nueva').value.trim()
  const cat = selVal === '__nueva__' ? nuevaVal : selVal
  if (!cat) { alert('Debes elegir o escribir una categoría'); return }
  const tipo = document.getElementById('m-tipo').value
  const addDic = document.getElementById('m-add-dic').checked
  const codigo = document.getElementById('m-codigo').value.trim()

  const { error } = await sb.from('movimientos').update({ categoria: cat, tipo }).eq('id', Number(id))
  if (error) { alert('Error: ' + error.message); return }

  if (addDic && codigo) {
    await sb.from('diccionario').upsert({ codigo, significado: codigo, categoria: cat, tipo }, { onConflict: 'codigo' })
    closeModal()
    mostrarModalAplicar(codigo, cat, tipo)
  } else {
    closeModal()
    await cargarDatos()
    renderMovs()
  }
}

function mostrarModalAplicar(codigo, cat, tipo) {
  showModal(`
    <h3>¿Cómo aplicar esta clasificación?</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:1rem">
      Se guardó <strong>${codigo}</strong> → <strong>${cat}</strong> en el diccionario.
    </p>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:1rem">
      Elige a qué movimientos aplicar:
    </p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn-primary" onclick="aplicarMasivo('solo', '${codigo.replace(/'/g,"\\'")}', '${cat.replace(/'/g,"\\'")}', '${tipo}')">
        Solo este movimiento
      </button>
      <button class="btn-primary" onclick="aplicarMasivo('sin_clasificar', '${codigo.replace(/'/g,"\\'")}', '${cat.replace(/'/g,"\\'")}', '${tipo}')">
        Solo los "Sin clasificar" con descripción similar
      </button>
      <button class="btn-primary" onclick="aplicarMasivo('todos', '${codigo.replace(/'/g,"\\'")}', '${cat.replace(/'/g,"\\'")}', '${tipo}')">
        Todos los que contengan "${codigo}" (sobrescribir)
      </button>
    </div>
    <div class="modal-actions" style="margin-top:1rem">
      <button class="btn-small" onclick="closeModal(); cargarDatos().then(renderMovs)">Cerrar</button>
    </div>
  `)
}

window.aplicarMasivo = async (modo, codigo, cat, tipo) => {
  if (modo === 'sin_clasificar') {
    await sb.from('movimientos').update({ categoria: cat, tipo }).ilike('descripcion', `%${codigo}%`).eq('categoria', 'Sin clasificar')
  } else if (modo === 'todos') {
    await sb.from('movimientos').update({ categoria: cat, tipo }).ilike('descripcion', `%${codigo}%`)
  }
  // Si es 'solo', no hace nada porque el movimiento ya se actualizó antes
  closeModal()
  await cargarDatos()
  renderMovs()
}

function renderDic() {
  const container = document.getElementById('dic-list')
  if (state.dic.length === 0) { container.innerHTML = '<div class="empty">Diccionario vacío.</div>'; return }
  container.innerHTML = state.dic.map(d => {
    const badgeCls = d.tipo === 'Necesario' ? 'nec' : d.tipo === 'Prescindible' ? 'pres' : 'ing'
    return `<div class="dic-row">
      <span><strong>${d.codigo}</strong></span>
      <span style="color:var(--text-dim);font-size:12px">${d.categoria}</span>
      <span class="badge ${badgeCls}">${d.tipo}</span>
      <button class="btn-small" onclick="editarDic(${d.id})">Editar</button>
      <button class="btn-small btn-danger" onclick="eliminarDic(${d.id})">×</button>
    </div>`
  }).join('')
  
  const cats = [...new Set(state.dic.map(d => d.categoria))].sort()
  container.innerHTML += `
    <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)">
      <h3 style="margin-bottom:8px">Renombrar categoría masivamente</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
        <div style="flex:1;min-width:140px"><label style="font-size:11px;color:var(--text-dim)">Categoría actual</label>
          <select id="ren-from">${cats.map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
        <div style="flex:1;min-width:140px"><label style="font-size:11px;color:var(--text-dim)">Nuevo nombre</label>
          <input type="text" id="ren-to" /></div>
        <button class="btn-primary" onclick="renombrarCategoria()">Renombrar</button>
      </div>
    </div>`
}

window.renombrarCategoria = async () => {
  const from = document.getElementById('ren-from').value
  const to = document.getElementById('ren-to').value.trim()
  if (!from || !to) { alert('Completa ambos campos'); return }
  if (!confirm(`¿Renombrar categoría "${from}" a "${to}" en todos los movimientos y el diccionario?`)) return
  await sb.from('movimientos').update({ categoria: to }).eq('categoria', from)
  await sb.from('diccionario').update({ categoria: to }).eq('categoria', from)
  await cargarDatos()
  renderDic()
  alert('Categoría renombrada')
}

document.getElementById('btn-add-dic').addEventListener('click', () => editarDic(null))

window.editarDic = (id) => {
  const d = id ? state.dic.find(x => x.id === id) : { codigo:'', significado:'', categoria:'', tipo:'Necesario' }
  const cats = [...new Set(state.dic.map(x => x.categoria))].filter(c => c).sort()
  showModal(`
    <h3>${id ? 'Editar' : 'Agregar'} concepto</h3>
    <label>Código</label><input type="text" id="d-codigo" value="${d.codigo}" />
    <label>Significado</label><input type="text" id="d-significado" value="${d.significado}" />
    <label>Categoría</label>
    <select id="d-cat-select">
      <option value="__nueva__">+ Crear nueva...</option>
      ${cats.map(c => `<option value="${c}" ${c===d.categoria?'selected':''}>${c}</option>`).join('')}
    </select>
    <input type="text" id="d-cat-nueva" placeholder="Nueva categoría" style="display:none;margin-top:6px" />
    <label>Tipo</label>
    <select id="d-tipo">
      <option value="Necesario" ${d.tipo==='Necesario'?'selected':''}>Necesario</option>
      <option value="Prescindible" ${d.tipo==='Prescindible'?'selected':''}>Prescindible</option>
      <option value="Ingreso" ${d.tipo==='Ingreso'?'selected':''}>Ingreso</option>
      <option value="Movimiento interno" ${d.tipo==='Movimiento interno'?'selected':''}>Movimiento interno</option>
    </select>
    <div class="modal-actions">
      <button class="btn-small" onclick="closeModal()">Cancelar</button>
      <button class="btn-primary" onclick="guardarDic(${id})">Guardar</button>
    </div>
  `)
  const sel = document.getElementById('d-cat-select')
  const inp = document.getElementById('d-cat-nueva')
  sel.addEventListener('change', () => { inp.style.display = sel.value === '__nueva__' ? 'block' : 'none' })
  if (d.categoria && !cats.includes(d.categoria)) { sel.value = '__nueva__'; inp.style.display = 'block'; inp.value = d.categoria }
}

window.guardarDic = async (id) => {
  const selVal = document.getElementById('d-cat-select').value
  const nuevaVal = document.getElementById('d-cat-nueva').value.trim()
  const cat = selVal === '__nueva__' ? nuevaVal : selVal
  const data = {
    codigo: document.getElementById('d-codigo').value.trim(),
    significado: document.getElementById('d-significado').value.trim(),
    categoria: cat,
    tipo: document.getElementById('d-tipo').value
  }
  if (!data.codigo || !data.categoria) { alert('Código y categoría obligatorios'); return }
  if (id) await sb.from('diccionario').update(data).eq('id', id)
  else await sb.from('diccionario').insert(data)
  closeModal()
  await cargarDatos()
  renderDic()
}

window.eliminarDic = async (id) => {
  if (!confirm('¿Eliminar concepto?')) return
  await sb.from('diccionario').delete().eq('id', id)
  await cargarDatos()
  renderDic()
}

function renderPres() {
  const container = document.getElementById('pres-list')
  if (state.pres.length === 0) { container.innerHTML = '<div class="empty">Sin presupuestos.</div>'; return }
  const mesActual = new Date().toISOString().slice(0,7)
  container.innerHTML = state.pres.map(p => {
    const gastado = state.movs.filter(m => m.categoria === p.categoria && m.fecha.startsWith(mesActual) && m.cargo > 0).reduce((s,m) => s + m.cargo, 0)
    const pct = (gastado / p.limite_mensual * 100).toFixed(0)
    const color = pct >= 100 ? 'var(--danger)' : pct >= p.alerta_porcentaje ? 'var(--warning)' : 'var(--success)'
    return `<div class="pres-row">
      <div><strong>${p.categoria}</strong><div style="font-size:11px;color:var(--text-muted)">${fmt(gastado)} / ${fmt(p.limite_mensual)} · <span style="color:${color}">${pct}%</span></div></div>
      <span style="color:var(--text-dim);font-size:12px">Alerta: ${p.alerta_porcentaje}%</span>
      <button class="btn-small" onclick="editarPres(${p.id})">Editar</button>
      <button class="btn-small btn-danger" onclick="eliminarPres(${p.id})">×</button>
    </div>`
  }).join('')
}

document.getElementById('btn-add-pres').addEventListener('click', () => editarPres(null))

window.editarPres = (id) => {
  const p = id ? state.pres.find(x => x.id === id) : { categoria:'', limite_mensual:0, alerta_porcentaje:80 }
  const cats = [...new Set(state.dic.map(d => d.categoria))].filter(c => c).sort()
  showModal(`
    <h3>${id ? 'Editar' : 'Agregar'} presupuesto</h3>
    <label>Categoría</label>
    <select id="p-cat-select">${cats.map(c => `<option value="${c}" ${c===p.categoria?'selected':''}>${c}</option>`).join('')}</select>
    <label>Límite mensual ($)</label><input type="number" id="p-limite" value="${p.limite_mensual}" />
    <label>Alertarme al alcanzar (%)</label><input type="number" id="p-alerta" value="${p.alerta_porcentaje}" min="1" max="100" />
    <div class="modal-actions">
      <button class="btn-small" onclick="closeModal()">Cancelar</button>
      <button class="btn-primary" onclick="guardarPres(${id})">Guardar</button>
    </div>
  `)
}

window.guardarPres = async (id) => {
  const data = {
    categoria: document.getElementById('p-cat-select').value,
    limite_mensual: parseInt(document.getElementById('p-limite').value),
    alerta_porcentaje: parseInt(document.getElementById('p-alerta').value)
  }
  if (!data.categoria || !data.limite_mensual) { alert('Campos obligatorios'); return }
  if (id) await sb.from('presupuestos').update(data).eq('id', id)
  else await sb.from('presupuestos').insert(data)
  closeModal()
  await cargarDatos()
  renderPres()
}

window.eliminarPres = async (id) => {
  if (!confirm('¿Eliminar presupuesto?')) return
  await sb.from('presupuestos').delete().eq('id', id)
  await cargarDatos()
  renderPres()
}

function showModal(html) {
  document.getElementById('modal-content').innerHTML = html
  document.getElementById('modal-bg').classList.add('show')
}

window.closeModal = () => { document.getElementById('modal-bg').classList.remove('show') }

document.getElementById('modal-bg').addEventListener('click', e => { if (e.target.id === 'modal-bg') closeModal() })

cargarDatos().then(renderInicio)
