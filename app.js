// Fotón · app del invitado
// Se abre desde el QR del evento: /e/<slug-del-evento>

import { createClient } from './vendor/supabase.js';
import { CONFIG } from './config.js';

const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MENSAJES = {
  sesion_invalida: 'Tu sesión se cerró. Volvé a buscarte en la lista.',
  ya_ingresado: 'Ese nombre ya entró desde otro celular. Pedile al anfitrión que te habilite de nuevo.',
  invitado_no_encontrado: 'No encontramos ese nombre en la lista.',
  evento_no_disponible: 'El evento no está abierto en este momento.',
  nombre_en_uso: 'Ya hay alguien con ese nombre en la lista. Buscate ahí.',
  evento_completo: 'El evento llegó al máximo de invitados. Hablá con el anfitrión.',
  invitado_pendiente: 'Todavía no te aprobaron. Esperá un toque.',
  evento_cerrado: 'La fiesta ya cerró: no se pueden subir más fotos ni dar fueguitos.',
  desafio_invalido: 'Ese desafío ya no está disponible.',
  hora_flash_cerrada: 'La Hora Flash ya terminó.',
  archivo_invalido: 'Hubo un problema con el archivo. Probá de nuevo.',
  archivo_repetido: 'Ese archivo ya se subió.',
  cupo_completo: 'Ya usaste todo tu cupo para este tipo de publicación.',
  desafio_ya_cumplido: 'Ya cumpliste este desafío.',
  publicacion_invalida: 'Esa publicación ya no está.',
  fueguito_propio: 'No te podés dar fueguitos a vos.',
  tipo_no_permitido: 'Ese formato de archivo no está permitido.',
  sin_almacenamiento: 'Todavía falta configurar dónde se guardan las fotos.',
  sin_conexion: 'Se cortó la conexión. Probá de nuevo.',
  error_subida: 'No se pudo subir el archivo. Probá de nuevo.',
  formato_foto: 'No pudimos leer esa foto. Probá con otra.',
  formato_video: 'No pudimos leer ese video. Probá con otro.',
  video_largo: `El video tiene que durar hasta ${CONFIG.maxSegundosVideo} segundos.`,
  video_pesado: `El video es muy pesado (máximo ${CONFIG.maxMbVideo} MB).`,
};

const ICONOS = {
  camara: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  video: '<path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  fuego: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  play: '<polygon points="7 4 20 12 7 20 7 4"/>',
  candado: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};

const estado = {
  slug: '',
  evento: null,
  token: null,
  yo: null,
  desafios: [],
  cumplidos: new Set(),
  misFueguitos: new Set(),
  cupos: { fotos: 0, max_fotos: 0, videos: 0, max_videos: 0 },
  flash: { activa: false, termina: null, multiplicador: 2 },
  galeria: new Map(),
  canal: null,
  timers: [],
  soloLectura: false,
  visorId: null,
};

// ---------------------------------------------------------------- utilidades

const $ = (selector) => document.querySelector(selector);

function el(tag, props = {}, ...hijos) {
  const nodo = document.createElement(tag);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'class') nodo.className = valor;
    else if (clave === 'text') nodo.textContent = valor;
    else if (clave === 'dataset') Object.assign(nodo.dataset, valor);
    else if (clave.startsWith('on') && typeof valor === 'function') nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

function icono(nombre, tam = 16, lleno = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', tam);
  svg.setAttribute('height', tam);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', lleno ? 'icono lleno' : 'icono');
  svg.innerHTML = ICONOS[nombre];
  return svg;
}

function codigoDe(err) {
  if (typeof err === 'string') return err;
  return err?.message || err?.error || '';
}

function mensaje(err) {
  const codigo = codigoDe(err);
  if (MENSAJES[codigo]) return MENSAJES[codigo];
  if (codigo.includes('invitados_instagram_check')) return 'Revisá tu @: solo letras, números, puntos y guiones bajos.';
  if (codigo.includes('invitados_nombre_check')) return 'Escribí un nombre de entre 2 y 80 letras.';
  if (/fetch|network|Failed/i.test(codigo)) return MENSAJES.sin_conexion;
  return 'Algo salió mal. Probá de nuevo en un ratito.';
}

