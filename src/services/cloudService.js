const SUPABASE_BROWSER_MODULE = "https://esm.sh/@supabase/supabase-js@2";

export async function createCloudService(config) {
  if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
    return createDisabledCloudService();
  }

  const { createClient } = await import(SUPABASE_BROWSER_MODULE);
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return {
    enabled: true,
    async getCurrentUser() {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.error("Failed to get current Supabase user.", error);
        return null;
      }
      return mapUser(data.user);
    },
    onAuthStateChange(callback) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        callback(mapUser(session?.user || null));
      });
      return () => data.subscription.unsubscribe();
    },
    async signInWithGoogle() {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });
      if (error) {
        throw error;
      }
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
    },
    async loadWorkspace(ownerId) {
      const { data, error } = await supabase
        .from("user_workspaces")
        .select("data")
        .eq("user_id", ownerId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data?.data || null;
    },
    async saveWorkspace(ownerId, workspace) {
      const payload = {
        user_id: ownerId,
        data: workspace,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("user_workspaces")
        .upsert(payload, { onConflict: "user_id" });

      if (error) {
        throw error;
      }

      return workspace;
    },
  };
}

function createDisabledCloudService() {
  return {
    enabled: false,
    async getCurrentUser() {
      return null;
    },
    onAuthStateChange() {
      return () => {};
    },
    async signInWithGoogle() {
      throw new Error("Cloud sync is not configured yet.");
    },
    async signOut() {
      return null;
    },
    async loadWorkspace() {
      return null;
    },
    async saveWorkspace() {
      return null;
    },
  };
}

function mapUser(user) {
  if (!user?.id) {
    return null;
  }

  return {
    id: user.id,
    name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Google User",
    email: user.email || "",
    picture: user.user_metadata?.avatar_url || user.user_metadata?.picture || "",
  };
}
