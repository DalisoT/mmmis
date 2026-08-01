import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './input';
import { Label } from './label';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number', 'search', 'tel', 'url'],
    },
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Text: Story = {
  args: { placeholder: 'Officers Mess', type: 'text' },
};

export const Number: Story = {
  args: { type: 'number', defaultValue: 1000, step: 0.01 },
};

export const Disabled: Story = {
  args: { type: 'text', placeholder: 'Disabled', disabled: true },
};

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-1.5">
      <Label htmlFor="mess_name">Mess name</Label>
      <Input id="mess_name" placeholder="Officers Mess" />
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="grid w-full max-w-md gap-3">
      <Input placeholder="Text" />
      <Input type="email" placeholder="you@example.com" />
      <Input type="password" placeholder="Password" />
      <Input type="number" placeholder="0.00" step={0.01} />
      <Input type="search" placeholder="Search products…" />
      <Input placeholder="Disabled" disabled />
    </div>
  ),
};