let avisoTimer;
function avisar(texto, tipo = 'info') {
  const aviso = $('#aviso');
  aviso.textContent = texto;
  aviso.dataset.tipo = tipo;
  aviso.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { aviso.hidden = true; }, 4000);
}

function mostrar(vista) {
  document.querySelectorAll('.vista').forEach((v) => { v.hidden = v.id !== `v-${vista}`; });
  window.scrollTo(0, 0);
}

function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}

const primerNombre = (nombre) => (nombre || '').trim().split(/\s+/)[0];
const urlMedia = (key) => `${CONFIG.mediaUrl}/${key}`;
const keyMiniatura = (key) => key.replace(/\.[^./]+$/, '_t.jpg');

async function rpc(nombre, args) {
  const { data, error } = await sb.rpc(nombre, args);
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- sesión

const claveToken = () => `foton:${estado.slug}`;

function guardarToken(token) {
  estado.token = token;
  try { localStorage.setItem(claveToken(), token); } catch { /* modo privado */ }
}

function leerToken() {
  try { return localStorage.getItem(claveToken()); } catch { return null; }
}

function borrarToken() {
  estado.token = null;
  try { localStorage.removeItem(claveToken()); } catch { /* nada */ }
}

function detenerTodo() {
  estado.timers.forEach((t) => clearInterval(t));
  estado.timers = [];
  if (estado.canal) {
    sb.removeChannel(estado.canal);
    estado.canal = null;
  }
}

function salir(texto) {
  detenerTodo();
  borrarToken();
  estado.yo = null;
  $('#pill-en-vivo').hidden = true;
  $('#buscar').value = '';
  $('#resultados').replaceChildren();
  mostrar('entrar');
  if (texto) avisar(texto, 'error');
}

async function cargarMiEstado() {
  const datos = await rpc('mi_estado', { p_token: estado.token });
  const flashAntes = estado.flash.activa;
  estado.yo = datos.invitado;
  estado.evento.estado = datos.evento.estado;
  estado.flash = datos.hora_flash;
  estado.cupos = datos.cupos;
  estado.cumplidos = new Set(datos.desafios_cumplidos);
  estado.misFueguitos = new Set(datos.mis_fueguitos);
  return flashAntes !== estado.flash.activa;
}

// ---------------------------------------------------------------- inicio

async function iniciar() {
  const partes = location.pathname.split('/').filter(Boolean);
  estado.slug = partes[0] === 'e' && partes[1]
    ? decodeURIComponent(partes[1]).toLowerCase()
    : (new URLSearchParams(location.search).get('e') || '').toLowerCase();
  if (!estado.slug) return mostrar('no-disponible');

  const { data: evento, error } = await sb
    .from('eventos')
    .select('id, slug, nombre, tipo, estado, max_fotos, max_videos, flash_inicio, flash_minutos, flash_multiplicador, galeria_vence_el')
    .eq('slug', estado.slug)
    .maybeSingle();
  if (error) return mostrarError(error);
  if (!evento) return mostrar('no-disponible');

  estado.evento = evento;
  document.title = `${evento.nombre} · Fotón`;
  document.querySelectorAll('[data-evento-nombre]').forEach((n) => { n.textContent = evento.nombre; });

  if (evento.estado === 'cerrado') return abrirSoloLectura();

  estado.token = leerToken();
  if (!estado.token) return mostrar('entrar');

  try {
    await cargarMiEstado();
  } catch (e) {
    if (codigoDe(e) === 'sesion_invalida') {
      borrarToken();
      return mostrar('entrar');
    }
    return mostrarError(e);
  }
  if (!estado.yo.aprobado) return esperarAprobacion();
  return abrirPrincipal();
}

function mostrarError(e) {
  $('#error-detalle').textContent = mensaje(e);
  mostrar('error');
}

// ---------------------------------------------------------------- entrar

let buscarTimer;
let numeroBusqueda = 0;

function alEscribir(ev) {
  clearTimeout(buscarTimer);
  const texto = ev.target.value.trim();
  if (texto.length < 2) {
    numeroBusqueda++;
    $('#resultados').replaceChildren();
    return;
  }
  buscarTimer = setTimeout(() => buscar(texto), 250);
}

async function buscar(texto) {
  const numero = ++numeroBusqueda;
  let lista;
  try {
    lista = await rpc('buscar_invitados', { p_slug: estado.slug, p_texto: texto });
  } catch (e) {
    avisar(mensaje(e), 'error');
    return;
  }
  if (numero !== numeroBusqueda) return; // ya hay una búsqueda más nueva

  const ul = $('#resultados');
  if (!lista.length) {
    ul.replaceChildren(el('li', { class: 'sin-resultados', text: 'No aparece. Probá con otra parte de tu nombre o pedí que te sumen.' }));
    return;
  }
  ul.replaceChildren(...lista.map((inv) => el('li', {},
    el('button', { type: 'button', class: 'resultado', onclick: () => entrar(inv) },
      el('span', { class: 'resultado-nombre', text: inv.nombre }),
      el('span', { class: 'resultado-nota', text: inv.ya_ingreso ? 'Ya entró' : 'Soy yo' })))));
}

async function entrar(inv) {
  if (inv.ya_ingreso) return avisar(MENSAJES.ya_ingresado, 'error');
  try {
    const token = await rpc('entrar_evento', { p_slug: estado.slug, p_invitado_id: inv.id });
    guardarToken(token);
    await cargarMiEstado();
    await abrirPrincipal();
  } catch (e) {
    avisar(mensaje(e), 'error');
  }
}

async function pedirAcceso(ev) {
  ev.preventDefault();
  const nombre = $('#pedir-nombre').value.trim();
  const instagram = $('#pedir-instagram').value.trim().replace(/^@/, '');
  if (nombre.length < 2) return avisar('Escribí tu nombre y apellido.', 'error');

  const boton = $('#form-pedir button[type="submit"]');
  boton.disabled = true;
  try {
    const token = await rpc('pedir_acceso', { p_slug: estado.slug, p_nombre: nombre, p_instagram: instagram || null });
    guardarToken(token);
    await cargarMiEstado();
    esperarAprobacion();
  } catch (e) {
    avisar(mensaje(e), 'error');
  } finally {
    boton.disabled = false;
  }
}

function esperarAprobacion() {
  $('#esperando-nombre').textContent = estado.yo.nombre;
  mostrar('esperando');
  const timer = setInterval(async () => {
    try {
      await cargarMiEstado();
      if (estado.yo.aprobado) {
        clearInterval(timer);
        await abrirPrincipal();
      }
    } catch (e) {
      if (codigoDe(e) === 'sesion_invalida') {
        clearInterval(timer);
        salir('Tu pedido no fue aprobado. Si es un error, hablá con el anfitrión.');
      }
    }
  }, 5000);
  estado.timers.push(timer);
}

// ---------------------------------------------------------------- pantalla principal

async function abrirPrincipal() {
  detenerTodo();
  mostrar('principal');
  $('#pill-en-vivo').hidden = false;
  $('#tab-desafios').hidden = false;
  $('#saludo').textContent = `Hola, ${primerNombre(estado.yo.nombre)}. Elegí un desafío y subí tu fotón.`;
  try {
    await Promise.all([cargarDesafios(), cargarGaleria()]);
  } catch (e) {
    return mostrarError(e);
  }
  pintarTodo();
  cambiarPestana('desafios');
  conectarTiempoReal();
  estado.timers.push(setInterval(refrescoPeriodico, 20000));
  estado.timers.push(setInterval(pintarFlash, 1000));
  estado.timers.push(setInterval(sincronizarGaleria, 60000));
}

async function abrirSoloLectura() {
  estado.soloLectura = true;
  mostrar('principal');
  $('#tab-desafios').hidden = true;
  $('#saludo').textContent = 'La fiesta terminó. Acá quedan todas las fotos y el podio final.';
  try {
    await cargarGaleria();
  } catch (e) {
    return mostrarError(e);
  }
  pintarGaleria();
  pintarPodio();
  cambiarPestana('galeria');
}

async function cargarDesafios() {
  const { data, error } = await sb
    .from('desafios')
    .select('id, titulo, tipo, puntos, solo_flash, orden')
    .eq('evento_id', estado.evento.id)
    .order('solo_flash', { ascending: false })
    .order('orden');
  if (error) throw error;
  estado.desafios = data;
}

async function cargarGaleria() {
  const { data, error } = await sb
    .from('v_galeria')
    .select('*')
    .eq('evento_id', estado.evento.id)
    .order('creado_el', { ascending: false });
  if (error) throw error;
  estado.galeria = new Map(data.map((p) => [p.id, p]));
}

function cambiarPestana(nombre) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === nombre)));
  for (const id of ['desafios', 'galeria', 'podio']) $(`#p-${id}`).hidden = id !== nombre;
}

