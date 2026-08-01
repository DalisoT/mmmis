import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the service hooks so the test doesn't hit Supabase. Each test
// re-mocks via vi.mocked(...) inside beforeEach to control the shape.
const mockUseMessSettings = vi.fn();
const mockUseUpdateMessSettings = vi.fn();
const mockLogAudit = vi.fn();

vi.mock('./settings.service', async () => {
  // Use the real schema so @hookform/resolvers/zod gets the surface it
  // needs (parse, safeParse, _def, etc.). The pure-schema behaviour is
  // covered in settings.service.test.ts.
  const actual = await vi.importActual<typeof import('./settings.service')>('./settings.service');
  return {
    settingsFormSchema: actual.settingsFormSchema,
    useMessSettings: () => mockUseMessSettings(),
    useUpdateMessSettings: () => mockUseUpdateMessSettings(),
  };
});

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/features/audit/audit', () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

// Mock the supabase client entirely — SettingsPage doesn't import it
// directly, but the service module does, and we just stubbed the service.
// This stub satisfies the import chain.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    }),
  },
}));

import { SettingsPage } from './SettingsPage';

const baseSettings = {
  id: 1,
  opening_float: 1000,
  recovery_target_pct: 30,
  vat_pct: 0,
  holiday_mode: false,
  mess_name: 'Officers Mess',
  currency_code: 'ZMW',
  updated_by: null,
  updated_at: '2026-07-31T12:00:00Z',
};

const SUCCESS_MUTATION = () => ({
  mutateAsync: vi.fn().mockResolvedValue(baseSettings),
  isPending: false,
});

// Labels are htmlFor-associated with their inputs (P5.3 fix), so we can
// query by getByLabelText.
function getMessNameInput() {
  return screen.getByLabelText('Mess name') as HTMLInputElement;
}
function getCurrencyInput() {
  return screen.getByLabelText(/Currency code/) as HTMLInputElement;
}
function getOpeningFloatInput() {
  return screen.getByLabelText(/Opening float/) as HTMLInputElement;
}
function getRecoveryInput() {
  return screen.getByLabelText(/CHIT recovery target/) as HTMLInputElement;
}
function getVatInput() {
  return screen.getByLabelText(/VAT/) as HTMLInputElement;
}
function getHolidayCheckbox() {
  return screen.getByLabelText(/Holiday mode/) as HTMLInputElement;
}

describe('SettingsPage', () => {
  beforeEach(() => {
    mockUseMessSettings.mockReset();
    mockUseUpdateMessSettings.mockReset();
    mockLogAudit.mockReset();
    mockUseUpdateMessSettings.mockReturnValue(SUCCESS_MUTATION());
  });

  it('shows a loading indicator while the settings query is pending', () => {
    mockUseMessSettings.mockReturnValue({ data: undefined, isLoading: true });

    render(<SettingsPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders the form fields with the loaded values', async () => {
    mockUseMessSettings.mockReturnValue({ data: baseSettings, isLoading: false });

    render(<SettingsPage />);

    // The reset() effect runs on mount after data arrives.
    await waitFor(() => {
      expect(getMessNameInput()).toBeInTheDocument();
    });
    expect(getMessNameInput()).toHaveValue('Officers Mess');
    expect(getCurrencyInput()).toHaveValue('ZMW');
    expect(getOpeningFloatInput()).toHaveValue(1000);
    expect(getRecoveryInput()).toHaveValue(30);
    expect(getVatInput()).toHaveValue(0);
    expect(getHolidayCheckbox()).not.toBeChecked();
  });

  it('disables the Save button when the form is clean', async () => {
    mockUseMessSettings.mockReturnValue({ data: baseSettings, isLoading: false });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(getMessNameInput()).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /save settings/i })).toBeDisabled();
  });

  it('enables the Save button after a field is edited', async () => {
    mockUseMessSettings.mockReturnValue({ data: baseSettings, isLoading: false });
    const user = userEvent.setup();

    render(<SettingsPage />);

    await waitFor(() => {
      expect(getMessNameInput()).toBeInTheDocument();
    });

    const messName = getMessNameInput();
    await user.clear(messName);
    await user.type(messName, 'New Mess Name');

    expect(screen.getByRole('button', { name: /save settings/i })).toBeEnabled();
  });

  it('calls the update mutation on submit', async () => {
    mockUseMessSettings.mockReturnValue({ data: baseSettings, isLoading: false });
    const mutation = SUCCESS_MUTATION();
    mockUseUpdateMessSettings.mockReturnValue(mutation);

    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => {
      expect(getMessNameInput()).toBeInTheDocument();
    });

    const messName = getMessNameInput();
    await user.clear(messName);
    await user.type(messName, 'New Mess Name');

    const saveButton = screen.getByRole('button', { name: /save settings/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);
    });

    const call = mutation.mutateAsync.mock.calls[0][0];
    expect(call.mess_name).toBe('New Mess Name');
  });

  it('does not call the mutation when the form is invalid', async () => {
    mockUseMessSettings.mockReturnValue({ data: baseSettings, isLoading: false });
    const mutation = SUCCESS_MUTATION();
    mockUseUpdateMessSettings.mockReturnValue(mutation);

    render(<SettingsPage />);

    await waitFor(() => {
      expect(getMessNameInput()).toBeInTheDocument();
    });

    // The form is pristine — Save is disabled. Clicking a disabled button
    // is a no-op in userEvent.
    const saveButton = screen.getByRole('button', { name: /save settings/i });
    expect(saveButton).toBeDisabled();
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });
});
