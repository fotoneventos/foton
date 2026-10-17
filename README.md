# Fotón

Juego de fotos para eventos: los invitados escanean un QR, cumplen desafíos y suben fotos y videos a una galería en vivo con fueguitos y podio.

## Cómo está armado

| Parte | Dónde vive | Qué hace |
|---|---|---|
| `web/index.html` | Netlify | La landing (fotoneventos.netlify.app) |
| `web/evento.html` + `web/app/` | Netlify | La app del invitado. Cada evento se abre en `/e/<slug>` gracias a `web/_redirects` |
| `supabase/*.sql` | Supabase | Base de datos, seguridad (RLS) y funciones |
| `supabase/functions/firmar-subida` | Supabase Edge Functions | Firma las subidas a Cloudflare R2 |
| Fotos y videos | Cloudflare R2 | Archivos en `eventos/<evento>/<invitado>/` |

La app usa solo la URL y la clave **publishable** de Supabase (`web/app/config.js`). La clave secreta y las de R2 nunca van en este repo.

## Puesta en marcha

### 1. Base de datos (Supabase → SQL Editor)

1. `supabase/01_esquema.sql` (ya corrido).
2. `supabase/02_subidas.sql`.

### 2. Netlify

En el proyecto **fotoneventos**: Project configuration → Build & deploy → Link repository → elegir este repo. No hace falta comando de build: `netlify.toml` le indica que publique la carpeta `web/`.

### 3. Cloudflare R2 (donde se guardan las fotos)

1. En Cloudflare, entrá a **R2** y creá un bucket llamado `foton`.
2. En el bucket → **Settings** → **CORS policy**, pegá:

   ```json
   [
     {
       "AllowedOrigins": ["https://fotoneventos.netlify.app"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. En **Settings** → **Public access**, activá la **R2.dev subdomain** y copiá la URL (`https://pub-….r2.dev`). Ponela en `mediaUrl` dentro de `web/app/config.js`. Esa URL sirve para probar; para eventos reales conviene conectar un dominio propio al bucket.
4. En **R2** → **Manage API tokens**, creá un token con permiso **Object Read & Write** solo para el bucket `foton`. Guardá el *Access Key ID*, el *Secret Access Key* y tu *Account ID*.

### 4. Edge Function `firmar-subida` (Supabase)

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**. Nombre: `firmar-subida`. Pegá `supabase/functions/firmar-subida/index.ts` y desplegala.
2. Edge Functions → **Secrets**, cargá:
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET` = `foton`

### 5. Probar

Abrí `https://fotoneventos.netlify.app/e/prueba-flor-y-juli` (el evento de prueba del final de `01_esquema.sql`).

## Cómo se maneja un evento (por ahora, desde Supabase)

```sql
-- Abrir un evento para que entren los invitados
update eventos set estado = 'en_vivo' where slug = 'flor-y-juli';

-- Aprobar a alguien que pidió acceso
update invitados set aprobado = true where nombre = 'Tía Marta';

-- Ocultar una foto
update publicaciones set estado = 'oculta' where id = '…';

-- Largar la Hora Flash y cerrar el evento
select largar_hora_flash(id) from eventos where slug = 'flor-y-juli';
select cerrar_evento(id) from eventos where slug = 'flor-y-juli';
```
