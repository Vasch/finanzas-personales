import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://wdwlacdxlvrlthognfzn.supabase.co'
const SUPABASE_KEY = 'sb_publishable_3j__spC7dmwoMYibLZPXPQ_eTm-nC-6'
const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const state = { movs: [], dic: [], pres: [], charts: {} }

const fmt = n => '$' + Math.round(n).toLocaleString('es-CL')
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classLifst.remove('active'))
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active')
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

function clasificar(desc, dic) {
  const descUp = desc.toUpperCase()
  for (const d of dic) {
    if (descUp.includes(d.codigo.toUpperCase())) {
      return { categoria: d.categoria, tipo: d.tipo }
    }
  }
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
      headerIdx = i
      colFecha = fechaIdx
      colDesc = descIdx
      colCargo = cargoIdx
      colAbono = abonoIdx >= 0 ? abonoIdx : cargoIdx + 1
      break
    }
  }
  if (headerIdx === -1) return []
  console.log('Header encontrado en fila:', headerIdx, 'Columnas:', {colFecha, colDesc, colCargo, colAbono})

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
        desc = s
        break
      }
    }
    for (let i = row.length - 1; i >= 0; i--) {
      const n = parseFloat(String(row[i] || '').replace(/[^\d.-]/g,''))
      if (!isNaN(n) && Math.abs(n) >= 100 && Math.abs(n) < 100000000) {
        monto = n
        break
      }
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
    console.log('Hojas encontradas:', wb.SheetNames)
    console.log('Primeras 30 filas:', rows.slice(0, 30))
    console.log('Total filas:', rows.length)

    const formato = detectarFormato(rows)
    if (!formato) {
      statusEl.innerHTML = '<div class="status-msg err">No se pudo detectar el formato. ¿Es una cartola de Banco de Chile?</div>'
      return
    }

    let parsed = formato === 'tc' ? parsearTC(rows) : parsearDebito(rows)
    if (parsed.length === 0) {
      statusEl.innerHTML = '<div class="status-msg err">No se encontraron movimientos en el archivo.</div>'
      return
    }

    await cargarDatos()

const aInsertar = []
    const hashesEnArchivo = new Set()
    let duplicados = 0
    for (const m of parsed) {
      let h = hashMov(m)
      let contador = 1
      while (hashesEnArchivo.has(h)) {
        contador++
        h = hashMov(m) + '_' + contador
      }
      if (state.movs.some(x => x.hash === h)) { duplicados++; continue }
      hashesEnArchivo.add(h)
      const { categoria, tipo } = clasificar(m.descripcion, state.dic)
      const mesNum = m.fecha.slice(5,7)
      const mes = MESES[parseInt(mesNum)-1]
      aInsertar.push({ ...m, hash: h, categoria, tipo, mes })
    }

    if (aInsertar.length > 0) {
      let insertados = 0
      for (const m of aInsertar) {
        const { error } = await sb.from('movimientos').insert(m)
        if (error && error.code === '23505') {
          duplicados++
        } else if (error) {
          throw error
        } else {
          insertados++
        }
      }
      console.log(`Insertados: ${insertados}, Duplicados: ${duplicados}`)
    }

    await sb.from('archivos_subidos').insert({
      nombre: file.name,
      movimientos_agregados: aInsertar.length,
      movimientos_duplicados: duplicados
    })

    statusEl.innerHTML = `<div class="status-msg ok">✓ ${aInsertar.length} movimientos agregados. ${duplicados > 0 ? duplicados + ' duplicados ignorados.' : ''}</div>`

    await cargarDatos()
    renderInicio()
    e.target.value = ''
  } catch (err) {
    statusEl.innerHTML = `<div class="status-msg err">Error: ${err.message}</div>`
  }
})

function renderInicio() {
  const movs = state.movs
  const totalAbonos = movs.reduce((s,m) => s + (m.abono || 0), 0)
  const totalCargos = movs.reduce((s,m) => s + (m.cargo || 0), 0)
  const neto = totalAbonos - totalCargos
  const sinClasificar = movs.filter(m => m.categoria === 'Sin clasificar').length

  document.getElementById('metrics-inicio').innerHTML = `
    <div class="metric"><div class="metric-label">Abonos totales</div><div class="metric-value abono">${fmt(totalAbonos)}</div></div>
    <div class="metric"><div class="metric-label">Cargos totales</div><div class="metric-value cargo">${fmt(totalCargos)}</div></div>
    <div class="metric"><div class="metric-label">Neto</div><div class="metric-value neutral">${fmt(neto)}</div></div>
    <div class="metric"><div class="metric-label">Sin clasificar</div><div class="metric-value neutral">${sinClasificar}</div></div>
  `

  renderChartMensual(movs)
  renderChartCategoria(movs)
}

