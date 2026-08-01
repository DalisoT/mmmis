import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'destructive', 'outline', 'success', 'warning'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = { args: { children: 'Member' } };
export const Secondary: Story = { args: { children: 'Barman', variant: 'secondary' } };
export const Destructive: Story = { args: { children: 'Blacklisted', variant: 'destructive' } };
export const Outline: Story = { args: { children: 'Administrator only', variant: 'outline' } };
export const Success: Story = { args: { children: 'Approved', variant: 'success' } };
export const Warning: Story = { args: { children: 'Pending', variant: 'warning' } };

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
    </div>
  ),
};