function pintarTodo() {
  pintarCupos();
  pintarDesafios();
  pintarGaleria();
  pintarPodio();
  pintarFlash();
}

// ---------------------------------------------------------------- desafíos

function cupoLleno(tipo) {
  const c = estado.cupos;
  return tipo === 'foto' ? c.fotos >= c.max_fotos : c.videos >= c.max_videos;
}

function pintarCupos() {
  const c = estado.cupos;
  const fotos = Math.max(0, c.max_fotos - c.fotos);
  const videos = Math.max(0, c.max_videos - c.videos);
  $('#cupos').textContent = `Te quedan ${plural(fotos, 'foto', 'fotos')} y ${plural(videos, 'video', 'videos')}.`;
}

function pintarDesafios() {
  const abierto = estado.evento.estado === 'en_vivo';
  const mult = estado.flash.activa ? estado.flash.multiplicador : 1;

  const items = estado.desafios.map((d) => {
    const hecho = estado.cumplidos.has(d.id);
    const flashCerrado = d.solo_flash && !estado.flash.activa;
    const sinCupo = !hecho && cupoLleno(d.tipo);
    const bloqueado = !hecho && (flashCerrado || sinCupo || !abierto);

    let accion;
    if (hecho) accion = [icono('check', 15), 'Cumplido'];
    else if (!abierto) accion = ['Evento cerrado'];
    else if (flashCerrado) accion = ['Terminó la Hora Flash'];
    else if (sinCupo) accion = [`Sin cupo de ${d.tipo === 'foto' ? 'fotos' : 'videos'}`];
    else accion = [icono(d.tipo === 'foto' ? 'camara' : 'video', 15), d.tipo === 'foto' ? 'Sacar foto' : 'Grabar video'];

    const clases = ['desafio', hecho && 'hecho', bloqueado && 'bloqueado', d.solo_flash && 'flash'].filter(Boolean).join(' ');
    return el('li', { class: clases },
      el('button', { type: 'button', class: 'desafio-btn', disabled: hecho || bloqueado, onclick: () => subir(d) },
        el('span', { class: 'desafio-meta' },
          icono(d.tipo === 'foto' ? 'camara' : 'video', 14),
          d.tipo === 'foto' ? 'FOTO' : 'VIDEO',
          d.solo_flash ? el('span', { class: 'chip-flash', text: 'HORA FLASH' }) : null),
        el('span', { class: 'desafio-titulo', text: d.titulo }),
        el('span', { class: 'desafio-pie' },
          el('span', { class: 'puntos', text: `+${d.puntos * mult} pts` }),
          el('span', { class: 'desafio-accion' }, ...accion))));
  });

  $('#lista-desafios').replaceChildren(...items);
}

