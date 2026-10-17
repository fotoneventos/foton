-- =====================================================================
--  Fotón · Base de datos para Supabase
-- ---------------------------------------------------------------------
--  Al crear el proyecto, en Security: dejá tildado "Enable Data API",
--  destildá "Automatically expose new tables" y tildá "Enable automatic RLS".
--  Este archivo da los permisos justos que necesita la app.
--
--  Cómo usarlo: Supabase → SQL Editor → New query → pegá todo → Run.
--  Correlo una sola vez, en un proyecto nuevo. Si algo falla, no queda
--  nada a medias (todo va dentro de una transacción).
--
--  Qué crea:
--   · Tablas: planes, eventos, desafíos, invitados, sesiones,
--     publicaciones (fotos y videos) y fueguitos.
--   · Seguridad (RLS): los invitados solo leen lo visible de eventos
--     abiertos y escriben únicamente a través de las funciones de abajo.
--   · Funciones para la app del invitado: buscar_invitados, entrar_evento,
--     pedir_acceso, mi_estado, crear_publicacion, dar_fueguito.
--   · Funciones para vos: cargar_desafios_sugeridos, largar_hora_flash,
--     cerrar_evento, habilitar_reingreso.
--   · Vistas: v_galeria, v_podio, v_exportacion, v_eventos_vencidos.
--   · Los desafíos de ejemplo de la landing, como plantillas.
--
--  Las fotos y videos van a Cloudflare R2, no a Supabase. Cada
--  publicación guarda la ruta del archivo en storage_key con este formato:
--      eventos/<evento_id>/<invitado_id>/<archivo>
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Esquema privado: funciones internas que no quedan expuestas en la API
-- ---------------------------------------------------------------------
create schema if not exists privado;
grant usage on schema privado to anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 2. Tipos
-- ---------------------------------------------------------------------
create type public.tipo_evento as enum ('casamiento', 'quince', 'cumple', 'egresados', 'empresa');
create type public.tono_evento as enum ('familia', 'fiesta', 'colegio', 'oficina');
create type public.estado_evento as enum ('borrador', 'en_vivo', 'cerrado');
create type public.tipo_media as enum ('foto', 'video');
create type public.estado_publicacion as enum ('visible', 'oculta');


-- ---------------------------------------------------------------------
-- 3. Tablas
-- ---------------------------------------------------------------------

-- Quiénes manejan el panel (vos). Al final del archivo está cómo sumarte.
create table public.admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  creado_el timestamptz not null default now()
);

create table public.planes (
  codigo        text primary key,
  nombre        text not null,
  max_invitados int  not null check (max_invitados > 0),
  dias_galeria  int  not null check (dias_galeria > 0),
  precio_usd    numeric(10, 2)
);

create table public.eventos (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),  -- va en el link del QR
  nombre              text not null,
  tipo                public.tipo_evento not null,
  tono                public.tono_evento,                    -- vacío = se completa según el tipo
  plan                text not null references public.planes (codigo),
  fecha               date,
  estado              public.estado_evento not null default 'borrador',
  max_invitados       int check (max_invitados > 0),         -- vacío = el máximo del plan
  max_fotos           int not null default 10 check (max_fotos >= 0),   -- cupo por invitado
  max_videos          int not null default 2  check (max_videos >= 0),
  flash_minutos       int not null default 15 check (flash_minutos between 1 and 120),
  flash_multiplicador int not null default 2  check (flash_multiplicador between 1 and 5),
  flash_inicio        timestamptz,                           -- se completa al largar la Hora Flash
  galeria_vence_el    timestamptz,                           -- se completa al cerrar el evento
  creado_el           timestamptz not null default now()
);

create table public.plantillas_desafios (
  id          bigint generated always as identity primary key,
  tipo_evento public.tipo_evento,                            -- vacío = sirve para cualquier evento
  titulo      text not null,
  tipo        public.tipo_media not null default 'foto',
  puntos      int  not null check (puntos > 0),
  solo_flash  boolean not null default false,
  orden       int  not null default 0
);

create table public.desafios (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos (id) on delete cascade,
  titulo     text not null,
  tipo       public.tipo_media not null default 'foto',
  puntos     int  not null check (puntos > 0),
  solo_flash boolean not null default false,                 -- aparece recién cuando arranca la Hora Flash
  orden      int  not null default 0,
  creado_el  timestamptz not null default now()
);
create index desafios_evento on public.desafios (evento_id);

