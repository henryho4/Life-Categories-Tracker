import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Surfaces a clear error in the browser console instead of a silent failure
  // if the environment variables weren't set during deployment.
  console.error(
    "Missing Supabase environment variables. Check that VITE_SUPABASE_URL and " +
    "VITE_SUPABASE_ANON_KEY are set (see .env.example)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