function pintarFlash() {
  const banner = $('#banner-flash');
  const fin = estado.flash.termina ? new Date(estado.flash.termina).getTime() : 0;
  const resta = fin - Date.now();

  if (estado.flash.activa && resta > 0) {
    const s = Math.ceil(resta / 1000);
    $('#flash-cuenta').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    $('#flash-mult').textContent = `x${estado.flash.multiplicador}`;
    banner.hidden = false;
    return;
  }
  banner.hidden = true;
  if (estado.flash.activa) {
    estado.flash.activa = false;
    pintarDesafios();
  }
}

// ---------------------------------------------------------------- subir fotos y videos

function elegirArchivo(tipo) {
  return new Promise((resolve) => {
    const input = $('#archivo');
    input.value = '';
    input.accept = tipo === 'foto' ? 'image/*' : 'video/*';
    input.onchange = () => resolve(input.files[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function subir(desafio) {
  if (!CONFIG.mediaUrl) return avisar(MENSAJES.sin_almacenamiento, 'error');

  const archivo = await elegirArchivo(desafio.tipo);
  if (!archivo) return;

  mostrarSubida('Preparando…', 0);
  try {
    let principal;
    let tipoMime;
    let miniatura = null;
    let ancho = null;
    let alto = null;
    let duracion = null;

    if (desafio.tipo === 'foto') {
      const imagen = await decodificar(archivo);
      const grande = await reducir(imagen, 2000, 0.82);
      principal = grande.blob;
      ancho = grande.ancho;
      alto = grande.alto;
      tipoMime = 'image/jpeg';
      miniatura = (await reducir(imagen, 640, 0.75)).blob;
    } else {
      tipoMime = tipoVideo(archivo);
      if (!tipoMime) throw 'tipo_no_permitido';
      if (archivo.size > CONFIG.maxMbVideo * 1024 * 1024) throw 'video_pesado';
      const info = await leerVideo(archivo);
      if (info.duracion > CONFIG.maxSegundosVideo + 0.5) throw 'video_largo';
      principal = archivo;
      ancho = info.ancho;
      alto = info.alto;
      duracion = info.duracion ? Math.round(info.duracion * 10) / 10 : null;
      miniatura = info.poster;
    }

    mostrarSubida('Subiendo…', 0);
    const firma = await pedirFirma(desafio.id, tipoMime);
    await enviar(firma.url, principal, tipoMime, (pct) => mostrarSubida('Subiendo…', pct));
    if (miniatura) {
      try { await enviar(firma.url_miniatura, miniatura, 'image/jpeg'); } catch { /* sin miniatura se usa la original */ }
    }

    mostrarSubida('¡Casi!', 100);
    const id = await rpc('crear_publicacion', {
      p_token: estado.token,
      p_desafio_id: desafio.id,
      p_storage_key: firma.key,
      p_ancho: ancho,
      p_alto: alto,
      p_duracion_seg: duracion,
    });

    await cargarMiEstado();
    await traerPublicacion(id);
    pintarCupos();
    pintarDesafios();
    ocultarSubida();

    const publicacion = estado.galeria.get(id);
    avisar(publicacion ? `¡Listo! Sumaste ${publicacion.puntos} puntos.` : '¡Listo! Ya está en la galería.', 'ok');
    cambiarPestana('galeria');
  } catch (e) {
    ocultarSubida();
    if (codigoDe(e) === 'sesion_invalida') return salir(MENSAJES.sesion_invalida);
    avisar(mensaje(e), 'error');
  }
}

function mostrarSubida(texto, porcentaje) {
  $('#subiendo-texto').textContent = porcentaje > 0 && porcentaje < 100 ? `${texto} ${porcentaje}%` : texto;
  $('#subiendo-barra').style.width = `${porcentaje}%`;
  $('#subiendo').hidden = false;
}

function ocultarSubida() {
  $('#subiendo').hidden = true;
}

function tipoVideo(archivo) {
  const permitidos = ['video/mp4', 'video/quicktime', 'video/webm'];
  if (permitidos.includes(archivo.type)) return archivo.type;
  if (/\.mov$/i.test(archivo.name)) return 'video/quicktime';
  if (/\.mp4$/i.test(archivo.name)) return 'video/mp4';
  if (/\.webm$/i.test(archivo.name)) return 'video/webm';
  return null;
}

async function decodificar(archivo) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    } catch { /* probamos con <img> */ }
  }
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); mal('formato_foto'); };
    img.src = url;
  });
}