function renderChartMensual(movs) {
  const byMes = {}
  movs.forEach(m => {
    const key = m.fecha.slice(0,7)
    if (!byMes[key]) byMes[key] = { abonos: 0, cargos: 0 }
    byMes[key].abonos += m.abono || 0
    byMes[key].cargos += m.cargo || 0
  })
  const keys = Object.keys(byMes).sort()
  const labels = keys.map(k => {
    const [y,m] = k.split('-')
    return MESES[parseInt(m)-1] + ' ' + y.slice(2)
  })
  const abonos = keys.map(k => byMes[k].abonos)
  const cargos = keys.map(k => byMes[k].cargos)

  if (state.charts.mensual) state.charts.mensual.destroy()
  state.charts.mensual = new Chart(document.getElementById('chart-mensual'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Abonos', data: abonos, backgroundColor: '#6ee7a8' },
        { label: 'Cargos', data: cargos, backgroundColor: '#f87171' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#a69fbf', font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { ticks: { color: '#a69fbf' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#a69fbf', callback: v => v >= 1000000 ? '$'+(v/1e6).toFixed(1)+'M' : v >= 1000 ? '$'+(v/1000).toFixed(0)+'K' : '$'+v }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  })
}

function renderChartCategoria(movs) {
  const EXCLUIR = new Set(['Pago tarjeta crédito','Traspaso propio','Ingresos','Cashback','Ingreso'])
  const byCat = {}
  movs.forEach(m => {
    if (m.cargo > 0 && m.tipo !== 'Ingreso' && !EXCLUIR.has(m.categoria)) {
      byCat[m.categoria] = (byCat[m.categoria] || 0) + m.cargo
    }
  })
  const sorted = Object.entries(byCat).sort((a,b) => b[1] - a[1]).slice(0, 10)
  const colors = ['#a78bfa','#7dd3fc','#fbbf60','#f87171','#6ee7a8','#f0997b','#d4537e','#5dcaa5','#97c459','#ef9f27']

  if (state.charts.cat) state.charts.cat.destroy()
  state.charts.cat = new Chart(document.getElementById('chart-cat'), {
    type: 'bar',
    data: {
      labels: sorted.map(e => e[0]),
      datasets: [{ label: 'Gasto', data: sorted.map(e => e[1]), backgroundColor: colors }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } }
      },
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
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty">Sin movimientos que coincidan con los filtros.</div>'
    return
  }

  container.innerHTML = filtered.map(m => {
    const monto = m.cargo > 0 ? `-${fmt(m.cargo)}` : `+${fmt(m.abono)}`
    const cls = m.cargo > 0 ? 'cargo' : 'abono'
    const badgeCls = m.tipo === 'Necesario' ? 'nec' : m.tipo === 'Prescindible' ? 'pres' : m.tipo === 'Ingreso' ? 'ing' : 'unc'
    const fechaFmt = m.fecha.slice(8,10) + '/' + m.fecha.slice(5,7)
    return `
      <div class="mov-row" onclick="editarMov(${m.id})">
        <span class="mov-fecha">${fechaFmt}</span>
        <div>
          <div class="mov-desc">${m.descripcion}</div>
          <div class="mov-cat">${m.categoria} · ${m.fuente}</div>
        </div>
        <span class="badge ${badgeCls}">${m.tipo}</span>
        <span class="mov-monto ${cls}">${monto}</span>
      </div>
    `
  }).join('')
}

['f-mes','f-cat','f-tipo','f-texto'].forEach(id => {
  document.getElementById(id).addEventListener('input', aplicarFiltros)
})

window.editarMov = (id) => {
  const m = state.movs.find(x => x.id === id)
  if (!m) return
  const cats = [...new Set(state.movs.map(x => x.categoria).concat(state.dic.map(d => d.categoria)))].sort()
  showModal(`
    <h3>Editar movimiento</h3>
    <p style="font-size:12px;color:var(--text-dim)">${m.descripcion}</p>
    <label>Categoría</label>
    <input type="text" id="m-cat" value="${m.categoria}" list="cats-list" />
    <datalist id="cats-list">${cats.map(c => `<option value="${c}">`).join('')}</datalist>
    <label>Tipo</label>
    <select id="m-tipo">
      <option value="Necesario" ${m.tipo==='Necesario'?'selected':''}>Necesario</option>
      <option value="Prescindible" ${m.tipo==='Prescindible'?'selected':''}>Prescindible</option>
      <option value="Ingreso" ${m.tipo==='Ingreso'?'selected':''}>Ingreso</option>
      <option value="Sin clasificar" ${m.tipo==='Sin clasificar'?'selected':''}>Sin clasificar</option>
    </select>
    <label><input type="checkbox" id="m-add-dic" /> Guardar en diccionario (para futuros movimientos)</label>
    <label>Código a guardar (parte única de la descripción)</label>
    <input type="text" id="m-codigo" value="${m.descripcion.slice(0,40)}" />
    <div class="modal-actions">
      <button class="btn-small" onclick="closeModal()">Cancelar</button>
      <button class="btn-primary" onclick="guardarMov(${id})">Guardar</button>
    </div>
  `)
}

window.guardarMov = async (id) => {
  const cat = document.getElementById('m-cat').value.trim()
  const tipo = document.getElementById('m-tipo').value
  const addDic = document.getElementById('m-add-dic').checked
  const codigo = document.getElementById('m-codigo').value.trim()

  const { data, error } = await sb.from('movimientos').update({ categoria: cat, tipo }).eq('id', Number(id)).select()
  console.log('Update result:', { data, error })
  
  if (error) { alert('Error al guardar: ' + error.message); return }
  if (!data || data.length === 0) { alert('No se actualizó ningún registro. ID: ' + id); return }

  if (addDic && codigo) {
    const { error: dicErr } = await sb.from('diccionario').upsert({ codigo, significado: codigo, categoria: cat, tipo }, { onConflict: 'codigo' })
    if (dicErr) console.error('Error diccionario:', dicErr)
  }

  closeModal()
  await cargarDatos()
  renderMovs()
}

function renderDic() {
  const container = document.getElementById('dic-list')
  if (state.dic.length === 0) {
    container.innerHTML = '<div class="empty">Diccionario vacío. Se llenará automáticamente cuando clasifiques movimientos.</div>'
    return
  }
  container.innerHTML = state.dic.map(d => {
    const badgeCls = d.tipo === 'Necesario' ? 'nec' : d.tipo === 'Prescindible' ? 'pres' : 'ing'
    return `
      <div class="dic-row">
        <span><strong>${d.codigo}</strong></span>
        <span style="color:var(--text-dim);font-size:12px">${d.categoria}</span>
        <span class="badge ${badgeCls}">${d.tipo}</span>
        <button class="btn-small" onclick="editarDic(${d.id})">Editar</button>
        <button class="btn-small btn-danger" onclick="eliminarDic(${d.id})">×</button>
      </div>
    `
  }).join('')
}

document.getElementById('btn-add-dic').addEventListener('click', () => editarDic(null))

window.editarDic = (id) => {
  const d = id ? state.dic.find(x => x.id === id) : { codigo:'', significado:'', categoria:'', tipo:'Necesario' }
  showModal(`
    <h3>${id ? 'Editar' : 'Agregar'} concepto</h3>
    <label>Código (texto que aparece en la cartola)</label>
    <input type="text" id="d-codigo" value="${d.codigo}" />
    <label>Significado real</label>
    <input type="text" id="d-significado" value="${d.significado}" />
    <label>Categoría</label>
    <input type="text" id="d-categoria" value="${d.categoria}" />
    <label>Tipo</label>
    <select id="d-tipo">
      <option value="Necesario" ${d.tipo==='Necesario'?'selected':''}>Necesario</option>
      <option value="Prescindible" ${d.tipo==='Prescindible'?'selected':''}>Prescindible</option>
      <option value="Ingreso" ${d.tipo==='Ingreso'?'selected':''}>Ingreso</option>
    </select>
    <div class="modal-actions">
      <button class="btn-small" onclick="closeModal()">Cancelar</button>
      <button class="btn-primary" onclick="guardarDic(${id})">Guardar</button>
    </div>
  `)
}

window.guardarDic = async (id) => {
  const data = {
    codigo: document.getElementById('d-codigo').value.trim(),
    significado: document.getElementById('d-significado').value.trim(),
    categoria: document.getElementById('d-categoria').value.trim(),
    tipo: document.getElementById('d-tipo').value
  }
  if (!data.codigo || !data.categoria) { alert('Código y categoría son obligatorios'); return }
  if (id) await sb.from('diccionario').update(data).eq('id', id)
  else await sb.from('diccionario').insert(data)
  closeModal()
  await cargarDatos()
  renderDic()
}

window.eliminarDic = async (id) => {
  if (!confirm('¿Eliminar este concepto del diccionario?')) return
  await sb.from('diccionario').delete().eq('id', id)
  await cargarDatos()
  renderDic()
}

function renderPres() {
  const container = document.getElementById('pres-list')
  if (state.pres.length === 0) {
    container.innerHTML = '<div class="empty">Sin presupuestos definidos. Agrega límites mensuales por categoría.</div>'
    return
  }
  const mesActual = new Date().toISOString().slice(0,7)
  container.innerHTML = state.pres.map(p => {
    const gastado = state.movs
      .filter(m => m.categoria === p.categoria && m.fecha.startsWith(mesActual) && m.cargo > 0)
      .reduce((s,m) => s + m.cargo, 0)
    const pct = (gastado / p.limite_mensual * 100).toFixed(0)
    const color = pct >= 100 ? 'var(--danger)' : pct >= p.alerta_porcentaje ? 'var(--warning)' : 'var(--success)'
    return `
      <div class="pres-row">
        <div>
          <strong>${p.categoria}</strong>
          <div style="font-size:11px;color:var(--text-muted)">${fmt(gastado)} / ${fmt(p.limite_mensual)} · <span style="color:${color}">${pct}%</span></div>
        </div>
        <span style="color:var(--text-dim);font-size:12px">Alerta: ${p.alerta_porcentaje}%</span>
        <button class="btn-small" onclick="editarPres(${p.id})">Editar</button>
        <button class="btn-small btn-danger" onclick="eliminarPres(${p.id})">×</button>
      </div>
    `
  }).join('')
}

document.getElementById('btn-add-pres').addEventListener('click', () => editarPres(null))

window.editarPres = (id) => {
  const p = id ? state.pres.find(x => x.id === id) : { categoria:'', limite_mensual:0, alerta_porcentaje:80 }
  const cats = [...new Set(state.dic.map(d => d.categoria))].sort()
  showModal(`
    <h3>${id ? 'Editar' : 'Agregar'} presupuesto</h3>
    <label>Categoría</label>
    <input type="text" id="p-cat" value="${p.categoria}" list="cats-list-p" />
    <datalist id="cats-list-p">${cats.map(c => `<option value="${c}">`).join('')}</datalist>
    <label>Límite mensual ($)</label>
    <input type="number" id="p-limite" value="${p.limite_mensual}" />
    <label>Alertarme al alcanzar (%)</label>
    <input type="number" id="p-alerta" value="${p.alerta_porcentaje}" min="1" max="100" />
    <div class="modal-actions">
      <button class="btn-small" onclick="closeModal()">Cancelar</button>
      <button class="btn-primary" onclick="guardarPres(${id})">Guardar</button>
    </div>
  `)
}

window.guardarPres = async (id) => {
  const data = {
    categoria: document.getElementById('p-cat').value.trim(),
    limite_mensual: parseInt(document.getElementById('p-limite').value),
    alerta_porcentaje: parseInt(document.getElementById('p-alerta').value)
  }
  if (!data.categoria || !data.limite_mensual) { alert('Categoría y límite son obligatorios'); return }
  if (id) await sb.from('presupuestos').update(data).eq('id', id)
  else await sb.from('presupuestos').insert(data)
  closeModal()
  await cargarDatos()
  renderPres()
}

window.eliminarPres = async (id) => {
  if (!confirm('¿Eliminar este presupuesto?')) return
  await sb.from('presupuestos').delete().eq('id', id)
  await cargarDatos()
  renderPres()
}

function showModal(html) {
  document.getElementById('modal-content').innerHTML = html
  document.getElementById('modal-bg').classList.add('show')
}

window.closeModal = () => {
  document.getElementById('modal-bg').classList.remove('show')
}

document.getElementById('modal-bg').addEventListener('click', e => {
  if (e.target.id === 'modal-bg') closeModal()
})

cargarDatos().then(renderInicio)
