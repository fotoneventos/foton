// Supabase Edge Function: firmar-subida
//
// La app del invitado la llama antes de subir una foto o un video.
// Valida al invitado contra la base (preparar_subida) y devuelve dos URLs
// firmadas, válidas por 10 minutos, para subir el archivo y su miniatura
// directo a Cloudflare R2.
//
// Secrets que necesita (Edge Functions → Secrets):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET

import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXTENSIONES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const MINUTOS_VALIDEZ = 10;

const CUENTA = Deno.env.get('R2_ACCOUNT_ID') ?? '';
const BUCKET = Deno.env.get('R2_BUCKET') ?? 'foton';
const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
  service: 's3',
  region: 'auto',
});

function responder(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function firmar(key: string, contentType: string): Promise<string> {
  const url = new URL(`https://${CUENTA}.r2.cloudflarestorage.com/${BUCKET}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(MINUTOS_VALIDEZ * 60));
  const firmado = await r2.sign(
    new Request(url, { method: 'PUT', headers: { 'Content-Type': contentType } }),
    { aws: { signQuery: true } },
  );
  return firmado.url;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'metodo_no_permitido' }, 405);
  if (!CUENTA || !Deno.env.get('R2_ACCESS_KEY_ID')) return responder({ error: 'sin_almacenamiento' }, 500);

  let datos: { token?: string; desafio_id?: string; content_type?: string };
  try {
    datos = await req.json();
  } catch {
    return responder({ error: 'pedido_invalido' }, 400);
  }

  const tipo = datos.content_type ?? '';
  const extension = EXTENSIONES[tipo];
  if (!datos.token || !datos.desafio_id || !extension) {
    return responder({ error: 'tipo_no_permitido' }, 400);
  }

  // Se consulta la base con la misma clave pública que usa la app.
  const clave = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', clave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('preparar_subida', {
    p_token: datos.token,
    p_desafio_id: datos.desafio_id,
    p_tipo_mime: tipo,
  });
  if (error) return responder({ error: error.message }, 400);

  const base = `${data.prefijo}${crypto.randomUUID()}`;
  const key = `${base}.${extension}`;
  const keyMiniatura = `${base}_t.jpg`;

  return responder({
    key,
    url: await firmar(key, tipo),
    key_miniatura: keyMiniatura,
    url_miniatura: await firmar(keyMiniatura, 'image/jpeg'),
  });
});
