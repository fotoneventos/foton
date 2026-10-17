-- =====================================================================
--  Fotón · Actualización 02: subidas a Cloudflare R2
-- ---------------------------------------------------------------------
--  Correla en el SQL Editor después de 01_esquema.sql.
--   · preparar_subida: valida al invitado antes de firmar la subida
--     (la usa la Edge Function firmar-subida).
--   · v_galeria: suma invitado_id, para armar el podio en la app y
--     no mostrarte el botón de fueguito en tus propias fotos.
-- =====================================================================

begin;

create function public.preparar_subida(p_token text, p_desafio_id uuid, p_tipo_mime text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_inv    public.invitados;
  v_e      public.eventos;
  v_d      public.desafios;
  v_usados int;
  v_max    int;
begin
  v_inv := privado.invitado_de_token(p_token);
  if not v_inv.aprobado then
    raise exception 'invitado_pendiente';
  end if;

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
  if (v_d.tipo = 'foto'  and coalesce(p_tipo_mime, '') not like 'image/%')
  or (v_d.tipo = 'video' and coalesce(p_tipo_mime, '') not like 'video/%') then
    raise exception 'tipo_no_permitido';
  end if;

  if exists (select 1 from public.publicaciones p
             where p.invitado_id = v_inv.id and p.desafio_id = v_d.id and p.estado = 'visible') then
    raise exception 'desafio_ya_cumplido';
  end if;

  select count(*) into v_usados from public.publicaciones p
  where p.invitado_id = v_inv.id and p.tipo = v_d.tipo and p.estado = 'visible';
  v_max := case v_d.tipo when 'foto' then v_e.max_fotos else v_e.max_videos end;
  if v_usados >= v_max then
    raise exception 'cupo_completo';
  end if;

  return jsonb_build_object(
    'prefijo', 'eventos/' || v_e.id || '/' || v_inv.id || '/',
    'tipo',    v_d.tipo
  );
end
$$;

grant execute on function public.preparar_subida(text, uuid, text) to anon, authenticated, service_role;

create or replace view public.v_galeria with (security_invoker = true) as
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
       p.creado_el,
       p.invitado_id
from public.publicaciones p
join public.invitados i on i.id = p.invitado_id
join public.desafios d  on d.id = p.desafio_id
where p.estado = 'visible';

commit;
