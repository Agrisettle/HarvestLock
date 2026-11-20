import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusBadge } from './StatusBadge';

const STATUSES = [
  'Draft',
  'Locked',
  'Advance1Released',
  'CheckpointPassed',
  'Advance2Released',
  'ReadyForDelivery',
  'Delivered',
  'Settled',
  'Disputed',
  'Defaulted',
  'Cancelled',
] as const;

const meta = {
  title: 'Components/StatusBadge',
  component: StatusBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    status: { control: 'select', options: STATUSES },
  },
  args: {
    status: 'Locked',
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = {
  args: { status: 'Draft' },
};

export const Locked: Story = {
  args: { status: 'Locked' },
};

export const Advance1Released: Story = {
  args: { status: 'Advance1Released' },
};

export const CheckpointPassed: Story = {
  args: { status: 'CheckpointPassed' },
};

export const Advance2Released: Story = {
  args: { status: 'Advance2Released' },
};

export const ReadyForDelivery: Story = {
  args: { status: 'ReadyForDelivery' },
};

export const Delivered: Story = {
  args: { status: 'Delivered' },
};

export const Settled: Story = {
  args: { status: 'Settled' },
};

export const Disputed: Story = {
  args: { status: 'Disputed' },
};

export const Defaulted: Story = {
  args: { status: 'Defaulted' },
};

export const Cancelled: Story = {
  args: { status: 'Cancelled' },
};
