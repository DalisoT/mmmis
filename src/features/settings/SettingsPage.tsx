import { useEffect } from 'react';
import { Loader2, Save, Settings as Cog } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/toast';
import { settingsFormSchema, useMessSettings, useUpdateMessSettings, type SettingsFormValues } from './settings.service';
import { formatDateTime } from '@/lib/utils';

export function SettingsPage() {
  const { data, isLoading } = useMessSettings();
  const update = useUpdateMessSettings();
  const { t } = useTranslation();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      opening_float: 0,
      recovery_target_pct: 30,
      vat_pct: 0,
      holiday_mode: false,
      mess_name: 'Officers Mess',
      currency_code: 'ZMW',
    },
  });

  useEffect(() => {
    if (data) {
      reset({
        opening_float: Number(data.opening_float ?? 0),
        recovery_target_pct: Number(data.recovery_target_pct ?? 30),
        vat_pct: Number(data.vat_pct ?? 0),
        holiday_mode: Boolean(data.holiday_mode),
        mess_name: data.mess_name,
        currency_code: data.currency_code,
      });
    }
  }, [data, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values);
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.saveFailed'));
    }
  });

  // Display the current currency code (always en) as the parenthetical.
  const currencyCode = data?.currency_code ?? 'ZMW';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Cog className="h-5 w-5" /> {t('settings.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('settings.subtitle')}
            {data && <> · {t('settings.lastUpdated', { datetime: formatDateTime(data.updated_at) })}</>}
          </p>
        </div>
        <Badge variant="outline">{t('settings.adminBadge')}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings.cardTitle')}</CardTitle>
          <CardDescription>{t('settings.cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('settings.loading')}
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2 max-w-3xl">
              <div className="space-y-2">
                <Label htmlFor="mess_name">{t('settings.labels.messName')}</Label>
                <Input id="mess_name" {...register('mess_name')} />
                {errors.mess_name && <p className="text-xs text-destructive">{errors.mess_name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency_code">{t('settings.labels.currencyCode')}</Label>
                <Input id="currency_code" {...register('currency_code')} maxLength={3} />
                {errors.currency_code && <p className="text-xs text-destructive">{errors.currency_code.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="opening_float">{t('settings.labels.openingFloat', { currency: currencyCode })}</Label>
                <Input id="opening_float" type="number" step="0.01" {...register('opening_float')} />
                {errors.opening_float && <p className="text-xs text-destructive">{errors.opening_float.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="recovery_target_pct">{t('settings.labels.recoveryTarget')}</Label>
                <Input id="recovery_target_pct" type="number" step="0.01" min={0} max={100} {...register('recovery_target_pct')} />
                {errors.recovery_target_pct && <p className="text-xs text-destructive">{errors.recovery_target_pct.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="vat_pct">{t('settings.labels.vat')}</Label>
                <Input id="vat_pct" type="number" step="0.01" min={0} max={100} {...register('vat_pct')} />
                {errors.vat_pct && <p className="text-xs text-destructive">{errors.vat_pct.message}</p>}
              </div>
              <div className="space-y-2 md:col-span-2">
                <label htmlFor="holiday_mode" className="flex items-center gap-2 text-sm">
                  <input id="holiday_mode" type="checkbox" {...register('holiday_mode')} className="h-4 w-4 rounded border" />
                  {t('settings.labels.holidayMode')}
                </label>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={!isDirty || update.isPending}>
                  {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Save className="mr-2 h-4 w-4" /> {t('settings.save')}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}