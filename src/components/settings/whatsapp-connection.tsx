'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from './whatsapp-config';
import { GowaConfig } from './gowa-config';

type Provider = 'meta' | 'gowa';

/**
 * Settings → WhatsApp. An account connects through exactly one
 * provider; this picks which form to show, starting on the saved one.
 */
export function WhatsAppConnection() {
  const t = useTranslations('Settings.whatsappProvider');
  const { accountId, loading, profileLoading } = useAuth();
  // The saved provider (null until loaded) and the tab the user picked.
  const [savedProvider, setSavedProvider] = useState<Provider | null>(null);
  const [chosen, setChosen] = useState<Provider | null>(null);
  // Remounts the Meta form after a GOWA save/disconnect so it re-reads the row.
  const [metaKey, setMetaKey] = useState(0);

  useEffect(() => {
    if (loading || profileLoading || !accountId) return;
    let cancelled = false;
    void createClient()
      .from('whatsapp_config')
      .select('provider')
      .eq('account_id', accountId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setSavedProvider(data?.provider === 'gowa' ? 'gowa' : 'meta');
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, loading, profileLoading]);

  const ready = !loading && !profileLoading;
  const provider: Provider | null =
    chosen ?? (ready && !accountId ? 'meta' : savedProvider);
  if (!provider) return null;

  return (
    <Tabs value={provider} onValueChange={(v) => setChosen(v as Provider)} className="gap-4">
      <TabsList className="bg-muted/50">
        <TabsTrigger value="meta" className="data-active:bg-muted data-active:text-primary text-muted-foreground px-3">
          {t('meta')}
        </TabsTrigger>
        <TabsTrigger value="gowa" className="data-active:bg-muted data-active:text-primary text-muted-foreground px-3">
          {t('gowa')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="meta">
        <WhatsAppConfig key={metaKey} />
      </TabsContent>
      <TabsContent value="gowa">
        <GowaConfig onSaved={() => setMetaKey((k) => k + 1)} />
      </TabsContent>
    </Tabs>
  );
}
