// Configuración de la app del invitado.
// La URL y la clave publishable de Supabase son públicas por diseño:
// lo que protege los datos son las reglas de seguridad (RLS) de la base.
// La clave secreta (secret / service_role) nunca va acá.

export const CONFIG = {
  supabaseUrl: 'https://jcrsbouryinwgujcblca.supabase.co',
  supabaseKey: 'sb_publishable_lis6iB0LOp7pG0Za-PpxHA_yNwfLPI7',

  // URL pública del bucket de Cloudflare R2, sin barra al final.
  // Ejemplo: 'https://pub-0123456789abcdef.r2.dev'. Se completa al configurar R2.
  mediaUrl: 'https://pub-3e27a96ff3604e15a9d9d1a948261104.r2.dev',

  maxSegundosVideo: 20,
  maxMbVideo: 100,
};
