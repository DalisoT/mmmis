import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, Search, UserCog, KeyRound, Copy, Check, Mail, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { ResponsiveTable } from '@/components/ui/responsive-table';
import { PasswordInput } from '@/components/ui/password-input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  useUsers, useRoles, useCreateUser, useUpdateUser, useDeactivateUser, useResetUserPassword,
  userFormSchema, userUpdateSchema, ROLE_CODES,
  type ResetPasswordResult,
} from './users.service';
import { toast } from '@/lib/toast';
import { formatDateTime, genStrongPassword } from '@/lib/utils';
import { useConfirm } from '@/hooks/useConfirm';
import type { AppUserProfile } from '@/types/database.placeholder';
import type { z } from 'zod';

type CreateValues = z.infer<typeof userFormSchema>;
type UpdateValues = z.infer<typeof userUpdateSchema>;

const ROLE_LABEL: Record<string, string> = {
  administrator: 'Administrator',
  treasurer: 'Treasurer',
  barman: 'Barman',
  member: 'Member',
};

/** Display credentials returned by the create / reset Edge Functions so the
 *  admin can hand them over manually when SMTP is not configured. */
function CredentialsDialog({
  title,
  description,
  email,
  tempPassword,
  mailed,
  mailError,
  onClose,
}: {
  title: string;
  description: string;
  email: string;
  tempPassword: string;
  mailed: boolean;
  mailError: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {mailed ? (
            <div className="flex items-start gap-2 rounded-md border border-emerald-300/40 bg-emerald-50/40 p-3 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              <Mail className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">Email sent to {email}</div>
                <div className="text-xs opacity-80">
                  The user should receive their credentials shortly.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50/50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">Email not delivered</div>
                <div className="text-xs opacity-80">
                  {mailError ?? 'SMTP is not configured. Share these credentials with the user directly.'}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-md border bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">Service email</div>
            <div className="font-mono text-sm">{email}</div>
          </div>

          <div className="rounded-md border bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">Temporary password</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={copy}
                aria-label="Copy password"
              >
                {copied ? (
                  <><Check className="mr-1 h-3 w-3" /> Copied</>
                ) : (
                  <><Copy className="mr-1 h-3 w-3" /> Copy</>
                )}
              </Button>
            </div>
            <div className="break-all font-mono text-sm">{tempPassword}</div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              The user will be required to set a new password on next sign-in.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const { data: users, isLoading } = useUsers();
  const { data: roles } = useRoles();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deactivateUser = useDeactivateUser();
  const confirm = useConfirm();
  const resetPassword = useResetUserPassword();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AppUserProfile | null>(null);
  const [filter, setFilter] = useState('');
  const [credentials, setCredentials] = useState<{
    title: string;
    description: string;
    email: string;
    tempPassword: string;
    mailed: boolean;
    mailError: string | null;
  } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const filtered = (users ?? []).filter((u) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return [u.service_number, u.full_name, u.email ?? '', u.rank ?? '']
      .some((s) => s.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-sm text-muted-foreground">
            Create accounts, assign roles, and manage mess members.
          </p>
        </div>
        <Dialog
          open={createOpen}
          onOpenChange={(o) => {
            setCreateOpen(o);
            if (!o) setCreateError(null);
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New User
            </Button>
          </DialogTrigger>
          <CreateUserDialog
            roles={roles ?? []}
            onSubmit={async (values) => {
              setCreateError(null);
              try {
                const result = await createUser.mutateAsync(values);
                setCreateOpen(false);
                setCredentials({
                  title: 'User created',
                  description: `Account for ${result.user_id ? values.full_name : values.email} is ready.`,
                  email: values.email,
                  tempPassword: result.temp_password,
                  mailed: result.mailed,
                  mailError: result.mail_error,
                });
                toast.success(`Created ${values.full_name}`);
              } catch (err) {
                setCreateError(err instanceof Error ? err.message : 'Could not create user');
              }
            }}
            submitting={createUser.isPending}
            error={createError}
          />
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">All Users</CardTitle>
            <CardDescription>
              {(users ?? []).length} total · {(users ?? []).filter((u) => u.is_active).length} active
            </CardDescription>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search service no / name / rank"
              className="pl-8"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading users…
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No users found.</p>
          ) : (
            <ResponsiveTable
              rows={filtered}
              rowKey={(u) => u.id}
              headers={['Service Number', 'Name', 'Rank / Unit', 'Role', 'Status', 'Last Login', 'Actions']}
              headerClassNames={['', '', '', '', '', '', 'text-right']}
              cells={[
                (u) => <span className="font-mono">{u.service_number}</span>,
                (u) => (
                  <div>
                    <div className="font-medium">{u.full_name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </div>
                ),
                (u) => (
                  <div>
                    <div className="text-sm">{u.rank ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{u.unit ?? '—'}</div>
                  </div>
                ),
                (u) => <Badge variant="outline">{ROLE_LABEL[u.role_code] ?? u.role_code}</Badge>,
                (u) => u.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>,
                (u) => <span className="text-sm text-muted-foreground">{formatDateTime(u.last_login_at)}</span>,
                (u) => (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(u)}>
                      <UserCog className="mr-1 h-4 w-4" /> Edit
                    </Button>
                    {u.is_active && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Deactivate ${u.full_name}?`,
                            description: 'The user will be signed out, blocked from sign-in, and hidden from the members list. Their historic records (sales, ledger entries, audit log) are kept.',
                            confirmLabel: 'Deactivate',
                            destructive: true,
                          });
                          if (ok) {
                            void deactivateUser.mutate(u.id);
                          }
                        }}
                      >
                        Deactivate
                      </Button>
                    )}
                  </div>
                ),
              ]}
              cardTitle={(u) => u.full_name}
              cardSubtitle={(u) => `${u.service_number} · ${u.rank ?? '—'}`}
              cardBadge={(u) => <Badge variant="outline">{ROLE_LABEL[u.role_code] ?? u.role_code}</Badge>}
              cardFields={[
                { label: 'Status', value: (u: any) => u.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge> },
                { label: 'Last login', value: (u: any) => <span className="text-sm text-muted-foreground">{formatDateTime(u.last_login_at)}</span> },
                {
                  label: 'Actions',
                  value: (u: any) => (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(u)}>
                        <UserCog className="mr-1 h-4 w-4" /> Edit
                      </Button>
                      {u.is_active && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Deactivate ${u.full_name}?`,
                              description: 'The user will be signed out, blocked from sign-in, and hidden from the members list. Their historic records (sales, ledger entries, audit log) are kept.',
                              confirmLabel: 'Deactivate',
                              destructive: true,
                            });
                            if (ok) {
                              void deactivateUser.mutate(u.id);
                            }
                          }}
                        >
                          Deactivate
                        </Button>
                      )}
                    </div>
                  ),
                  fullWidth: true,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <EditUserDialog
            user={editing}
            onSubmit={async (values) => {
              try {
                await updateUser.mutateAsync({ id: editing.id, values });
                setEditing(null);
                toast.success(`Updated ${editing.full_name}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not update user');
              }
            }}
            submitting={updateUser.isPending}
            onResetPassword={async () => {
              try {
                const result: ResetPasswordResult = await resetPassword.mutateAsync(editing.id);
                setEditing(null);
                setCredentials({
                  title: 'Password reset',
                  description: `A new temporary password has been issued for ${editing.full_name}.`,
                  email: editing.email ?? '',
                  tempPassword: result.temp_password,
                  mailed: result.mailed,
                  mailError: null,
                });
                toast.success(`Password reset for ${editing.full_name}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not reset password');
              }
            }}
            resetting={resetPassword.isPending}
          />
        )}
      </Dialog>

      {credentials && (
        <CredentialsDialog
          title={credentials.title}
          description={credentials.description}
          email={credentials.email}
          tempPassword={credentials.tempPassword}
          mailed={credentials.mailed}
          mailError={credentials.mailError}
          onClose={() => setCredentials(null)}
        />
      )}
    </div>
  );
}

// ---- Create dialog --------------------------------------------------------

interface CreateUserDialogProps {
  roles: { id: number; code: string; name: string }[];
  onSubmit: (values: CreateValues) => Promise<void> | void;
  submitting: boolean;
  error: string | null;
}

function CreateUserDialog({ roles: _roles, onSubmit, submitting, error }: CreateUserDialogProps) {
  const {
    register, handleSubmit, setValue, watch, reset,
    formState: { errors },
  } = useForm<CreateValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      role_code: 'member', is_active: true, must_reset_pw: true, password: '',
    },
  });
  const role = watch('role_code');

  const generatePassword = () => {
    setValue('password', genStrongPassword(), { shouldValidate: true });
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create New User</DialogTitle>
        <DialogDescription>
          Issues an auth account and a public.users profile. Leave the password
          blank to have a strong temporary password auto-generated and emailed
          (if SMTP is configured).
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={handleSubmit(async (values) => { await onSubmit(values); reset(); })}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <Field label="Service Number" error={errors.service_number?.message}>
          <Input {...register('service_number')} placeholder="ZM-12345" />
        </Field>
        <Field label="Full Name" error={errors.full_name?.message}>
          <Input {...register('full_name')} />
        </Field>
        <Field label="Email" error={errors.email?.message} className="sm:col-span-2">
          <Input type="email" {...register('email')} />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input {...register('phone')} />
        </Field>
        <Field label="Rank" error={errors.rank?.message}>
          <Input {...register('rank')} placeholder="e.g. Capt." />
        </Field>
        <Field label="Unit" error={errors.unit?.message} className="sm:col-span-2">
          <Input {...register('unit')} placeholder="e.g. 1CDO" />
        </Field>
        <Field label="Role" error={errors.role_code?.message}>
          <Select value={role} onValueChange={(v) => setValue('role_code', v as CreateValues['role_code'])}>
            <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
            <SelectContent>
              {ROLE_CODES.map((c) => (
                <SelectItem key={c} value={c}>{ROLE_LABEL[c] ?? c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Temporary Password (optional)"
          error={errors.password?.message}
          hint="Leave blank to auto-generate one and email it to the user."
        >
          <div className="flex gap-2">
            <PasswordInput
              className="flex-1"
              placeholder="auto-generate if blank"
              autoComplete="new-password"
              {...register('password')}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={generatePassword}
              aria-label="Generate strong password"
            >
              <KeyRound className="mr-1 h-4 w-4" /> Generate
            </Button>
          </div>
        </Field>

        {error && (
          <p className="sm:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="sm:col-span-2 mt-2">
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

// ---- Edit dialog ---------------------------------------------------------

interface EditUserDialogProps {
  user: AppUserProfile;
  onSubmit: (values: UpdateValues) => Promise<void> | void;
  submitting: boolean;
  onResetPassword: () => Promise<void> | void;
  resetting: boolean;
}

function EditUserDialog({ user, onSubmit, submitting, onResetPassword, resetting }: EditUserDialogProps) {
  const {
    register, handleSubmit, setValue, watch,
    formState: { errors },
  } = useForm<UpdateValues>({
    resolver: zodResolver(userUpdateSchema),
    defaultValues: {
      full_name: user.full_name,
      email: user.email ?? '',
      phone: user.phone ?? '',
      rank: user.rank ?? '',
      unit: user.unit ?? '',
      role_code: user.role_code,
      is_active: user.is_active,
      must_reset_pw: user.must_reset_pw,
    },
  });
  const role = watch('role_code');

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Edit User — {user.full_name}</DialogTitle>
        <DialogDescription>
          Update profile fields and role. To change the password, use the
          &quot;Reset password&quot; button below — a new temporary password
          will be emailed to the user.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={handleSubmit(async (values) => { await onSubmit(values); })}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <Field label="Full Name" error={errors.full_name?.message}>
          <Input {...register('full_name')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" {...register('email')} />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input {...register('phone')} />
        </Field>
        <Field label="Rank" error={errors.rank?.message}>
          <Input {...register('rank')} />
        </Field>
        <Field label="Unit" error={errors.unit?.message}>
          <Input {...register('unit')} />
        </Field>
        <Field label="Role" error={errors.role_code?.message}>
          <Select value={role} onValueChange={(v) => setValue('role_code', v as UpdateValues['role_code'])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLE_CODES.map((c) => (
                <SelectItem key={c} value={c}>{ROLE_LABEL[c] ?? c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Service Number"
          hint={`Read-only (${user.service_number}). Contact an administrator to change it.`}
        >
          <Input value={user.service_number} readOnly disabled />
        </Field>

        <div className="sm:col-span-2 flex flex-col items-stretch gap-2 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <KeyRound className="h-3 w-3" />
            Reset the user&apos;s password and email them a new temp password.
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { void onResetPassword(); }}
            disabled={resetting || !user.email}
          >
            {resetting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="mr-1 h-4 w-4" />
            )}
            Reset password
          </Button>
        </div>

        <DialogFooter className="sm:col-span-2 mt-2">
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

// ---- Field helper --------------------------------------------------------

function Field({
  label, hint, error, children, className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && !error && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

// keep roles prop used (avoid ts unused)
void ROLE_CODES;