async function reducir(imagen, maximo, calidad) {
  const anchoOriginal = imagen.naturalWidth || imagen.width;
  const altoOriginal = imagen.naturalHeight || imagen.height;
  const escala = Math.min(1, maximo / Math.max(anchoOriginal, altoOriginal));
  const ancho = Math.max(1, Math.round(anchoOriginal * escala));
  const alto = Math.max(1, Math.round(altoOriginal * escala));
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  lienzo.getContext('2d').drawImage(imagen, 0, 0, ancho, alto);
  const blob = await new Promise((ok) => lienzo.toBlob(ok, 'image/jpeg', calidad));
  if (!blob) throw 'formato_foto';
  return { blob, ancho, alto };
}

function leerVideo(archivo) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const video = document.createElement('video');
    let terminado = false;

    const terminar = (poster) => {
      if (terminado) return;
      terminado = true;
      URL.revokeObjectURL(url);
      ok({
        duracion: Number.isFinite(video.duration) ? video.duration : 0,
        ancho: video.videoWidth || null,
        alto: video.videoHeight || null,
        poster,
      });
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const momento = Number.isFinite(video.duration) ? Math.min(0.5, video.duration / 2) : 0.1;
      try { video.currentTime = momento; } catch { terminar(null); }
    };
    video.onseeked = async () => {
      try {
        const escala = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.round(video.videoWidth * escala);
        lienzo.height = Math.round(video.videoHeight * escala);
        lienzo.getContext('2d').drawImage(video, 0, 0, lienzo.width, lienzo.height);
        const blob = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', 0.75));
        terminar(blob);
      } catch {
        terminar(null);
      }
    };
    video.onerror = () => {
      if (terminado) return;
      terminado = true;
      URL.revokeObjectURL(url);
      mal('formato_video');
    };
    setTimeout(() => terminar(null), 8000);
    video.src = url;
  });
}

