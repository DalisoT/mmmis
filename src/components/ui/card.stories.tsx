import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { Button } from './button';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Basic: Story = {
  render: (args) => (
    <Card {...args} className="max-w-md">
      <CardHeader>
        <CardTitle>Mess configuration</CardTitle>
        <CardDescription>Used across Point of Sale, Reports, and Member Portal.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">Mess name, opening float, currency, VAT — all editable from here.</p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Save</Button>
      </CardFooter>
    </Card>
  ),
};

export const NoFooter: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Today's cash at hand</CardTitle>
        <CardDescription>As of 17:42 local time</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">ZMW 12,485.00</p>
      </CardContent>
    </Card>
  ),
};

export const CompactDensity: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader className="p-3">
        <CardTitle className="text-base">Low stock</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-sm">
        4 products are at or below their minimum stock level.
      </CardContent>
    </Card>
  ),
};
