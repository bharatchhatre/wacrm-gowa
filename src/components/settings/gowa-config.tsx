'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Copy, Loader2, XCircle, Zap, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

type Status =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'connected'; phone: string }
  | { state: 'error'; message: string };

type SavedGowa = {
  configured: boolean;
  base_url?: string | null;
  username?: string | null;
  has_password?: boolean;
  device_id?: string | null;
  jid?: string | null;
  webhook_url?: string;
  service_role_problem?: 'missing' | 'invalid' | null;
};

type ManualWebhook = { url: string; secret: string; error: string | null };

/**
 * Settings → WhatsApp, GOWA tab. Connects the account through a
 * self-hosted GOWA server (go-whatsapp-web-multidevice): the CRM checks
 * the device is logged in, saves the connection and points the device's
 * webhook back here. See src/lib/whatsapp/gowa-api.ts.
 */
export function GowaConfig({ onSaved }: { onSaved?: () => void }) {
  const t = useTranslations('Settings.gowa');
  const { canEditSettings } = useAuth();

  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [saved, setSaved] = useState<SavedGowa | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [manualWebhook, setManualWebhook] = useState<ManualWebhook | null>(null);
  const [serviceRoleProblem, setServiceRoleProblem] = useState<'missing' | 'invalid' | null>(null);

  const checkHealth = useCallback(async () => {
    const res = await fetch('/api/whatsapp/config');
    const payload = await res.json().catch(() => ({}));
    if (payload.connected && payload.provider === 'gowa') {
      setStatus({ state: 'connected', phone: payload.phone_info?.display_phone_number ?? '' });
    } else if (payload.reason === 'no_config' || (payload.connected && payload.provider !== 'gowa')) {
      setStatus({ state: 'none' });
    } else {
      setStatus({ state: 'error', message: payload.message || t('unknownError') });
    }
  }, [t]);

  const load = useCallback(async () => {
    setStatus({ state: 'loading' });
    try {
      const res = await fetch('/api/whatsapp/gowa/config');
      const data: SavedGowa = await res.json();
      setServiceRoleProblem(res.ok ? (data.service_role_problem ?? null) : null);
      if (!res.ok || !data.configured) {
        setSaved(null);
        setStatus({ state: 'none' });
        return;
      }
      setSaved(data);
      setBaseUrl(data.base_url ?? '');
      setUsername(data.username ?? '');
      setHasPassword(!!data.has_password);
      setPassword('');
      setDeviceId(data.device_id ?? '');
      await checkHealth();
    } catch {
      setStatus({ state: 'error', message: t('loadFailed') });
    }
  }, [checkHealth, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (!baseUrl.trim()) {
      toast.error(t('urlRequired'));
      return;
    }
    setSaving(true);
    setManualWebhook(null);
    try {
      const res = await fetch('/api/whatsapp/gowa/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl,
          username,
          password,
          device_id: deviceId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        setStatus({ state: 'error', message: data.error || t('saveFailed') });
        return;
      }
      if (data.webhook_configured) {
        toast.success(t('savedAndWired'));
      } else {
        toast.warning(t('savedNoWebhook'));
        setManualWebhook({
          url: data.webhook_url,
          secret: data.webhook_secret,
          error: data.webhook_error ?? null,
        });
      }
      await load();
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      await checkHealth();
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('disconnectConfirm'))) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('disconnectFailed'));
        return;
      }
      toast.success(t('disconnected'));
      setSaved(null);
      setBaseUrl('');
      setUsername('');
      setPassword('');
      setHasPassword(false);
      setDeviceId('');
      setManualWebhook(null);
      setStatus({ state: 'none' });
      onSaved?.();
    } finally {
      setDisconnecting(false);
    }
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => toast.success(t('copied')));
  }

  const readOnly = !canEditSettings;

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              {status.state === 'loading' ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : status.state === 'connected' ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {status.state === 'connected'
                  ? t('connectedAs', { phone: status.phone })
                  : status.state === 'loading'
                    ? t('checking')
                    : t('notConnected')}
              </AlertTitle>
            </div>
            {status.state === 'error' && (
              <AlertDescription className="text-muted-foreground text-sm mt-1">
                {status.message}
              </AlertDescription>
            )}
          </Alert>

          {serviceRoleProblem && (
            <Alert className="bg-red-950/30 border-red-700/50">
              <AlertTitle className="text-red-200 mb-1">{t('serviceRoleTitle')}</AlertTitle>
              <AlertDescription className="text-red-100/80 text-sm">
                {t(serviceRoleProblem === 'missing' ? 'serviceRoleMissing' : 'serviceRoleInvalid')}
              </AlertDescription>
            </Alert>
          )}

          {manualWebhook && (
            <Alert className="bg-amber-950/40 border-amber-600/40">
              <AlertTitle className="text-amber-200 mb-1">{t('manualWebhookTitle')}</AlertTitle>
              <AlertDescription className="text-amber-100/80 text-sm space-y-2">
                <p>{t('manualWebhookBody')}</p>
                {manualWebhook.error && <p className="text-xs opacity-80">{manualWebhook.error}</p>}
                <code className="block break-all rounded bg-black/30 p-2 text-xs">
                  WHATSAPP_WEBHOOK={manualWebhook.url}
                  <br />
                  WHATSAPP_WEBHOOK_SECRET={manualWebhook.secret}
                </code>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('serverTitle')}</CardTitle>
              <CardDescription>{t('serverDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gowa-url">{t('urlLabel')}</Label>
                <Input
                  id="gowa-url"
                  placeholder="https://gowa.example.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  disabled={readOnly}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="gowa-user">{t('usernameLabel')}</Label>
                  <Input
                    id="gowa-user"
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={readOnly}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gowa-pass">{t('passwordLabel')}</Label>
                  <Input
                    id="gowa-pass"
                    type="password"
                    autoComplete="new-password"
                    placeholder={hasPassword ? t('passwordKept') : ''}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={readOnly}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('authHint')}</p>
              <div className="space-y-2">
                <Label htmlFor="gowa-device">{t('deviceLabel')}</Label>
                <Input
                  id="gowa-device"
                  placeholder={t('devicePlaceholder')}
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  disabled={readOnly}
                />
                <p className="text-xs text-muted-foreground">{t('deviceHint')}</p>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={handleSave} disabled={saving || readOnly}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {saved ? t('saveAgain') : t('connect')}
                </Button>
                {saved && (
                  <>
                    <Button variant="outline" onClick={handleTest} disabled={testing}>
                      {testing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
                      {t('test')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleDisconnect}
                      disabled={disconnecting || readOnly}
                    >
                      <RotateCcw className="size-4" />
                      {t('disconnect')}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {saved?.webhook_url && (
            <Card>
              <CardHeader>
                <CardTitle>{t('webhookTitle')}</CardTitle>
                <CardDescription>{t('webhookDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input readOnly value={saved.webhook_url} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copy(saved.webhook_url!)}>
                    <Copy className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t('howTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
              <li>{t('how1')}</li>
              <li>{t('how2')}</li>
              <li>{t('how3')}</li>
              <li>{t('how4')}</li>
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">{t('limitations')}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
