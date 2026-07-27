import { useEffect } from 'react';
import { Loader2, Save, Settings as Cog } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Cog className="h-5 w-5" /> Mess Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Configuration shared by every role. {data && <>Last updated {formatDateTime(data.updated_at)}</>}
          </p>
        </div>
        <Badge variant="outline">Administrator only</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mess configuration</CardTitle>
          <CardDescription>Used across Point of Sale, Reports, and Member Portal.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2 max-w-3xl">
              <div className="space-y-2">
                <Label>Mess name</Label>
                <Input {...register('mess_name')} />
                {errors.mess_name && <p className="text-xs text-destructive">{errors.mess_name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Currency code (ISO 4217)</Label>
                <Input {...register('currency_code')} maxLength={3} />
                {errors.currency_code && <p className="text-xs text-destructive">{errors.currency_code.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Opening float (ZMW)</Label>
                <Input type="number" step="0.01" {...register('opening_float')} />
                {errors.opening_float && <p className="text-xs text-destructive">{errors.opening_float.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>CHIT recovery target (%)</Label>
                <Input type="number" step="0.01" min={0} max={100} {...register('recovery_target_pct')} />
                {errors.recovery_target_pct && <p className="text-xs text-destructive">{errors.recovery_target_pct.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>VAT / Tax (%)</Label>
                <Input type="number" step="0.01" min={0} max={100} {...register('vat_pct')} />
                {errors.vat_pct && <p className="text-xs text-destructive">{errors.vat_pct.message}</p>}
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...register('holiday_mode')} className="h-4 w-4 rounded border" />
                  Holiday mode (locks new CHIT sales)
                </label>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={!isDirty || update.isPending}>
                  {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Save className="mr-2 h-4 w-4" /> Save settings
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}