async function pedirFirma(desafioId, tipoMime) {
  let respuesta;
  try {
    respuesta = await fetch(`${CONFIG.supabaseUrl}/functions/v1/firmar-subida`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CONFIG.supabaseKey,
        Authorization: `Bearer ${CONFIG.supabaseKey}`,
      },
      body: JSON.stringify({ token: estado.token, desafio_id: desafioId, content_type: tipoMime }),
    });
  } catch {
    throw 'sin_conexion';
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw datos.error || 'error_subida';
  return datos;
}

function enviar(url, cuerpo, tipoMime, alProgresar) {
  return new Promise((ok, mal) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', tipoMime);
    if (alProgresar) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) alProgresar(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? ok() : mal('error_subida'));
    xhr.onerror = () => mal('sin_conexion');
    xhr.send(cuerpo);
  });
}

// ---------------------------------------------------------------- galería

function pintarGaleria() {
  const lista = [...estado.galeria.values()];
  $('#galeria-vacia').hidden = lista.length > 0;
  $('#grilla').replaceChildren(...lista.map(tarjeta));
}

function imagenTarjeta(p) {
  if (!CONFIG.mediaUrl) return null;
  return el('img', {
    src: urlMedia(keyMiniatura(p.storage_key)),
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    onerror: (ev) => {
      const img = ev.currentTarget;
      if (p.tipo === 'foto' && !img.dataset.original) {
        img.dataset.original = '1';
        img.src = urlMedia(p.storage_key);
      } else {
        img.remove();
      }
    },
  });
}

function tarjeta(p) {
  const autor = p.instagram ? `@${p.instagram}` : p.autor;
  return el('li', { class: 'tarjeta', dataset: { id: p.id } },
    el('button', { type: 'button', class: 'tarjeta-foto', 'aria-label': `Ver ${p.tipo} de ${p.autor}: ${p.desafio}`, onclick: () => abrirVisor(p.id) },
      imagenTarjeta(p),
      p.tipo === 'video' ? el('span', { class: 'marca-video' }, icono('play', 12, true)) : null,
      el('span', { class: 'chip-puntos', text: `+${p.puntos}` })),
    el('p', { class: 'tarjeta-desafio', text: p.desafio }),
    el('div', { class: 'tarjeta-pie' },
      el('span', { class: 'tarjeta-autor', text: autor }),
      botonFueguito(p)));
}

function botonFueguito(p, grande = false) {
  const mia = Boolean(estado.yo) && p.invitado_id === estado.yo.id;
  const dado = estado.misFueguitos.has(p.id);
  const puedeDar = Boolean(estado.yo) && !mia && !estado.soloLectura && estado.evento.estado === 'en_vivo';
  let etiqueta;
  if (mia) etiqueta = `Tu publicación tiene ${plural(p.fueguitos, 'fueguito', 'fueguitos')}`;
  else if (!puedeDar) etiqueta = plural(p.fueguitos, 'fueguito', 'fueguitos');
  else etiqueta = dado ? 'Sacar fueguito' : 'Dar fueguito';

  return el('button', {
    type: 'button',
    class: `fueguito${dado ? ' dado' : ''}${grande ? ' grande' : ''}`,
    disabled: !puedeDar,
    'aria-pressed': puedeDar ? String(dado) : null,
    'aria-label': etiqueta,
    onclick: (ev) => { ev.stopPropagation(); alternarFueguito(p.id); },
  }, icono('fuego', grande ? 18 : 15), el('span', { text: String(p.fueguitos) }));
}