create table public.invitados (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos (id) on delete cascade,
  nombre     text not null check (length(nombre) between 2 and 80),
  instagram  text check (instagram ~ '^[a-z0-9._]{1,30}$'),  -- se guarda sin @ y en minúsculas
  aprobado   boolean not null default true,                  -- false = pidió acceso y espera tu ok
  ingreso_el timestamptz,                                    -- primera vez que entró: nadie más puede usar ese nombre
  creado_el  timestamptz not null default now()
);
create unique index invitados_nombre_unico on public.invitados (evento_id, lower(nombre));

create table public.sesiones (
  token_hash  text primary key,
  invitado_id uuid not null references public.invitados (id) on delete cascade,
  creado_el   timestamptz not null default now()
);
create index sesiones_invitado on public.sesiones (invitado_id);

create table public.publicaciones (
  id            uuid primary key default gen_random_uuid(),
  evento_id     uuid not null references public.eventos (id) on delete cascade,
  invitado_id   uuid not null references public.invitados (id) on delete cascade,
  desafio_id    uuid not null references public.desafios (id) on delete cascade,
  tipo          public.tipo_media not null,
  storage_key   text not null unique,                        -- ruta del archivo en R2
  ancho         int,
  alto          int,
  duracion_seg  numeric(5, 1),
  multiplicador int  not null default 1,
  puntos        int  not null,
  estado        public.estado_publicacion not null default 'visible',
  creado_el     timestamptz not null default now()
);
-- Cada desafío suma una sola vez por invitado. Si ocultás la foto, puede volver a intentarlo.
create unique index publicaciones_un_desafio_por_invitado
  on public.publicaciones (invitado_id, desafio_id) where estado = 'visible';
create index publicaciones_evento_fecha on public.publicaciones (evento_id, creado_el desc);
create index publicaciones_desafio on public.publicaciones (desafio_id);

create table public.fueguitos (
  publicacion_id uuid not null references public.publicaciones (id) on delete cascade,
  invitado_id    uuid not null references public.invitados (id) on delete cascade,
  creado_el      timestamptz not null default now(),
  primary key (publicacion_id, invitado_id)
);
create index fueguitos_invitado on public.fueguitos (invitado_id);


-- ---------------------------------------------------------------------
-- 4. Funciones internas
-- ---------------------------------------------------------------------
create function privado.normalizar(t text) returns text
language sql immutable set search_path = '' as $$
  select translate(lower(coalesce(t, '')), 'áéíóúüñàèìòùÁÉÍÓÚÜÑ', 'aeiouunaeiouaeiouun')
$$;

create function privado.slug(t text) returns text
language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(privado.normalizar(t), '[^a-z0-9]+', '-', 'g'))
$$;

create function privado.hash(t text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(t, 'UTF8')), 'hex')
$$;

-- Sos admin si estás en la tabla admins, si usás la clave secreta (service_role)
-- o si corrés algo desde el SQL Editor.
create function privado.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select session_user in ('postgres', 'supabase_admin')
      or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or exists (select 1 from public.admins a where a.user_id = auth.uid())
$$;

-- Un evento se ve si está en vivo, o cerrado con la galería todavía vigente.
create function privado.evento_visible(p_evento_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.eventos e
    where e.id = p_evento_id
      and (e.estado = 'en_vivo' or (e.estado = 'cerrado' and e.galeria_vence_el > now()))
  )
$$;

create function privado.flash_largada(p_evento_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.eventos e
    where e.id = p_evento_id and e.flash_inicio is not null and e.flash_inicio <= now()
  )
$$;

create function privado.flash_activa(e public.eventos) returns boolean
language sql stable set search_path = '' as $$
  select e.flash_inicio is not null
     and now() >= e.flash_inicio
     and now() <  e.flash_inicio + make_interval(mins => e.flash_minutos)
$$;

create function privado.invitado_de_token(p_token text) returns public.invitados
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.invitados;
begin
  select i.* into v
  from public.sesiones s
  join public.invitados i on i.id = s.invitado_id
  where s.token_hash = privado.hash(p_token);
  if not found then
    raise exception 'sesion_invalida';
  end if;
  return v;
end
$$;

