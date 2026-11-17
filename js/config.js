// Configuración pública de la app.
// La "anon key" de Supabase es pública por diseño: la seguridad la dan las
// políticas RLS de supabase/schema.sql. NUNCA pongas aquí la "service_role" key.
window.PMP_CONFIG = {
  supabaseUrl: '',      // ej. 'https://xxxxxxxx.supabase.co'
  supabaseAnonKey: ''   // ej. 'eyJhbGciOi...'
};