function actualizarTarjeta(id) {
  const p = estado.galeria.get(id);
  const vieja = document.querySelector(`.tarjeta[data-id="${id}"]`);
  if (p && vieja) vieja.replaceWith(tarjeta(p));
  if (p && estado.visorId === id) $('#visor-fueguito').replaceChildren(botonFueguito(p, true));
}

const fueguitosEnCurso = new Set();

async function alternarFueguito(id) {
  if (fueguitosEnCurso.has(id) || !estado.galeria.has(id)) return;
  fueguitosEnCurso.add(id);
  const antes = estado.misFueguitos.has(id);
  aplicarFueguito(id, !antes);
  try {
    const dado = await rpc('dar_fueguito', { p_token: estado.token, p_publicacion_id: id });
    if (dado !== !antes) aplicarFueguito(id, dado);
  } catch (e) {
    aplicarFueguito(id, antes);
    if (codigoDe(e) === 'sesion_invalida') salir(MENSAJES.sesion_invalida);
    else avisar(mensaje(e), 'error');
  } finally {
    fueguitosEnCurso.delete(id);
  }
}

function aplicarFueguito(id, dado) {
  const p = estado.galeria.get(id);
  if (!p || estado.misFueguitos.has(id) === dado) return;
  if (dado) {
    estado.misFueguitos.add(id);
    p.fueguitos += 1;
  } else {
    estado.misFueguitos.delete(id);
    p.fueguitos = Math.max(0, p.fueguitos - 1);
  }
  actualizarTarjeta(id);
  pintarPodio();
}

function abrirVisor(id) {
  const p = estado.galeria.get(id);
  if (!p) return;
  estado.visorId = id;
  const media = $('#visor-media');
  if (!CONFIG.mediaUrl) {
    media.replaceChildren();
  } else if (p.tipo === 'video') {
    media.replaceChildren(el('video', {
      src: urlMedia(p.storage_key), poster: urlMedia(keyMiniatura(p.storage_key)),
      controls: true, playsinline: true, autoplay: true, preload: 'metadata',
    }));
  } else {
    media.replaceChildren(el('img', { src: urlMedia(p.storage_key), alt: `${p.desafio}, foto de ${p.autor}` }));
  }
  $('#visor-desafio').textContent = p.desafio;
  $('#visor-autor').textContent = `${p.autor}${p.instagram ? ` · @${p.instagram}` : ''} · +${p.puntos} pts${p.multiplicador > 1 ? ` (Hora Flash x${p.multiplicador})` : ''}`;
  $('#visor-fueguito').replaceChildren(botonFueguito(p, true));
  $('#visor').showModal();
}

function cerrarVisor() {
  estado.visorId = null;
  $('#visor-media').replaceChildren();
  if ($('#visor').open) $('#visor').close();
}

// ---------------------------------------------------------------- podio

