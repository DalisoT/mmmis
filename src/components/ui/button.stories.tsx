import type { Meta, StoryObj } from '@storybook/react';
import { Save, Trash2, Download, Plus } from 'lucide-react';
import { Button } from './button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
    },
    disabled: { control: 'boolean' },
    asChild: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { children: 'Save settings', variant: 'default' },
};

export const Destructive: Story = {
  args: { children: 'Delete member', variant: 'destructive' },
};

export const Outline: Story = {
  args: { children: 'Cancel', variant: 'outline' },
};

export const Secondary: Story = {
  args: { children: 'Mark as draft', variant: 'secondary' },
};

export const Ghost: Story = {
  args: { children: 'Skip', variant: 'ghost' },
};

export const Link: Story = {
  args: { children: 'Forgot password?', variant: 'link' },
};

export const WithIconLeading: Story = {
  args: { children: 'Save settings', variant: 'default' },
  render: (args) => (
    <Button {...args}>
      <Save className="mr-2 h-4 w-4" />
      {args.children}
    </Button>
  ),
};

export const IconOnly: Story = {
  args: { children: <Trash2 className="h-4 w-4" />, variant: 'outline', size: 'icon', 'aria-label': 'Delete' as never },
};

export const Disabled: Story = {
  args: { children: 'Save settings', disabled: true },
};

export const Loading: Story = {
  args: { children: 'Saving…', disabled: true },
  render: (args) => (
    <Button {...args}>
      <Plus className="mr-2 h-4 w-4 animate-spin" />
      {args.children}
    </Button>
  ),
};

export const WithDownloadIcon: Story = {
  args: { children: 'Export CSV', variant: 'outline' },
  render: (args) => (
    <Button {...args}>
      <Download className="mr-2 h-4 w-4" />
      {args.children}
    </Button>
  ),
};