create function privado.nueva_sesion(p_invitado_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.sesiones (token_hash, invitado_id)
  values (privado.hash(v_token), p_invitado_id);
  return v_token;
end
$$;

revoke execute on function privado.nueva_sesion(uuid), privado.invitado_de_token(text) from public;


-- ---------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------

-- Al crear un evento: arma el slug, toma el máximo de invitados del plan y el tono según el tipo.
create function privado.completar_evento() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.slug := privado.slug(coalesce(nullif(new.slug, ''), new.nombre));
  if new.max_invitados is null then
    select p.max_invitados into new.max_invitados from public.planes p where p.codigo = new.plan;
  end if;
  if new.tono is null then
    new.tono := (case new.tipo
                   when 'cumple'    then 'fiesta'
                   when 'egresados' then 'colegio'
                   when 'empresa'   then 'oficina'
                   else 'familia'
                 end)::public.tono_evento;
  end if;
  return new;
end
$$;
create trigger eventos_completar
  before insert on public.eventos
  for each row execute function privado.completar_evento();

-- Al cargar un invitado: limpia nombre e Instagram y controla el cupo del evento.
create function privado.preparar_invitado() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_max    int;
  v_actual int;
begin
  new.nombre    := trim(new.nombre);
  new.instagram := nullif(lower(trim(both '@ ' from coalesce(new.instagram, ''))), '');
  if tg_op = 'INSERT' then
    select e.max_invitados into v_max from public.eventos e where e.id = new.evento_id for update;
    select count(*) into v_actual from public.invitados i where i.evento_id = new.evento_id;
    if v_actual >= v_max then
      raise exception 'evento_completo'
        using hint = 'Subí max_invitados del evento si querés sumar más gente.';
    end if;
  end if;
  return new;
end
$$;
create trigger invitados_preparar
  before insert or update of nombre, instagram on public.invitados
  for each row execute function privado.preparar_invitado();


-- ---------------------------------------------------------------------
-- 6. Vistas
-- ---------------------------------------------------------------------

-- Galería: lo que ve cualquiera con el link del evento.
create view public.v_galeria with (security_invoker = true) as
select p.id,
       p.evento_id,
       i.nombre   as autor,
       i.instagram,
       d.titulo   as desafio,
       p.tipo,
       p.storage_key,
       p.ancho,
       p.alto,
       p.duracion_seg,
       p.puntos,
       p.multiplicador,
       (select count(*) from public.fueguitos f where f.publicacion_id = p.id)::int as fueguitos,
       p.creado_el
from public.publicaciones p
join public.invitados i on i.id = p.invitado_id
join public.desafios d  on d.id = p.desafio_id
where p.estado = 'visible';

-- Podio: puntos de los desafíos + 1 punto por cada fueguito recibido.
create view public.v_podio with (security_invoker = true) as
with pub as (
  select p.evento_id,
         p.invitado_id,
         count(*)::int      as publicaciones,
         sum(p.puntos)::int as puntos_desafios,
         max(p.creado_el)   as ultima_publicacion
  from public.publicaciones p
  where p.estado = 'visible'
  group by p.evento_id, p.invitado_id
), fue as (
  select p.invitado_id, count(*)::int as fueguitos
  from public.fueguitos f
  join public.publicaciones p on p.id = f.publicacion_id and p.estado = 'visible'
  group by p.invitado_id
)
select pub.evento_id,
       rank() over (partition by pub.evento_id
                    order by pub.puntos_desafios + coalesce(fue.fueguitos, 0) desc) as puesto,
       i.id as invitado_id,
       i.nombre,
       i.instagram,
       pub.publicaciones,
       pub.puntos_desafios,
       coalesce(fue.fueguitos, 0)                       as fueguitos,
       pub.puntos_desafios + coalesce(fue.fueguitos, 0) as total,
       pub.ultima_publicacion
from pub
join public.invitados i on i.id = pub.invitado_id
left join fue on fue.invitado_id = pub.invitado_id;

-- Para armar el ZIP final con nombres tipo rocio-paz_la-mejor-foto-de-la-hora-loca_01.jpg (solo admin).
create view public.v_exportacion with (security_invoker = true) as
select p.evento_id,
       e.slug as evento,
       p.id   as publicacion_id,
       p.storage_key,
       privado.slug(i.nombre) || '_' || privado.slug(d.titulo) || '_' ||
         lpad(row_number() over (partition by p.evento_id, privado.slug(i.nombre), privado.slug(d.titulo)
                                 order by p.creado_el)::text, 2, '0') ||
         coalesce(substring(p.storage_key from '\.[A-Za-z0-9]+$'), '') as nombre_archivo,
       i.nombre as invitado,
       d.titulo as desafio,
       p.tipo,
       p.puntos,
       p.creado_el
from public.publicaciones p
join public.eventos e   on e.id = p.evento_id
join public.invitados i on i.id = p.invitado_id
join public.desafios d  on d.id = p.desafio_id
where p.estado = 'visible' and privado.es_admin();

-- Eventos con la galería vencida: lo que el job de limpieza borra (archivos en R2 y después las filas).
create view public.v_eventos_vencidos with (security_invoker = true) as
select e.id, e.slug, e.nombre, e.galeria_vence_el
from public.eventos e
where e.estado = 'cerrado' and e.galeria_vence_el <= now() and privado.es_admin();


-- ---------------------------------------------------------------------
-- 7. Funciones para la app del invitado
--    La app guarda el token que devuelven entrar_evento / pedir_acceso
--    y lo manda en cada llamada. Los errores vuelven con un código corto
--    (por ejemplo 'cupo_completo') para mostrar el mensaje que quieras.
-- ---------------------------------------------------------------------

-- El invitado escribe su nombre (o su @) y se busca en la lista.
create function public.buscar_invitados(p_slug text, p_texto text)
returns table (id uuid, nombre text, ya_ingreso boolean)
language sql stable security definer set search_path = '' as $$
  select i.id, i.nombre, i.ingreso_el is not null
  from public.invitados i
  join public.eventos e on e.id = i.evento_id
  where e.slug = p_slug
    and e.estado = 'en_vivo'
    and i.aprobado
    and length(trim(coalesce(p_texto, ''))) >= 2
    and (privado.normalizar(i.nombre) like '%' || privado.normalizar(trim(p_texto)) || '%'
         or i.instagram like '%' || lower(trim(both '@ ' from p_texto)) || '%')
  order by i.nombre
  limit 8
$$;

-- Elige su nombre y entra. Devuelve el token de sesión.
create function public.entrar_evento(p_slug text, p_invitado_id uuid)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_evento public.eventos;
  v_inv    public.invitados;
begin
  select * into v_evento from public.eventos where slug = p_slug;
  if not found or v_evento.estado <> 'en_vivo' then
    raise exception 'evento_no_disponible';
  end if;

  select * into v_inv from public.invitados
  where id = p_invitado_id and evento_id = v_evento.id
  for update;
  if not found or not v_inv.aprobado then
    raise exception 'invitado_no_encontrado';
  end if;
  if v_inv.ingreso_el is not null then
    raise exception 'ya_ingresado' using hint = 'Pedile al anfitrión que te habilite de nuevo.';
  end if;

  update public.invitados set ingreso_el = now() where id = v_inv.id;
  return privado.nueva_sesion(v_inv.id);
end
$$;

-- No está en la lista: pide acceso y espera tu aprobación. Devuelve el token de sesión.
create function public.pedir_acceso(p_slug text, p_nombre text, p_instagram text default null)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_evento public.eventos;
  v_id     uuid;
begin
  select * into v_evento from public.eventos where slug = p_slug;
  if not found or v_evento.estado <> 'en_vivo' then
    raise exception 'evento_no_disponible';
  end if;

  begin
    insert into public.invitados (evento_id, nombre, instagram, aprobado, ingreso_el)
    values (v_evento.id, p_nombre, p_instagram, false, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'nombre_en_uso' using hint = 'Ya hay alguien con ese nombre en la lista: buscate ahí.';
  end;

  return privado.nueva_sesion(v_id);
end
$$;

-- Todo lo que la app necesita saber del invitado: si está aprobado, cupos, Hora Flash, etc.
create function public.mi_estado(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_inv public.invitados;
  v_e   public.eventos;
begin
  v_inv := privado.invitado_de_token(p_token);
  select * into v_e from public.eventos where id = v_inv.evento_id;

  return jsonb_build_object(
    'invitado', jsonb_build_object('id', v_inv.id, 'nombre', v_inv.nombre, 'aprobado', v_inv.aprobado),
    'evento',   jsonb_build_object('id', v_e.id, 'slug', v_e.slug, 'nombre', v_e.nombre, 'estado', v_e.estado),
    'hora_flash', jsonb_build_object(
        'activa', privado.flash_activa(v_e),
        'termina', case when v_e.flash_inicio is null then null
                        else v_e.flash_inicio + make_interval(mins => v_e.flash_minutos) end,
        'multiplicador', v_e.flash_multiplicador),
    'cupos', jsonb_build_object(
        'fotos',      (select count(*) from public.publicaciones p
                        where p.invitado_id = v_inv.id and p.tipo = 'foto' and p.estado = 'visible'),
        'max_fotos',  v_e.max_fotos,
        'videos',     (select count(*) from public.publicaciones p
                        where p.invitado_id = v_inv.id and p.tipo = 'video' and p.estado = 'visible'),
        'max_videos', v_e.max_videos),
    'desafios_cumplidos', coalesce((select jsonb_agg(p.desafio_id) from public.publicaciones p
                                    where p.invitado_id = v_inv.id and p.estado = 'visible'), '[]'::jsonb),
    'mis_fueguitos',      coalesce((select jsonb_agg(f.publicacion_id) from public.fueguitos f
                                    where f.invitado_id = v_inv.id), '[]'::jsonb)
  );
end
$$;

-- Registra una foto o video ya subido a R2. Calcula los puntos (x2 en Hora Flash).
create function public.crear_publicacion(
  p_token        text,
  p_desafio_id   uuid,
  p_storage_key  text,
  p_ancho        int     default null,
  p_alto         int     default null,
  p_duracion_seg numeric default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_inv         public.invitados;
  v_e           public.eventos;
  v_d           public.desafios;
  v_prefijo     text;
  v_usados      int;
  v_max         int;
  v_mult        int;
  v_id          uuid;
  v_restriccion text;
begin
  v_inv := privado.invitado_de_token(p_token);
  if not v_inv.aprobado then
    raise exception 'invitado_pendiente';
  end if;
  perform 1 from public.invitados where id = v_inv.id for update;  -- una subida a la vez por invitado

  select * into v_e from public.eventos where id = v_inv.evento_id;
  if v_e.estado <> 'en_vivo' then
    raise exception 'evento_cerrado';
  end if;

  select * into v_d from public.desafios where id = p_desafio_id and evento_id = v_e.id;
  if not found then
    raise exception 'desafio_invalido';
  end if;
  if v_d.solo_flash and not privado.flash_activa(v_e) then
    raise exception 'hora_flash_cerrada';
  end if;

  v_prefijo := 'eventos/' || v_e.id || '/' || v_inv.id || '/';
  if p_storage_key is null or not starts_with(p_storage_key, v_prefijo) then
    raise exception 'archivo_invalido';
  end if;

  select count(*) into v_usados from public.publicaciones
  where invitado_id = v_inv.id and tipo = v_d.tipo and estado = 'visible';
  v_max := case v_d.tipo when 'foto' then v_e.max_fotos else v_e.max_videos end;
  if v_usados >= v_max then
    raise exception 'cupo_completo';
  end if;

  v_mult := case when privado.flash_activa(v_e) then v_e.flash_multiplicador else 1 end;

  begin
    insert into public.publicaciones
      (evento_id, invitado_id, desafio_id, tipo, storage_key, ancho, alto, duracion_seg, multiplicador, puntos)
    values
      (v_e.id, v_inv.id, v_d.id, v_d.tipo, p_storage_key, p_ancho, p_alto, p_duracion_seg, v_mult, v_d.puntos * v_mult)
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_restriccion = constraint_name;
    if v_restriccion = 'publicaciones_un_desafio_por_invitado' then
      raise exception 'desafio_ya_cumplido';
    end if;
    raise exception 'archivo_repetido';
  end;

  return v_id;
end
$$;

-- Da o saca un fueguito. Devuelve true si quedó dado.
create function public.dar_fueguito(p_token text, p_publicacion_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_inv    public.invitados;
  v_pub    public.publicaciones;
  v_estado public.estado_evento;
begin
  v_inv := privado.invitado_de_token(p_token);
  if not v_inv.aprobado then
    raise exception 'invitado_pendiente';
  end if;

  select * into v_pub from public.publicaciones
  where id = p_publicacion_id and evento_id = v_inv.evento_id and estado = 'visible';
  if not found then
    raise exception 'publicacion_invalida';
  end if;

  select estado into v_estado from public.eventos where id = v_inv.evento_id;
  if v_estado <> 'en_vivo' then
    raise exception 'evento_cerrado';
  end if;
  if v_pub.invitado_id = v_inv.id then
    raise exception 'fueguito_propio';
  end if;

  delete from public.fueguitos where publicacion_id = p_publicacion_id and invitado_id = v_inv.id;
  if found then
    return false;
  end if;

  insert into public.fueguitos (publicacion_id, invitado_id)
  values (p_publicacion_id, v_inv.id)
  on conflict do nothing;
  return true;
end
$$;


-- ---------------------------------------------------------------------
-- 8. Funciones para vos (solo admin)
--    Crear eventos, cargar invitados, editar desafíos, aprobar pedidos de
--    acceso (aprobado = true) u ocultar fotos (estado = 'oculta') se hace
--    directo sobre las tablas desde tu panel.
-- ---------------------------------------------------------------------

-- Copia al evento los desafíos sugeridos para su tipo, más los de Hora Flash.
create function public.cargar_desafios_sugeridos(p_evento_id uuid)
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_tipo public.tipo_evento;
  v_n    int;
begin
  if not privado.es_admin() then
    raise exception 'no_autorizado';
  end if;
  select tipo into v_tipo from public.eventos where id = p_evento_id;
  if not found then
    raise exception 'evento_inexistente';
  end if;

  insert into public.desafios (evento_id, titulo, tipo, puntos, solo_flash, orden)
  select p_evento_id, t.titulo, t.tipo, t.puntos, t.solo_flash, t.orden
  from public.plantillas_desafios t
  where t.tipo_evento = v_tipo or t.tipo_evento is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Arranca la Hora Flash ahora. Devuelve cuándo termina.
create function public.largar_hora_flash(p_evento_id uuid)
returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_fin timestamptz;
begin
  if not privado.es_admin() then
    raise exception 'no_autorizado';
  end if;
  update public.eventos
     set flash_inicio = now()
   where id = p_evento_id and estado = 'en_vivo'
  returning flash_inicio + make_interval(mins => flash_minutos) into v_fin;
  if v_fin is null then
    raise exception 'evento_no_disponible';
  end if;
  return v_fin;
end
$$;

-- Cierra el evento: se congela el podio y la galería queda online los días del plan.
create function public.cerrar_evento(p_evento_id uuid)
returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_vence timestamptz;
begin
  if not privado.es_admin() then
    raise exception 'no_autorizado';
  end if;
  update public.eventos e
     set estado = 'cerrado',
         galeria_vence_el = now() + make_interval(days => p.dias_galeria)
    from public.planes p
   where e.id = p_evento_id and p.codigo = e.plan and e.estado = 'en_vivo'
  returning e.galeria_vence_el into v_vence;
  if v_vence is null then
    raise exception 'evento_no_disponible';
  end if;
  return v_vence;
end
$$;

-- Para el invitado que cambió de celular: corta su sesión y lo deja entrar de nuevo.
create function public.habilitar_reingreso(p_invitado_id uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not privado.es_admin() then
    raise exception 'no_autorizado';
  end if;
  delete from public.sesiones where invitado_id = p_invitado_id;
  update public.invitados set ingreso_el = null where id = p_invitado_id;
end
$$;

revoke execute on function public.cargar_desafios_sugeridos(uuid) from public, anon;
revoke execute on function public.largar_hora_flash(uuid)         from public, anon;
revoke execute on function public.cerrar_evento(uuid)             from public, anon;
revoke execute on function public.habilitar_reingreso(uuid)       from public, anon;


-- ---------------------------------------------------------------------
-- 9. Seguridad (RLS)
-- ---------------------------------------------------------------------
alter table public.admins              enable row level security;
alter table public.planes              enable row level security;
alter table public.eventos             enable row level security;
alter table public.plantillas_desafios enable row level security;
alter table public.desafios            enable row level security;
alter table public.invitados           enable row level security;
alter table public.sesiones            enable row level security;
alter table public.publicaciones       enable row level security;
alter table public.fueguitos           enable row level security;

-- Vos: acceso total.
create policy admin_ve_su_fila on public.admins              for select to authenticated using (user_id = auth.uid());
create policy admin_todo       on public.planes              for all to authenticated using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo       on public.eventos             for all to authenticated using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo       on public.plantillas_desafios for all to authenticated using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo       on public.desafios            for all to authenticated using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo       on public.invitados           for all to authenticated using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo       on public.sesiones            for all to authenticated using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo       on public.publicaciones       for all to authenticated using (privado.es_admin()) with check (privado.es_admin());
create policy admin_todo       on public.fueguitos           for all to authenticated using (privado.es_admin()) with check (privado.es_admin());

-- Cualquiera con el link: solo lectura de lo visible. Para escribir están las funciones de la sección 7.
create policy planes_publicos on public.planes for select to anon, authenticated
  using (true);

create policy eventos_publicos on public.eventos for select to anon, authenticated
  using (estado = 'en_vivo' or (estado = 'cerrado' and galeria_vence_el > now()));

create policy desafios_publicos on public.desafios for select to anon, authenticated
  using (privado.evento_visible(evento_id) and (not solo_flash or privado.flash_largada(evento_id)));

create policy publicaciones_publicas on public.publicaciones for select to anon, authenticated
  using (estado = 'visible' and privado.evento_visible(evento_id));

-- De la lista de invitados solo se ve a quien ya publicó algo (para mostrar autor y podio).
create policy invitados_autores on public.invitados for select to anon, authenticated
  using (privado.evento_visible(evento_id)
         and exists (select 1 from public.publicaciones p
                     where p.invitado_id = invitados.id and p.estado = 'visible'));

create policy fueguitos_publicos on public.fueguitos for select to anon, authenticated
  using (exists (select 1 from public.publicaciones p where p.id = fueguitos.publicacion_id));

-- Permisos de la API. Van explícitos para que solo quede expuesto lo que la app usa
-- (por eso conviene destildar "Automatically expose new tables" al crear el proyecto).
grant usage on schema public to anon, authenticated, service_role;

-- Lectura para cualquiera con el link (las políticas de arriba filtran qué filas).
grant select on public.planes, public.eventos, public.desafios, public.invitados,
                public.publicaciones, public.fueguitos, public.v_galeria, public.v_podio
  to anon, authenticated;

-- Tu panel (las políticas solo dejan pasar a los admins).
grant select, insert, update, delete
  on public.planes, public.eventos, public.plantillas_desafios, public.desafios,
     public.invitados, public.sesiones, public.publicaciones, public.fueguitos
  to authenticated;
grant select on public.admins, public.v_exportacion, public.v_eventos_vencidos to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Clave secreta (scripts y funciones del servidor).
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant execute on function
  public.buscar_invitados(text, text),
  public.entrar_evento(text, uuid),
  public.pedir_acceso(text, text, text),
  public.mi_estado(text),
  public.crear_publicacion(text, uuid, text, int, int, numeric),
  public.dar_fueguito(text, uuid)
  to anon, authenticated, service_role;

grant execute on function
  public.cargar_desafios_sugeridos(uuid),
  public.largar_hora_flash(uuid),
  public.cerrar_evento(uuid),
  public.habilitar_reingreso(uuid)
  to authenticated, service_role;

grant execute on function
  privado.es_admin(), privado.evento_visible(uuid), privado.flash_largada(uuid),
  privado.normalizar(text), privado.slug(text)
  to anon, authenticated, service_role;

revoke all on public.sesiones, public.admins, public.plantillas_desafios from anon;
revoke all on public.v_exportacion, public.v_eventos_vencidos from anon;


-- ---------------------------------------------------------------------
-- 10. Tiempo real: la galería y los fueguitos se actualizan solos en la app
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.publicaciones, public.fueguitos;


-- ---------------------------------------------------------------------
-- 11. Datos iniciales
-- ---------------------------------------------------------------------
insert into public.planes (codigo, nombre, max_invitados, dias_galeria, precio_usd) values
  ('chispa',    'Chispa',     80,  30,  80),
  ('flash',     'Flash',     200, 180, 160),
  ('reflector', 'Reflector', 400, 365, 320);

-- Los desafíos de ejemplo de la landing.
insert into public.plantillas_desafios (tipo_evento, titulo, tipo, puntos, orden) values
  ('casamiento', 'El primer valiente en salir a la pista',                       'foto',  15, 1),
  ('casamiento', 'Selfie con quien viajó más lejos para venir',                  'foto',  15, 2),
  ('casamiento', 'Tu mesa entera haciendo la ola',                               'video', 10, 3),
  ('casamiento', 'Un consejo de convivencia para los novios, en 10 segundos',    'video', 20, 4),
  ('casamiento', 'Los zapatos que se rindieron antes de las 3',                  'foto',  10, 5),
  ('casamiento', 'La mejor foto de la hora loca',                                'foto',  25, 6),
  ('quince',     'Selfie con la quinceañera en la mesa dulce',                   'foto',  15, 1),
  ('quince',     'El vals, desde donde estés',                                   'foto',  10, 2),
  ('quince',     'Tu grupo armando una coreo en la pista',                       'video', 20, 3),
  ('quince',     'Un deseo para los próximos 15, en 10 segundos',                'video', 20, 4),
  ('quince',     'La foto más divertida con el cotillón',                        'foto',  10, 5),
  ('quince',     'La tía que no paró de bailar en toda la noche',                'foto',  15, 6),
  ('cumple',     'Quien cumple, justo cuando sopla las velas',                   'foto',  15, 1),
  ('cumple',     'Selfie con la última persona en llegar',                       'foto',  10, 2),
  ('cumple',     'Tu mejor imitación de quien cumple',                           'video', 20, 3),
  ('cumple',     'Tu anécdota con quien cumple, en 10 segundos (versión apta)',  'video', 20, 4),
  ('cumple',     'La mesa más ruidosa de la noche',                              'foto',  10, 5),
  ('cumple',     'Los que cierran la fiesta, como prueba',                       'foto',  25, 6),
  ('egresados',  'Todo el curso en una sola foto, sin que falte nadie',          'foto',  25, 1),
  ('egresados',  'Recreá una foto del primer día de clases',                     'foto',  20, 2),
  ('egresados',  'Selfie con la preceptora o el preceptor',                      'foto',  15, 3),
  ('egresados',  'La frase más famosa de un profe, imitada',                     'video', 20, 4),
  ('egresados',  'El buzo de egresados más firmado',                             'foto',  10, 5),
  ('egresados',  'Los del fondo, juntos por última vez',                         'foto',  15, 6),
  ('empresa',    'Tu equipo formando la inicial de la empresa',                  'foto',  20, 1),
  ('empresa',    'Explicá tu trabajo en 5 segundos',                             'video', 20, 2),
  ('empresa',    'Selfie con quien te salvó las papas este año',                 'foto',  15, 3),
  ('empresa',    'El brindis más corporativo posible',                           'video', 10, 4),
  ('empresa',    'Tu mejor pose de foto para LinkedIn',                          'foto',  15, 5),
  ('empresa',    'Las tres personas más nuevas de la empresa, juntas',           'foto',  10, 6);

-- Desafíos sorpresa de la Hora Flash, para cualquier tipo de evento (editalos a gusto).
insert into public.plantillas_desafios (tipo_evento, titulo, tipo, puntos, solo_flash, orden) values
  (null, 'La selfie con más gente posible',          'foto',  15, true, 101),
  (null, 'Alguien bailando como si nadie lo viera',  'video', 15, true, 102),
  (null, 'La foto más creativa con algo del salón',  'foto',  15, true, 103);

commit;


-- =====================================================================
--  Último paso: sumarte como admin
--  1. Authentication → Users → Add user → tu mail y una contraseña.
--  2. Corré esto con tu mail:
--
--     insert into public.admins (user_id)
--     select id from auth.users where email = 'tu@mail.com';
--
--  Para probar con un evento de ejemplo (corrélo cuando quieras):
--
--     insert into public.eventos (nombre, tipo, plan, fecha, estado)
--     values ('Prueba Flor y Juli', 'casamiento', 'flash', current_date, 'en_vivo');
--
--     select public.cargar_desafios_sugeridos(id) from public.eventos where slug = 'prueba-flor-y-juli';
--
--     insert into public.invitados (evento_id, nombre, instagram)
--     select e.id, x.nombre, x.instagram
--     from public.eventos e,
--          (values ('Rocío Paz', 'rochi.pz'), ('Nacho García', 'nachito_g')) as x(nombre, instagram)
--     where e.slug = 'prueba-flor-y-juli';
-- =====================================================================