function pintarPodio() {
  const porInvitado = new Map();
  for (const p of estado.galeria.values()) {
    const fila = porInvitado.get(p.invitado_id) || { id: p.invitado_id, nombre: p.autor, instagram: p.instagram, total: 0, publicaciones: 0 };
    fila.total += p.puntos + p.fueguitos;
    fila.publicaciones += 1;
    porInvitado.set(p.invitado_id, fila);
  }
  const ranking = [...porInvitado.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
  const ol = $('#lista-podio');
  if (!ranking.length) {
    ol.replaceChildren(el('li', { class: 'vacio', text: 'El podio arranca con la primera foto.' }));
    return;
  }

  let puesto = 0;
  let anterior = null;
  ol.replaceChildren(...ranking.map((r, i) => {
    if (r.total !== anterior) {
      puesto = i + 1;
      anterior = r.total;
    }
    const soyYo = Boolean(estado.yo) && r.id === estado.yo.id;
    const clases = ['fila-podio', puesto <= 3 && 'top', soyYo && 'yo'].filter(Boolean).join(' ');
    return el('li', { class: clases },
      el('span', { class: 'puesto', text: String(puesto) }),
      el('span', { class: 'quien' },
        el('span', { class: 'quien-nombre', text: soyYo ? `${r.nombre} (vos)` : r.nombre }),
        el('span', { class: 'quien-detalle', text: `${plural(r.publicaciones, 'publicación', 'publicaciones')}${r.instagram ? ` · @${r.instagram}` : ''}` })),
      el('span', { class: 'total', text: `${r.total} pts` }));
  }));
}

// ---------------------------------------------------------------- tiempo real y refrescos

function conectarTiempoReal() {
  if (estado.canal) return;
  estado.canal = sb
    .channel(`evento-${estado.evento.id}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'publicaciones', filter: `evento_id=eq.${estado.evento.id}` },
      (msg) => traerPublicacion(msg.new.id))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fueguitos' }, (msg) => fueguitoDeOtro(msg.new, 1))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'fueguitos' }, (msg) => fueguitoDeOtro(msg.old, -1))
    .subscribe();
}

function fueguitoDeOtro(fila, cambio) {
  if (!fila || !estado.galeria.has(fila.publicacion_id)) return;
  if (estado.yo && fila.invitado_id === estado.yo.id) return; // los propios ya se aplicaron
  const p = estado.galeria.get(fila.publicacion_id);
  p.fueguitos = Math.max(0, p.fueguitos + cambio);
  actualizarTarjeta(p.id);
  pintarPodio();
}

async function traerPublicacion(id) {
  if (!id || estado.galeria.has(id)) return;
  const { data } = await sb.from('v_galeria').select('*').eq('id', id).maybeSingle();
  if (!data || estado.galeria.has(id)) return;
  estado.galeria = new Map([[data.id, data], ...estado.galeria]);
  pintarGaleria();
  pintarPodio();
}

async function refrescoPeriodico() {
  try {
    const cambioFlash = await cargarMiEstado();
    if (cambioFlash) await cargarDesafios();
    pintarCupos();
    pintarDesafios();
    pintarFlash();
    if (estado.evento.estado !== 'en_vivo') {
      $('#pill-en-vivo').hidden = true;
      $('#saludo').textContent = 'La fiesta terminó. Gracias por sumar tus fotones.';
      pintarGaleria();
    }
  } catch (e) {
    if (codigoDe(e) === 'sesion_invalida') salir(MENSAJES.sesion_invalida);
  }
}

async function sincronizarGaleria() {
  const { data, error } = await sb.from('publicaciones').select('id').eq('evento_id', estado.evento.id);
  if (error || !data) return;
  const visibles = new Set(data.map((fila) => fila.id));
  let cambio = false;

  for (const id of [...estado.galeria.keys()]) {
    if (!visibles.has(id)) {
      estado.galeria.delete(id);
      cambio = true;
    }
  }

  const faltan = [...visibles].filter((id) => !estado.galeria.has(id));
  if (faltan.length) {
    const { data: nuevas } = await sb.from('v_galeria').select('*').in('id', faltan);
    for (const p of nuevas || []) estado.galeria.set(p.id, p);
    const ordenadas = [...estado.galeria.values()].sort((a, b) => b.creado_el.localeCompare(a.creado_el));
    estado.galeria = new Map(ordenadas.map((p) => [p.id, p]));
    cambio = true;
  }

  if (cambio) {
    pintarGaleria();
    pintarPodio();
  }
}

// ---------------------------------------------------------------- eventos de la página

$('#buscar').addEventListener('input', alEscribir);
$('#btn-no-estoy').addEventListener('click', () => {
  mostrar('pedir');
  $('#pedir-nombre').value = $('#buscar').value.trim();
  $('#pedir-nombre').focus();
});
$('#btn-volver').addEventListener('click', () => mostrar('entrar'));
$('#form-pedir').addEventListener('submit', pedirAcceso);
$('#btn-reintentar').addEventListener('click', () => location.reload());
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => cambiarPestana(b.dataset.tab)));
$('#visor-cerrar').addEventListener('click', cerrarVisor);
$('#visor').addEventListener('close', () => { estado.visorId = null; $('#visor-media').replaceChildren(); });
$('#visor').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) cerrarVisor(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && estado.yo && !estado.soloLectura) {
    refrescoPeriodico();
    sincronizarGaleria();
  }
});

iniciar().catch(mostrarError);
